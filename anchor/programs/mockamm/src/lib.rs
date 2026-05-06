use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("3pvvrgqoDHSPp9xRCK3Zdz4X88CqsEZxfeq5pfj3cUxC");

/// Constant-product AMM pool for the Sandwich Lab demo.
/// Implements x·y = k with no fees (for clarity of slippage measurement).
#[account]
pub struct AmmPool {
    pub reserve_in: u64,
    pub reserve_out: u64,
    pub bump: u8,
}

impl AmmPool {
    pub const LEN: usize = 8 + 8 + 8 + 1;

    /// Constant-product swap output: dy = y * dx / (x + dx).
    pub fn get_amount_out(&self, amount_in: u64) -> Option<u64> {
        let num = (self.reserve_out as u128).checked_mul(amount_in as u128)?;
        let den = (self.reserve_in as u128).checked_add(amount_in as u128)?;
        Some((num / den) as u64)
    }

    /// Execution price in units of reserve_out per reserve_in (scaled x 1e6).
    pub fn execution_price_bps(&self, amount_in: u64) -> u64 {
        let out = self.get_amount_out(amount_in).unwrap_or(0);
        if amount_in == 0 {
            return 0;
        }
        // slippage vs mid-price in bps
        let mid = self.reserve_out as u128 * 1_000_000 / self.reserve_in as u128;
        let exec = out as u128 * 1_000_000 / amount_in as u128;
        if exec >= mid {
            0
        } else {
            ((mid - exec) * 10_000 / mid) as u64
        }
    }
}

#[derive(Accounts)]
pub struct InitAmm<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = AmmPool::LEN, seeds = [b"amm_pool"], bump)]
    pub pool: Account<'info, AmmPool>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut, seeds = [b"amm_pool"], bump = pool.bump)]
    pub pool: Account<'info, AmmPool>,
    #[account(mut)]
    pub user_token_in: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_out: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_in: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_out: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[program]
pub mod mockamm {
    use super::*;

    pub fn initialize(ctx: Context<InitAmm>, reserve_in: u64, reserve_out: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.reserve_in = reserve_in;
        pool.reserve_out = reserve_out;
        pool.bump = ctx.bumps.pool;
        msg!("MockAMM initialized: reserve_in={} reserve_out={}", reserve_in, reserve_out);
        Ok(())
    }

    /// Execute a swap and log the slippage for the demo dashboard.
    pub fn swap(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        let slippage_bps = pool.execution_price_bps(amount_in);
        let amount_out = pool
            .get_amount_out(amount_in)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        require!(amount_out >= min_amount_out, MockAmmError::SlippageTooHigh);

        // Transfer token_in from user → vault_in.
        let cpi_in = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_in.to_account_info(),
                to: ctx.accounts.vault_in.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi_in, amount_in)?;

        // Transfer token_out from vault_out → user (pool is authority via PDA).
        let seeds = &[b"amm_pool".as_ref(), &[pool.bump]];
        let signer = &[&seeds[..]];
        let cpi_out = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_out.to_account_info(),
                to: ctx.accounts.user_token_out.to_account_info(),
                authority: pool.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi_out, amount_out)?;

        pool.reserve_in = pool.reserve_in.saturating_add(amount_in);
        pool.reserve_out = pool.reserve_out.saturating_sub(amount_out);

        msg!(
            "MockAMM swap: amount_in={} amount_out={} slippage_bps={}",
            amount_in,
            amount_out,
            slippage_bps,
        );

        Ok(())
    }
}

#[error_code]
pub enum MockAmmError {
    #[msg("Slippage too high — swap rejected")]
    SlippageTooHigh,
}
