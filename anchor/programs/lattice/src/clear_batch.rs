use anchor_lang::prelude::*;
use crate::constants::POOL_SEED;
use crate::error::LatticeError;
use crate::state::{BatchAuctionPool, PoolPhase};

#[derive(Accounts)]
pub struct ClearBatch<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, pool.token_in_mint.as_ref(), pool.token_out_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, BatchAuctionPool>>,

    /// Anyone can call ClearBatch once the reveal window closes (keeper bot).
    pub caller: Signer<'info>,
}

/// Find p* via binary search over the submitted limit-price ladder.
///
/// Algorithm:
///   1. Collect all revealed buy prices (descending) and sell prices (ascending).
///   2. Candidate set = union of all revealed limit prices.
///   3. For each candidate p, matched_volume(p) = min(cum_buy_vol(≥p), cum_sell_vol(≤p)).
///   4. Choose p* = argmax matched_volume; tie-break = minimum spread.
///
/// Returns (clearing_price, matched_volume) or err if no cross.
fn find_clearing_price(pool: &BatchAuctionPool) -> Result<(u64, u64)> {
    let revealed = &pool.orders[..pool.order_count as usize]
        .iter()
        .filter(|o| o.revealed)
        .collect::<Vec<_>>();

    if revealed.is_empty() {
        return err!(LatticeError::NoCross);
    }

    // Collect distinct price candidates.
    let mut prices: Vec<u64> = revealed.iter().map(|o| o.limit_price).collect();
    prices.dedup();
    prices.sort_unstable();

    let mut best_price: u64 = 0;
    let mut best_volume: u64 = 0;

    for &p in &prices {
        // Cumulative buy volume at or above p.
        let buy_vol: u64 = revealed
            .iter()
            .filter(|o| o.is_buy && o.limit_price >= p)
            .map(|o| o.amount)
            .fold(0u64, |acc, x| acc.saturating_add(x));

        // Cumulative sell volume at or below p.
        let sell_vol: u64 = revealed
            .iter()
            .filter(|o| !o.is_buy && o.limit_price <= p)
            .map(|o| o.amount)
            .fold(0u64, |acc, x| acc.saturating_add(x));

        let matched = buy_vol.min(sell_vol);

        if matched > best_volume || (matched == best_volume && p < best_price) {
            best_volume = matched;
            best_price = p;
        }
    }

    if best_volume == 0 {
        return err!(LatticeError::NoCross);
    }

    Ok((best_price, best_volume))
}

pub fn handler(ctx: Context<ClearBatch>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let current_slot = Clock::get()?.slot;

    // Auto-advance Reveal → Cleared once the reveal window closes.
    if pool.phase == PoolPhase::Reveal
        && current_slot >= pool.phase_start_slot + pool.reveal_window_slots
    {
        pool.phase = PoolPhase::Cleared;
    }

    require!(
        pool.phase == PoolPhase::Cleared,
        LatticeError::RevealWindowClosed
    );
    require!(pool.clearing_price == 0, LatticeError::AlreadyCleared);

    let (clearing_price, matched_volume) = find_clearing_price(pool)?;
    pool.clearing_price = clearing_price;
    pool.matched_volume = matched_volume;

    // Mark which orders are filled at p*.
    // Pro-rata fill: if total buy vol > sell vol, buys are filled pro-rata (simplified to full here).
    let n = pool.order_count as usize;
    for i in 0..n {
        if !pool.orders[i].revealed {
            continue;
        }
        // Copy fields before mutating to satisfy borrow checker.
        let (is_buy, limit_price, amount) = {
            let o = &pool.orders[i];
            (o.is_buy, o.limit_price, o.amount)
        };
        let eligible = if is_buy {
            limit_price >= clearing_price
        } else {
            limit_price <= clearing_price
        };

        if eligible {
            pool.orders[i].filled = true;
            pool.orders[i].fill_amount = amount;
        }
    }

    msg!(
        "ClearBatch: p*={} matched_vol={}",
        clearing_price,
        matched_volume
    );

    Ok(())
}
