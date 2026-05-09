use anchor_lang::prelude::*;
use crate::constants::{MAX_ORDERS, PHASE_COMMIT, PHASE_REVEAL};

// ── PoolPhase (kept as a typed enum for ergonomic comparisons) ───────────────
// Not stored directly in the zero-copy struct (uses u8 there), but used
// everywhere else in handler code.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PoolPhase {
    Commit,
    Reveal,
    Cleared,
}

impl PoolPhase {
    pub fn to_u8(self) -> u8 {
        match self {
            PoolPhase::Commit  => PHASE_COMMIT,
            PoolPhase::Reveal  => PHASE_REVEAL,
            PoolPhase::Cleared => 2,
        }
    }

    pub fn from_u8(v: u8) -> Self {
        match v {
            PHASE_COMMIT  => PoolPhase::Commit,
            PHASE_REVEAL  => PoolPhase::Reveal,
            _             => PoolPhase::Cleared,
        }
    }
}

// ── OrderSlot ────────────────────────────────────────────────────────────────
/// A single pending-order entry in the ring buffer.
///
/// Layout is `#[repr(C)]` for zero-copy safety.
/// Padding fields (`_padN`) ensure every field lands on its natural alignment
/// boundary so the struct is both `Pod` and `Zeroable`.
///
/// Size breakdown (repr C):
///   commit_hash [u8;32]  @  0 → 32
///   payer       Pubkey   @ 32 → 32  (total 64)
///   commit_slot u64      @ 64 → 8   (total 72)
///   amount      u64      @ 72 → 8   (total 80)
///   is_buy      u8       @ 80 → 1
///   _pad1       [u8;7]   @ 81 → 7   (align next u64 to 88)
///   limit_price u64      @ 88 → 8   (total 96)
///   revealed    u8       @ 96 → 1
///   filled      u8       @ 97 → 1
///   _pad2       [u8;6]   @ 98 → 6   (align next u64 to 104)
///   fill_amount u64      @104 → 8   (total 112)
///
/// Total: 112 bytes, alignment 8.
#[zero_copy]
#[derive(Debug)]
pub struct OrderSlot {
    pub commit_hash: [u8; 32],
    pub payer:       Pubkey,
    pub commit_slot: u64,
    pub amount:      u64,
    pub is_buy:      u8,
    pub _pad1:       [u8; 7],
    pub limit_price: u64,
    pub revealed:    u8,
    pub filled:      u8,
    pub _pad2:       [u8; 6],
    pub fill_amount: u64,
}

impl Default for OrderSlot {
    fn default() -> Self {
        // SAFETY: all-zeros is valid for every field (Zeroable).
        unsafe { std::mem::zeroed() }
    }
}

// ── BatchAuctionPool ─────────────────────────────────────────────────────────
/// Central pool PDA for one token-pair batch auction.
///
/// `#[account(zero_copy)]` means Anchor uses a raw bytemuck cast instead of
/// Borsh deserialization, saving ~300–500 CUs per instruction and allowing
/// the orders array to scale to MAX_ORDERS = 64 without stack-frame issues.
///
/// Account space: 8 (discriminator) + size_of::<BatchAuctionPool>()
///              = 8 + (128 + 64 × 112) = 8 + 7296 = 7304 bytes
///
/// Layout (repr C, 7296 bytes):
///   token_in_mint  Pubkey  @   0 → 32
///   token_out_mint Pubkey  @  32 → 32
///   phase          u8      @  64 → 1
///   _pad0          [u8;7]  @  65 → 7   (align to 72)
///   phase_start    u64     @  72 → 8
///   batch_window   u64     @  80 → 8
///   reveal_window  u64     @  88 → 8
///   order_count    u32     @  96 → 4
///   _pad1          [u8;4]  @ 100 → 4   (align to 104)
///   clearing_price u64     @ 104 → 8
///   matched_volume u64     @ 112 → 8
///   bump           u8      @ 120 → 1
///   _pad2          [u8;7]  @ 121 → 7   (align orders to 128)
///   orders [OrderSlot;64]  @ 128 → 7168
///   Total: 7296 bytes, alignment 8.
#[account(zero_copy)]
#[derive(Debug)]
pub struct BatchAuctionPool {
    pub token_in_mint:       Pubkey,
    pub token_out_mint:      Pubkey,
    /// Phase encoded as u8: 0=Commit, 1=Reveal, 2=Cleared.
    pub phase:               u8,
    pub _pad0:               [u8; 7],
    pub phase_start_slot:    u64,
    pub batch_window_slots:  u64,
    pub reveal_window_slots: u64,
    pub order_count:         u32,
    pub _pad1:               [u8; 4],
    pub clearing_price:      u64,
    pub matched_volume:      u64,
    pub bump:                u8,
    pub _pad2:               [u8; 7],
    pub orders:              [OrderSlot; MAX_ORDERS],
}

impl BatchAuctionPool {
    /// Account space including the 8-byte Anchor discriminator.
    pub const LEN: usize = 8 + std::mem::size_of::<BatchAuctionPool>();

    pub fn pool_phase(&self) -> PoolPhase {
        PoolPhase::from_u8(self.phase)
    }

    pub fn is_commit_window_open(&self, current_slot: u64) -> bool {
        self.phase == PHASE_COMMIT
            && current_slot < self.phase_start_slot + self.batch_window_slots
    }

    pub fn is_reveal_window_open(&self, current_slot: u64) -> bool {
        self.phase == PHASE_REVEAL
            && current_slot < self.phase_start_slot + self.reveal_window_slots
    }
}
