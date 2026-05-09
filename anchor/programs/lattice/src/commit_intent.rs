use anchor_lang::prelude::*;
use crate::constants::{POOL_SEED, VAULT_SEED, MAX_ORDERS, PHASE_COMMIT, PHASE_REVEAL};
use crate::error::LatticeError;
use crate::state::{BatchAuctionPool, OrderSlot};
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct CommitIntent<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, token_in_mint.key().as_ref(), token_out_mint.key().as_ref()],
        bump,
    )]
    pub pool: AccountLoader<'info, BatchAuctionPool>,

    /// CHECK: used in pool PDA seed derivation.
    pub token_in_mint:  UncheckedAccount<'info>,
    /// CHECK: used in pool PDA seed derivation.
    pub token_out_mint: UncheckedAccount<'info>,

    /// Payer's token account (token_in for buys, token_out for sells).
    #[account(mut)]
    pub payer_token_account: Account<'info, TokenAccount>,

    /// The mint of the token being locked into the vault.
    pub mint: Account<'info, Mint>,

    /// Program-owned vault PDA that holds locked tokens during the batch.
    #[account(
        init_if_needed,
        payer = payer,
        seeds = [VAULT_SEED, pool.key().as_ref(), mint.key().as_ref()],
        bump,
        token::mint      = mint,
        token::authority = pool,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CommitIntent>,
    commit_hash: [u8; 32],
    amount: u64,
    is_buy: bool,
) -> Result<()> {
    let current_slot = Clock::get()?.slot;

    // ── Phase auto-advance ─────────────────────────────────────────────────────
    {
        let mut pool = ctx.accounts.pool.load_mut()?;
        if pool.phase == PHASE_COMMIT
            && current_slot >= pool.phase_start_slot + pool.batch_window_slots
        {
            pool.phase            = PHASE_REVEAL;
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
    } // release load_mut borrow before CPI

    // ── Lock tokens into vault ─────────────────────────────────────────────────
    let cpi_accounts = Transfer {
        from:      ctx.accounts.payer_token_account.to_account_info(),
        to:        ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.payer.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        amount,
    )?;

    // ── Write commitment to ring buffer ────────────────────────────────────────
    let mut pool = ctx.accounts.pool.load_mut()?;
    let idx = pool.order_count as usize;
    pool.orders[idx] = OrderSlot {
        commit_hash,
        payer:       ctx.accounts.payer.key(),
        commit_slot: current_slot,
        amount,
        is_buy:      if is_buy { 1 } else { 0 },
        _pad1:       [0u8; 7],
        limit_price: 0,
        revealed:    0,
        filled:      0,
        _pad2:       [0u8; 6],
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
