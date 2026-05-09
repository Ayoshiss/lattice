use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod state;

pub mod initialize_pool;
pub mod commit_intent;
pub mod reveal_intent;
pub mod clear_batch;
pub mod settle;
pub mod slash_unrevealed;

pub use initialize_pool::*;
pub use commit_intent::*;
pub use reveal_intent::*;
pub use clear_batch::*;
pub use settle::*;
pub use slash_unrevealed::*;

declare_id!("AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV");

#[program]
pub mod lattice {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        batch_window_slots:  u64,
        reveal_window_slots: u64,
    ) -> Result<()> {
        initialize_pool::handler(ctx, batch_window_slots, reveal_window_slots)
    }

    pub fn commit_intent(
        ctx: Context<CommitIntent>,
        commit_hash: [u8; 32],
        amount: u64,
        is_buy: bool,
    ) -> Result<()> {
        commit_intent::handler(ctx, commit_hash, amount, is_buy)
    }

    pub fn reveal_intent(
        ctx: Context<RevealIntent>,
        token_in:    Pubkey,
        token_out:   Pubkey,
        amount:      u64,
        limit_price: u64,
        salt:        [u8; 16],
    ) -> Result<()> {
        reveal_intent::handler(ctx, token_in, token_out, amount, limit_price, salt)
    }

    pub fn clear_batch(ctx: Context<ClearBatch>) -> Result<()> {
        clear_batch::handler(ctx)
    }

    pub fn settle<'info>(ctx: Context<'_, '_, '_, 'info, Settle<'info>>) -> Result<()> {
        settle::handler(ctx)
    }

    pub fn slash_unrevealed(ctx: Context<SlashUnrevealed>, slot_index: u32) -> Result<()> {
        slash_unrevealed::handler(ctx, slot_index)
    }
}
