use anchor_lang::prelude::*;
use crate::constants::POOL_SEED;
use crate::error::LatticeError;
use crate::state::{BatchAuctionPool, PoolPhase};

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, pool.token_in_mint.as_ref(), pool.token_out_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, BatchAuctionPool>>,

    pub caller: Signer<'info>,
    // In the full implementation (Day 2), this includes:
    //   - remaining_accounts: [vault_in, vault_out, recipient_ata] * n_filled_orders
    //   - token_program, system_program
    // Stubbed out for Day 0 compile-and-test.
}

pub fn handler(ctx: Context<Settle>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    require!(
        pool.phase == PoolPhase::Cleared && pool.clearing_price > 0,
        LatticeError::BatchNotCleared
    );

    // TODO Day 2: iterate pool.orders, for each filled order CPI to SPL Token
    // to transfer token_out to recipient ATA at clearing_price, refund
    // unfilled token_in from vault back to payer.

    let filled_count = pool.orders[..pool.order_count as usize]
        .iter()
        .filter(|o| o.filled)
        .count();

    msg!(
        "Settle: clearing_price={} filled_orders={}",
        pool.clearing_price,
        filled_count,
    );

    // Reset pool for the next batch.
    pool.phase = PoolPhase::Commit;
    pool.phase_start_slot = Clock::get()?.slot;
    pool.order_count = 0;
    pool.clearing_price = 0;
    pool.matched_volume = 0;

    Ok(())
}
