/**
 * Lattice SDK — commit/reveal helpers for the Anchor program.
 * Used by both tests and the relay server.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { createHash, randomBytes } from "crypto";

// ── IDL placeholder (will be replaced by generated IDL on Day 2) ─────────────
// For now, just re-export helpers — the tests import the IDL directly.

// ── Constants ─────────────────────────────────────────────────────────────────
export const POOL_SEED = Buffer.from("batch_pool");
export const VAULT_SEED = Buffer.from("vault");
export const LATTICE_PROGRAM_ID = new PublicKey(
  "AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV"
);

// ── Hashing (must match Rust SHA-256 preimage exactly) ───────────────────────
export interface OrderParams {
  tokenIn: PublicKey;
  tokenOut: PublicKey;
  amount: BN;
  limitPrice: BN;
  salt: Buffer; // 16 bytes
}

export function buildCommitHash(order: OrderParams): Buffer {
  const h = createHash("sha256");
  h.update(order.tokenIn.toBuffer());
  h.update(order.tokenOut.toBuffer());
  h.update(order.amount.toArrayLike(Buffer, "le", 8));
  h.update(order.limitPrice.toArrayLike(Buffer, "le", 8));
  h.update(order.salt);
  return h.digest();
}

export function randomSalt(): Buffer {
  return randomBytes(16);
}

// ── PDA derivation ────────────────────────────────────────────────────────────
export function poolPDA(
  tokenIn: PublicKey,
  tokenOut: PublicKey,
  programId = LATTICE_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, tokenIn.toBuffer(), tokenOut.toBuffer()],
    programId
  );
}

export function vaultPDA(
  pool: PublicKey,
  mint: PublicKey,
  programId = LATTICE_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, pool.toBuffer(), mint.toBuffer()],
    programId
  );
}

// ── Token helpers ─────────────────────────────────────────────────────────────
export async function createTestMint(
  connection: Connection,
  payer: Keypair,
  decimals = 6
): Promise<PublicKey> {
  return createMint(connection, payer, payer.publicKey, null, decimals);
}

export async function createFundedTokenAccount(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint
): Promise<PublicKey> {
  const ata = await createAccount(connection, payer, mint, owner);
  await mintTo(connection, payer, mint, ata, payer, amount);
  return ata;
}
