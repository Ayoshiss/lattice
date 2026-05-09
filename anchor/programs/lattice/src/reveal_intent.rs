use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};
use crate::constants::{POOL_SEED, PHASE_COMMIT, PHASE_REVEAL};
use crate::error::LatticeError;
use crate::state::BatchAuctionPool;

#[derive(Accounts)]
pub struct RevealIntent<'info> {
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
}

pub fn handler(
    ctx: Context<RevealIntent>,
    token_in:    Pubkey,
    token_out:   Pubkey,
    amount:      u64,
    limit_price: u64,
    salt:        [u8; 16],
) -> Result<()> {
    let current_slot = Clock::get()?.slot;
    let payer_key    = ctx.accounts.payer.key();

    let mut pool = ctx.accounts.pool.load_mut()?;

    // ── Phase auto-advance: Commit → Reveal ────────────────────────────────────
    if pool.phase == PHASE_COMMIT
        && current_slot >= pool.phase_start_slot + pool.batch_window_slots
    {
        pool.phase            = PHASE_REVEAL;
        pool.phase_start_slot = current_slot;
        msg!("Phase auto-advanced to Reveal at slot {}", current_slot);
    }

    require!(
        pool.is_reveal_window_open(current_slot),
        LatticeError::RevealWindowClosed
    );

    // ── Locate the matching commitment slot ────────────────────────────────────
    let slot_index = pool.orders[..pool.order_count as usize]
        .iter()
        .position(|o| o.payer == payer_key && o.revealed == 0)
        .ok_or(LatticeError::SlotEmpty)?;

    let order = &pool.orders[slot_index];
    require!(order.revealed == 0, LatticeError::AlreadyRevealed);

    // ── Recompute SHA-256 commitment and verify ────────────────────────────────
    // Preimage: SHA-256(token_in ‖ token_out ‖ amount_le8 ‖ limit_price_le8 ‖ salt_16)
    let mut hasher = Sha256::new();
    hasher.update(token_in.as_ref());
    hasher.update(token_out.as_ref());
    hasher.update(amount.to_le_bytes());
    hasher.update(limit_price.to_le_bytes());
    hasher.update(salt);
    let expected_hash: [u8; 32] = hasher.finalize().into();

    require!(expected_hash == order.commit_hash, LatticeError::HashMismatch);

    let is_buy = pool.orders[slot_index].is_buy;

    pool.orders[slot_index].limit_price = limit_price;
    pool.orders[slot_index].revealed    = 1;

    msg!(
        "RevealIntent verified: slot_index={} payer={} amount={} limit_price={} is_buy={}",
        slot_index,
        payer_key,
        amount,
        limit_price,
        is_buy != 0,
    );

    Ok(())
}
