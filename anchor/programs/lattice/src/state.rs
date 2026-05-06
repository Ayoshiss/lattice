use anchor_lang::prelude::*;
use crate::constants::MAX_ORDERS;

/// Phase of the batch auction state machine.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PoolPhase {
    Commit,
    Reveal,
    Cleared,
}

/// A single pending order slot in the ring buffer.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct OrderSlot {
    /// SHA-256 commitment hash (32 bytes).
    pub commit_hash: [u8; 32],
    /// Payer / trader public key.
    pub payer: Pubkey,
    /// Slot at which this intent was committed (for slash timeout).
    pub commit_slot: u64,
    /// Locked token amount in base units.
    pub amount: u64,
    /// True = buy order, False = sell order.
    pub is_buy: bool,

    // --- Filled on reveal ---
    pub limit_price: u64,
    pub revealed: bool,

    // --- Filled on clear/settle ---
    pub filled: bool,
    pub fill_amount: u64,
}

/// The central pool account for a single token-pair batch auction.
///
/// Uses standard Anchor serialization (not zero_copy) for Day 0 correctness;
/// will be converted to zero_copy in the compute-optimization pass on Day 2.
#[account]
#[derive(Debug)]
pub struct BatchAuctionPool {
    pub token_in_mint: Pubkey,
    pub token_out_mint: Pubkey,

    /// Current phase of the auction state machine.
    pub phase: PoolPhase,

    /// Slot at which the current commit window opened.
    pub phase_start_slot: u64,

    /// Duration of the commit window in slots.
    pub batch_window_slots: u64,

    /// Duration of the reveal window in slots.
    pub reveal_window_slots: u64,

    /// Number of occupied slots in `orders`.
    pub order_count: u32,

    /// Ring buffer of pending orders.
    pub orders: [OrderSlot; MAX_ORDERS],

    /// Discovered clearing price (set by ClearBatch, read by Settle).
    pub clearing_price: u64,

    /// Total matched buy volume at clearing price.
    pub matched_volume: u64,

    /// Bump seed for PDA derivation.
    pub bump: u8,
}

impl BatchAuctionPool {
    /// Anchor space calculation.
    pub const LEN: usize = 8  // discriminator
        + 32 + 32             // mints
        + 1                   // phase
        + 8 + 8 + 8           // slot fields
        + 4                   // order_count
        + (MAX_ORDERS * std::mem::size_of::<OrderSlot>()) // orders
        + 8 + 8               // clearing_price, matched_volume
        + 1;                  // bump

    pub fn is_commit_window_open(&self, current_slot: u64) -> bool {
        self.phase == PoolPhase::Commit
            && current_slot < self.phase_start_slot + self.batch_window_slots
    }

    pub fn is_reveal_window_open(&self, current_slot: u64) -> bool {
        self.phase == PoolPhase::Reveal
            && current_slot < self.phase_start_slot + self.reveal_window_slots
    }
}
