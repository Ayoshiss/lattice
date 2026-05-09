use anchor_lang::prelude::*;

#[constant]
pub const POOL_SEED: &[u8] = b"batch_pool";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

/// Maximum orders in the ring buffer.
/// Upgraded from 8 → 64: safe now that BatchAuctionPool uses
/// #[account(zero_copy)] + bytemuck — deserialization is a raw memcpy,
/// so there is no Borsh stack-frame blowout and the extra 56 slots cost
/// only ~6 KiB of account space.
pub const MAX_ORDERS: usize = 64;

/// Default commit window in slots (~2 s on devnet at 400 ms/slot).
pub const DEFAULT_COMMIT_WINDOW_SLOTS: u64 = 5;

/// Default reveal window in slots.
pub const DEFAULT_REVEAL_WINDOW_SLOTS: u64 = 5;

/// Slash penalty in lamports for failing to reveal (anti-spam deterrent).
pub const SLASH_LAMPORTS: u64 = 1_000_000; // 0.001 SOL

// ── Pool-phase constants (u8 instead of enum to satisfy bytemuck::Pod) ────────
pub const PHASE_COMMIT:  u8 = 0;
pub const PHASE_REVEAL:  u8 = 1;
pub const PHASE_CLEARED: u8 = 2;
