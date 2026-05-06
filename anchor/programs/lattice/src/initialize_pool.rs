use anchor_lang::prelude::*;
use crate::constants::{POOL_SEED, DEFAULT_COMMIT_WINDOW_SLOTS, DEFAULT_REVEAL_WINDOW_SLOTS};
use crate::state::{BatchAuctionPool, PoolPhase};

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The pool PDA — seeded by [POOL_SEED, token_in_mint, token_out_mint].
    #[account(
        init,
        payer = authority,
        space = BatchAuctionPool::LEN,
        seeds = [POOL_SEED, token_in_mint.key().as_ref(), token_out_mint.key().as_ref()],
        bump,
    )]
    pub pool: Box<Account<'info, BatchAuctionPool>>,

    /// CHECK: just storing the mint address; no token validation needed here.
    pub token_in_mint: UncheckedAccount<'info>,
    /// CHECK: same.
    pub token_out_mint: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializePool>,
    batch_window_slots: u64,
    reveal_window_slots: u64,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    pool.token_in_mint = ctx.accounts.token_in_mint.key();
    pool.token_out_mint = ctx.accounts.token_out_mint.key();
    pool.phase = PoolPhase::Commit;
    pool.phase_start_slot = Clock::get()?.slot;
    pool.batch_window_slots = if batch_window_slots == 0 {
        DEFAULT_COMMIT_WINDOW_SLOTS
    } else {
        batch_window_slots
    };
    pool.reveal_window_slots = if reveal_window_slots == 0 {
        DEFAULT_REVEAL_WINDOW_SLOTS
    } else {
        reveal_window_slots
    };
    pool.order_count = 0;
    // orders array is already zero-initialised by Anchor's `init` constraint
    pool.clearing_price = 0;
    pool.matched_volume = 0;
    pool.bump = ctx.bumps.pool;

    msg!(
        "Lattice pool initialized: {} / {} | commit_window={} slots | reveal_window={} slots",
        pool.token_in_mint,
        pool.token_out_mint,
        pool.batch_window_slots,
        pool.reveal_window_slots,
    );

    Ok(())
}
