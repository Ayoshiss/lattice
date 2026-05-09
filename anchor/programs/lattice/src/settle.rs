use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::{POOL_SEED, VAULT_SEED, PHASE_COMMIT, PHASE_CLEARED};
use crate::error::LatticeError;
use crate::state::BatchAuctionPool;

/// Settle: executes SPL Token CPI transfers for all filled and unfilled orders,
/// then resets the pool for the next batch.
///
/// Accounts layout:
///   0  pool            (mut, zero-copy AccountLoader)
///   1  token_in_vault  (mut, PDA — holds buy-side locked token_in)
///   2  token_out_vault (mut, PDA — holds sell-side locked token_out)
///   3  token_program
///   4  caller          (signer)
///   5  token_in_mint   (for pool PDA seed derivation)
///   6  token_out_mint  (for pool PDA seed derivation)
///   remaining_accounts — one writable TokenAccount per order slot (index 0..order_count),
///                         in exact pool.orders order:
///                           filled buy    → payer's token_out ATA
///                           filled sell   → payer's token_in  ATA
///                           unfilled buy  → payer's token_in  ATA  (refund)
///                           unfilled sell → payer's token_out ATA  (refund)
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, token_in_mint.key().as_ref(), token_out_mint.key().as_ref()],
        bump,
    )]
    pub pool: AccountLoader<'info, BatchAuctionPool>,

    /// Vault holding all committed token_in (from buy orders).
    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref(), token_in_mint.key().as_ref()],
        bump,
        token::mint      = token_in_mint,
        token::authority = pool,
    )]
    pub token_in_vault: Account<'info, TokenAccount>,

    /// Vault holding all committed token_out (from sell orders).
    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref(), token_out_mint.key().as_ref()],
        bump,
        token::mint      = token_out_mint,
        token::authority = pool,
    )]
    pub token_out_vault: Account<'info, TokenAccount>,

    /// CHECK: used in pool + vault PDA seed derivation.
    pub token_in_mint:  UncheckedAccount<'info>,
    /// CHECK: used in pool + vault PDA seed derivation.
    pub token_out_mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,

    pub caller: Signer<'info>,
    // remaining_accounts: writable ATA per order (see doc above)
}

pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, Settle<'info>>) -> Result<()> {
    // ── Snapshot everything we need from pool before any CPIs ─────────────────
    let order_count: usize;
    let clearing_price: u64;
    let pool_bump: u8;

    #[derive(Clone)]
    struct SlotSnap {
        payer:       Pubkey,
        amount:      u64,
        is_buy:      bool,
        filled:      bool,
        fill_amount: u64,
    }
    let orders_snap: Vec<SlotSnap>;

    {
        let pool = ctx.accounts.pool.load()?;
        require!(
            pool.phase == PHASE_CLEARED && pool.clearing_price > 0,
            LatticeError::BatchNotCleared
        );
        order_count    = pool.order_count as usize;
        clearing_price = pool.clearing_price;
        pool_bump      = pool.bump;
        orders_snap = pool.orders[..order_count]
            .iter()
            .map(|o| SlotSnap {
                payer:       o.payer,
                amount:      o.amount,
                is_buy:      o.is_buy != 0,
                filled:      o.filled != 0,
                fill_amount: o.fill_amount,
            })
            .collect();
    }

    require!(
        ctx.remaining_accounts.len() >= order_count,
        LatticeError::SlotEmpty
    );

    // ── Build pool signer seeds ────────────────────────────────────────────────
    let token_in_key  = ctx.accounts.token_in_mint.key();
    let token_out_key = ctx.accounts.token_out_mint.key();
    let pool_seeds: &[&[u8]] = &[
        POOL_SEED,
        token_in_key.as_ref(),
        token_out_key.as_ref(),
        &[pool_bump],
    ];
    let signer_seeds = &[pool_seeds];

    let token_in_vault_info  = ctx.accounts.token_in_vault.to_account_info();
    let token_out_vault_info = ctx.accounts.token_out_vault.to_account_info();
    let pool_info            = ctx.accounts.pool.to_account_info();
    let token_program_info   = ctx.accounts.token_program.to_account_info();

    let mut filled_count: u32 = 0;
    let mut refund_count: u32 = 0;

    for (i, slot) in orders_snap.iter().enumerate() {
        if slot.payer == Pubkey::default() {
            continue; // slashed slot — skip
        }
        let recipient_info = &ctx.remaining_accounts[i];

        if slot.filled {
            // ── Deliver output token to payer ──────────────────────────────────
            // Batch auction uniform-price settlement:
            //   • Buy  order: locked token_in → receives token_out
            //                 out_amount = fill_amount / clearing_price
            //   • Sell order: locked token_out → receives token_in
            //                 in_amount  = fill_amount * clearing_price
            //
            // Integer-division dust stays in vault as protocol surplus (Day 2: sweep).
            let (src_vault, transfer_amount) = if slot.is_buy {
                let out_amount = slot.fill_amount.checked_div(clearing_price).unwrap_or(0);
                (token_out_vault_info.clone(), out_amount)
            } else {
                let in_amount = slot.fill_amount.saturating_mul(clearing_price);
                (token_in_vault_info.clone(), in_amount)
            };

            if transfer_amount > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        token_program_info.clone(),
                        Transfer {
                            from:      src_vault,
                            to:        recipient_info.clone(),
                            authority: pool_info.clone(),
                        },
                        signer_seeds,
                    ),
                    transfer_amount,
                )?;
            }
            filled_count += 1;
        } else {
            // ── Refund locked tokens to payer ──────────────────────────────────
            let (src_vault, refund_amount) = if slot.is_buy {
                (token_in_vault_info.clone(), slot.amount)
            } else {
                (token_out_vault_info.clone(), slot.amount)
            };

            if refund_amount > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        token_program_info.clone(),
                        Transfer {
                            from:      src_vault,
                            to:        recipient_info.clone(),
                            authority: pool_info.clone(),
                        },
                        signer_seeds,
                    ),
                    refund_amount,
                )?;
            }
            refund_count += 1;
        }
    }

    msg!(
        "Settle: clearing_price={} filled={} refunded={}",
        clearing_price, filled_count, refund_count,
    );

    // ── Reset pool for the next batch ─────────────────────────────────────────
    let mut pool          = ctx.accounts.pool.load_mut()?;
    pool.phase            = PHASE_COMMIT;
    pool.phase_start_slot = Clock::get()?.slot;
    pool.order_count      = 0;
    pool.clearing_price   = 0;
    pool.matched_volume   = 0;
    for slot in pool.orders.iter_mut() {
        *slot = Default::default();
    }

    Ok(())
}
