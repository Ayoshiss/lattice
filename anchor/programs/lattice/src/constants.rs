use anchor_lang::prelude::*;

#[constant]
pub const POOL_SEED: &[u8] = b"batch_pool";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

/// Maximum number of pending orders in the ring buffer.
/// Kept at 8 to stay within the BPF 4096-byte stack frame limit during
/// Borsh deserialisation (full 64-slot version requires zero_copy, Day 2).
pub const MAX_ORDERS: usize = 8;

/// Default commit window in slots (~2s on devnet at ~400ms/slot).
pub const DEFAULT_COMMIT_WINDOW_SLOTS: u64 = 5;

/// Default reveal window in slots.
pub const DEFAULT_REVEAL_WINDOW_SLOTS: u64 = 5;

/// Slash penalty in lamports for failing to reveal (deter spam).
pub const SLASH_LAMPORTS: u64 = 1_000_000; // 0.001 SOL
