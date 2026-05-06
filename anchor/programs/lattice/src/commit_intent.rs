use anchor_lang::prelude::*;
use crate::constants::{POOL_SEED, VAULT_SEED, MAX_ORDERS};
use crate::error::LatticeError;
use crate::state::{BatchAuctionPool, PoolPhase, OrderSlot};
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct CommitIntent<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.token_in_mint.as_ref(), pool.token_out_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, BatchAuctionPool>>,

    /// Payer's token account (token_in for buys, token_out for sells).
    #[account(mut)]
    pub payer_token_account: Account<'info, TokenAccount>,

    /// The mint of the token being locked into the vault.
    /// Must match payer_token_account.mint.
    pub mint: Account<'info, Mint>,

    /// Program-owned vault PDA that holds locked tokens during the batch.
    /// Created on first commit; reused for all subsequent commits in same batch.
    #[account(
        init_if_needed,
        payer = payer,
        seeds = [VAULT_SEED, pool.key().as_ref(), mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = pool,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CommitIntent>,
    commit_hash: [u8; 32],
    amount: u64,
    is_buy: bool,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let current_slot = Clock::get()?.slot;

    // Auto-advance phase if commit window has elapsed.
    if pool.phase == PoolPhase::Commit
        && current_slot >= pool.phase_start_slot + pool.batch_window_slots
    {
        pool.phase = PoolPhase::Reveal;
        pool.phase_start_slot = current_slot;
        msg!("Phase advanced to Reveal at slot {}", current_slot);
    }

    require!(
        pool.is_commit_window_open(current_slot),
        LatticeError::CommitWindowClosed
    );

    require!(
        pool.order_count < MAX_ORDERS as u32,
        LatticeError::OrderBookFull
    );

    // Lock tokens into vault.
    let cpi_accounts = Transfer {
        from: ctx.accounts.payer_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.payer.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        amount,
    )?;

    // Write commitment to ring buffer.
    let idx = pool.order_count as usize;
    pool.orders[idx] = OrderSlot {
        commit_hash,
        payer: ctx.accounts.payer.key(),
        commit_slot: current_slot,
        amount,
        is_buy,
        limit_price: 0,
        revealed: false,
        filled: false,
        fill_amount: 0,
    };
    pool.order_count += 1;

    msg!(
        "CommitIntent accepted: slot_index={} payer={} amount={} is_buy={}",
        idx,
        ctx.accounts.payer.key(),
        amount,
        is_buy,
    );

    Ok(())
}
