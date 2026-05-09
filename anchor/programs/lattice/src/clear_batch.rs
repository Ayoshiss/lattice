use anchor_lang::prelude::*;
use crate::constants::{POOL_SEED, PHASE_REVEAL, PHASE_CLEARED};
use crate::error::LatticeError;
use crate::state::BatchAuctionPool;

#[derive(Accounts)]
pub struct ClearBatch<'info> {
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

    /// Anyone can call ClearBatch once the reveal window closes (permissionless keeper).
    pub caller: Signer<'info>,
}

/// Find p* via exhaustive search over submitted limit-price candidates.
///
/// Algorithm:
///   1. Collect all revealed prices as candidates.
///   2. For each candidate p, matched_volume(p) = min(cum_buy_vol(≥p), cum_sell_vol(≤p)).
///   3. Choose p* = argmax matched_volume; tie-break = lower p (maximises price improvement
///      for buyers, consistent with Walrasian equilibrium).
///
/// Returns (clearing_price, matched_volume) or Err(NoCross) if no crossing.
fn find_clearing_price(pool: &BatchAuctionPool) -> Result<(u64, u64)> {
    let n = pool.order_count as usize;
    let revealed: Vec<(bool, u64, u64)> = pool.orders[..n]
        .iter()
        .filter(|o| o.revealed != 0)
        .map(|o| (o.is_buy != 0, o.limit_price, o.amount))
        .collect();

    if revealed.is_empty() {
        return err!(LatticeError::NoCross);
    }

    // Collect distinct price candidates (union of all revealed limit prices).
    let mut prices: Vec<u64> = revealed.iter().map(|(_, p, _)| *p).collect();
    prices.sort_unstable();
    prices.dedup();

    let mut best_price:  u64 = 0;
    let mut best_volume: u64 = 0;

    for &p in &prices {
        let buy_vol: u64 = revealed
            .iter()
            .filter(|(is_buy, lp, _)| *is_buy && *lp >= p)
            .map(|(_, _, amt)| *amt)
            .fold(0u64, |acc, x| acc.saturating_add(x));

        let sell_vol: u64 = revealed
            .iter()
            .filter(|(is_buy, lp, _)| !*is_buy && *lp <= p)
            .map(|(_, _, amt)| *amt)
            .fold(0u64, |acc, x| acc.saturating_add(x));

        let matched = buy_vol.min(sell_vol);

        // Prefer more volume; tie-break on lower price (Walrasian surplus).
        if matched > best_volume || (matched == best_volume && matched > 0 && p < best_price) {
            best_volume = matched;
            best_price  = p;
        }
    }

    if best_volume == 0 {
        return err!(LatticeError::NoCross);
    }

    Ok((best_price, best_volume))
}

pub fn handler(ctx: Context<ClearBatch>) -> Result<()> {
    let current_slot = Clock::get()?.slot;

    // ── Phase auto-advance: Reveal → Cleared ──────────────────────────────────
    {
        let mut pool = ctx.accounts.pool.load_mut()?;
        if pool.phase == PHASE_REVEAL
            && current_slot >= pool.phase_start_slot + pool.reveal_window_slots
        {
            pool.phase = PHASE_CLEARED;
        }

        require!(
            pool.phase == PHASE_CLEARED,
            LatticeError::RevealWindowClosed
        );
        require!(pool.clearing_price == 0, LatticeError::AlreadyCleared);
    } // drop borrow so we can re-borrow for clearing

    // ── Find clearing price (read-only pass) ──────────────────────────────────
    let (clearing_price, matched_volume) = {
        let pool = ctx.accounts.pool.load()?;
        find_clearing_price(&pool)?
    };

    // ── Mark filled orders (write pass) ───────────────────────────────────────
    let mut pool = ctx.accounts.pool.load_mut()?;
    pool.clearing_price = clearing_price;
    pool.matched_volume = matched_volume;

    let n = pool.order_count as usize;
    for i in 0..n {
        if pool.orders[i].revealed == 0 {
            continue;
        }
        let is_buy      = pool.orders[i].is_buy != 0;
        let limit_price = pool.orders[i].limit_price;
        let amount      = pool.orders[i].amount;

        let eligible = if is_buy {
            limit_price >= clearing_price
        } else {
            limit_price <= clearing_price
        };

        if eligible {
            pool.orders[i].filled      = 1;
            pool.orders[i].fill_amount = amount;
        }
    }

    msg!(
        "ClearBatch: p*={} matched_vol={}",
        clearing_price,
        matched_volume,
    );

    Ok(())
}
