use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::constants::{POOL_SEED, SLASH_LAMPORTS, PHASE_REVEAL, PHASE_CLEARED};
use crate::error::LatticeError;
use crate::state::BatchAuctionPool;

/// SlashUnrevealed: penalises a payer who committed but failed to reveal.
///
/// Callable by any keeper after the reveal window has closed.
/// Transfers SLASH_LAMPORTS from the offending payer to the caller as a bounty,
/// then nulls the order slot so it is excluded from clearing.
#[derive(Accounts)]
pub struct SlashUnrevealed<'info> {
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

    /// Anyone can slash after the reveal window closes (permissionless keeper).
    #[account(mut)]
    pub caller: Signer<'info>,

    /// The offending payer whose order was never revealed.
    /// Slash lamports flow: offender → caller.
    /// CHECK: identity validated against pool.orders[slot_index].payer.
    #[account(mut)]
    pub offender: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SlashUnrevealed>, slot_index: u32) -> Result<()> {
    let current_slot = Clock::get()?.slot;
    let idx = slot_index as usize;

    // ── Validate timing and slot ───────────────────────────────────────────────
    {
        let pool = ctx.accounts.pool.load()?;

        let reveal_end = pool.phase_start_slot + pool.reveal_window_slots;
        require!(
            pool.phase == PHASE_REVEAL || pool.phase == PHASE_CLEARED,
            LatticeError::SlashTooEarly
        );
        require!(current_slot >= reveal_end, LatticeError::SlashTooEarly);

        require!(idx < pool.order_count as usize, LatticeError::SlotEmpty);

        let order = &pool.orders[idx];
        require!(order.revealed == 0, LatticeError::AlreadyRevealed);
        require!(
            order.payer == ctx.accounts.offender.key(),
            LatticeError::SlotEmpty
        );
    }

    // ── Transfer SLASH_LAMPORTS: offender → caller ────────────────────────────
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.offender.to_account_info(),
                to:   ctx.accounts.caller.to_account_info(),
            },
        ),
        SLASH_LAMPORTS,
    )?;

    msg!(
        "Slashed slot_index={} payer={} slash={} lamports → keeper={}",
        idx,
        ctx.accounts.offender.key(),
        SLASH_LAMPORTS,
        ctx.accounts.caller.key(),
    );

    // ── Null-out the slot ─────────────────────────────────────────────────────
    let mut pool = ctx.accounts.pool.load_mut()?;
    pool.orders[idx] = Default::default();

    Ok(())
}
