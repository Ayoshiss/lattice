use anchor_lang::prelude::*;

#[error_code]
pub enum LatticeError {
    #[msg("Commit window is closed — pool is in reveal phase")]
    CommitWindowClosed,

    #[msg("Reveal window is closed — pool is in commit phase")]
    RevealWindowClosed,

    #[msg("Batch clearing has not started yet")]
    BatchNotCleared,

    #[msg("Commitment hash mismatch — reveal does not match commit")]
    HashMismatch,

    #[msg("Intent slot is already revealed")]
    AlreadyRevealed,

    #[msg("Intent slot was never committed, or insufficient remaining_accounts")]
    SlotEmpty,

    #[msg("Order book is full — max pending orders reached")]
    OrderBookFull,

    #[msg("Batch has already been cleared")]
    AlreadyCleared,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("No crossing orders — batch cannot clear")]
    NoCross,

    #[msg("Slash window has not opened yet — reveal window still active")]
    SlashTooEarly,
}
