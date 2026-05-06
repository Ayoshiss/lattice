use anchor_lang::prelude::*;
use crate::constants::{POOL_SEED, SLASH_LAMPORTS};
use crate::error::LatticeError;
use crate::state::{BatchAuctionPool, PoolPhase};

#[derive(Accounts)]
pub struct SlashUnrevealed<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, pool.token_in_mint.as_ref(), pool.token_out_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, BatchAuctionPool>>,

    /// Anyone can call this after the reveal window closes (anti-spam keeper).
    pub caller: Signer<'info>,

    /// The offending payer account — lamport slash destination goes to caller.
    /// CHECK: just transferring lamports as penalty.
    #[account(mut)]
    pub offender: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SlashUnrevealed>, slot_index: u32) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let current_slot = Clock::get()?.slot;

    // Slash is only valid after the reveal window has closed.
    let reveal_end = pool.phase_start_slot + pool.reveal_window_slots;
    require!(
        pool.phase == PoolPhase::Reveal || pool.phase == PoolPhase::Cleared,
        LatticeError::SlashTooEarly
    );
    require!(current_slot >= reveal_end, LatticeError::SlashTooEarly);

    let idx = slot_index as usize;
    require!(idx < pool.order_count as usize, LatticeError::SlotEmpty);

    let order = &pool.orders[idx];
    require!(!order.revealed, LatticeError::AlreadyRevealed); // already-revealed = no slash
    require!(order.payer == ctx.accounts.offender.key(), LatticeError::SlotEmpty);

    // Null-out the slot so it is excluded from clearing.
    pool.orders[idx] = Default::default();

    // TODO Day 2: actually transfer SLASH_LAMPORTS from offender to caller via system_program CPI.
    msg!(
        "Slashed unrevealed slot_index={} payer={} slash={} lamports",
        idx,
        ctx.accounts.offender.key(),
        SLASH_LAMPORTS,
    );

    Ok(())
}
