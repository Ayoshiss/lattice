use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};
use crate::constants::POOL_SEED;
use crate::error::LatticeError;
use crate::state::{BatchAuctionPool, PoolPhase};

#[derive(Accounts)]
pub struct RevealIntent<'info> {
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.token_in_mint.as_ref(), pool.token_out_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, BatchAuctionPool>>,
}

pub fn handler(
    ctx: Context<RevealIntent>,
    token_in: Pubkey,
    token_out: Pubkey,
    amount: u64,
    limit_price: u64,
    salt: [u8; 16],
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let current_slot = Clock::get()?.slot;

    // Auto-advance from Commit → Reveal if window elapsed.
    if pool.phase == PoolPhase::Commit
        && current_slot >= pool.phase_start_slot + pool.batch_window_slots
    {
        pool.phase = PoolPhase::Reveal;
        pool.phase_start_slot = current_slot;
        msg!("Phase auto-advanced to Reveal at slot {}", current_slot);
    }

    require!(
        pool.is_reveal_window_open(current_slot),
        LatticeError::RevealWindowClosed
    );

    let payer_key = ctx.accounts.payer.key();

    // Find the matching commitment slot for this payer.
    let slot_index = pool
        .orders[..pool.order_count as usize]
        .iter()
        .position(|o| o.payer == payer_key && !o.revealed)
        .ok_or(LatticeError::SlotEmpty)?;

    let order = &pool.orders[slot_index];
    require!(!order.revealed, LatticeError::AlreadyRevealed);

    // Recompute SHA-256 commitment and verify.
    // Preimage: SHA-256(token_in || token_out || amount_le || limit_price_le || salt)
    let mut hasher = Sha256::new();
    hasher.update(token_in.as_ref());
    hasher.update(token_out.as_ref());
    hasher.update(amount.to_le_bytes());
    hasher.update(limit_price.to_le_bytes());
    hasher.update(salt);
    let expected_hash: [u8; 32] = hasher.finalize().into();

    require!(expected_hash == order.commit_hash, LatticeError::HashMismatch);

    // Copy is_buy before the mutable borrow.
    let is_buy = order.is_buy;

    pool.orders[slot_index].limit_price = limit_price;
    pool.orders[slot_index].revealed = true;

    msg!(
        "RevealIntent verified: slot_index={} payer={} amount={} limit_price={} is_buy={}",
        slot_index,
        payer_key,
        amount,
        limit_price,
        is_buy,
    );

    Ok(())
}
