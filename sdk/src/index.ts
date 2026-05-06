/**
 * Lattice Anti-MEV DEX — TypeScript SDK
 *
 * A clean client wrapper around the Lattice Anchor program.
 * Program ID: AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV (Solana devnet)
 */

import * as crypto from "crypto";
import {
  Connection,
  PublicKey,
  SystemProgram,
  type ConfirmOptions,
} from "@solana/web3.js";
import {
  AnchorProvider,
  Program,
  BN,
  type Wallet,
  type Idl,
} from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Re-export Wallet so callers do not need to import it separately
export type { Wallet };

// ─── IDL import ──────────────────────────────────────────────────────────────

// We use `require` so that resolveJsonModule works at runtime and tsc is happy
// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL: Idl = require("../../anchor/target/idl/lattice.json") as Idl;

// ─── Constants ───────────────────────────────────────────────────────────────

/** On-chain program address */
export const PROGRAM_ID = new PublicKey(
  "AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV"
);

const POOL_SEED = Buffer.from("batch_pool");
const VAULT_SEED = Buffer.from("vault");

// ─── Types ───────────────────────────────────────────────────────────────────

/** On-chain PoolPhase enum — variants match the IDL */
export type PoolPhase =
  | { commit: Record<string, never> }
  | { reveal: Record<string, never> }
  | { cleared: Record<string, never> };

/** On-chain OrderSlot struct */
export interface OrderSlot {
  commitHash: number[];
  payer: PublicKey;
  commitSlot: BN;
  amount: BN;
  isBuy: boolean;
  limitPrice: BN;
  revealed: boolean;
  filled: boolean;
  fillAmount: BN;
}

/** On-chain BatchAuctionPool account */
export interface BatchAuctionPool {
  tokenInMint: PublicKey;
  tokenOutMint: PublicKey;
  phase: PoolPhase;
  phaseStartSlot: BN;
  batchWindowSlots: BN;
  revealWindowSlots: BN;
  orderCount: number;
  orders: OrderSlot[];
  clearingPrice: BN;
  matchedVolume: BN;
  bump: number;
}

/** Returned by `commit()` — store hash + salt and pass them to `reveal()` */
export interface CommitResult {
  txSig: string;
  commitHash: Buffer;
  salt: Buffer;
}

// ─── PDA helpers (top-level exports) ─────────────────────────────────────────

/**
 * Derive the pool PDA for a (tokenIn, tokenOut) pair.
 *
 * Seeds: `["batch_pool", tokenIn, tokenOut]`
 */
export function poolPDA(
  tokenIn: PublicKey,
  tokenOut: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, tokenIn.toBuffer(), tokenOut.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Derive the vault PDA for a pool + mint pair.
 *
 * Seeds: `["vault", pool, mint]`
 */
export function vaultPDA(
  pool: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, pool.toBuffer(), mint.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Build the commit hash:
 *
 *   `SHA-256(tokenIn || tokenOut || amount_le8 || limitPrice_le8 || salt_16)`
 *
 * @param tokenIn    32-byte public key of the input mint
 * @param tokenOut   32-byte public key of the output mint
 * @param amount     u64 swap amount (as {@link BN})
 * @param limitPrice u64 worst-acceptable price (as {@link BN})
 * @param salt       16-byte random buffer — generate with `crypto.randomBytes(16)`
 * @returns 32-byte SHA-256 digest as a {@link Buffer}
 */
export function makeCommitHash(
  tokenIn: PublicKey,
  tokenOut: PublicKey,
  amount: BN,
  limitPrice: BN,
  salt: Buffer
): Buffer {
  if (salt.length !== 16) {
    throw new Error(`salt must be exactly 16 bytes, got ${salt.length}`);
  }

  const amountBuf = bnToLeBuffer(amount, 8);
  const limitBuf = bnToLeBuffer(limitPrice, 8);

  const preimage = Buffer.concat([
    tokenIn.toBuffer(),   // 32 bytes
    tokenOut.toBuffer(),  // 32 bytes
    amountBuf,            //  8 bytes (little-endian u64)
    limitBuf,             //  8 bytes (little-endian u64)
    salt,                 // 16 bytes
  ]);

  return Buffer.from(crypto.createHash("sha256").update(preimage).digest());
}

/** Serialise a BN as a fixed-length little-endian buffer */
function bnToLeBuffer(value: BN, byteLength: number): Buffer {
  return value.toArrayLike(Buffer, "le", byteLength);
}

// ─── LatticeClient ───────────────────────────────────────────────────────────

export class LatticeClient {
  /** Underlying Anchor provider */
  readonly provider: AnchorProvider;
  private readonly program: Program<Idl>;

  /**
   * @param connection Solana {@link Connection}
   * @param wallet     A wallet that can sign transactions (e.g. from `@solana/wallet-adapter`)
   * @param opts       Optional commitment level
   */
  constructor(
    connection: Connection,
    wallet: Wallet,
    opts?: { commitment?: ConfirmOptions["commitment"] }
  ) {
    const confirmOpts: ConfirmOptions = opts?.commitment
      ? { commitment: opts.commitment }
      : AnchorProvider.defaultOptions();

    this.provider = new AnchorProvider(connection, wallet, confirmOpts);
    // Cast through unknown to suppress the deep-instantiation lint; the IDL
    // is validated at runtime by Anchor's own deserialiser.
    this.program = new Program(IDL, this.provider) as unknown as Program<Idl>;
  }

  // ── Pool initialisation ──────────────────────────────────────────────────

  /**
   * Initialize a new batch-auction pool for a token pair.
   *
   * @param tokenIn            Mint of the token traders will offer
   * @param tokenOut           Mint of the token traders want to receive
   * @param commitWindowSlots  Number of slots in the commit phase
   * @param revealWindowSlots  Number of slots in the reveal phase
   * @returns Transaction signature
   */
  async initPool(
    tokenIn: PublicKey,
    tokenOut: PublicKey,
    commitWindowSlots: number | BN,
    revealWindowSlots: number | BN
  ): Promise<string> {
    const [pool] = poolPDA(tokenIn, tokenOut);

    const txSig: string = await this.program.methods
      .initializePool(
        new BN(commitWindowSlots.toString()),
        new BN(revealWindowSlots.toString())
      )
      .accounts({
        authority: this.provider.wallet.publicKey,
        pool,
        tokenInMint: tokenIn,
        tokenOutMint: tokenOut,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return txSig;
  }

  // ── Commit ───────────────────────────────────────────────────────────────

  /**
   * Submit a commit for a swap intent.
   *
   * A fresh 16-byte salt is generated internally; the commit hash is computed
   * as `SHA-256(tokenIn || tokenOut || amount_le8 || limitPrice_le8 || salt_16)`.
   * **Store the returned `commitHash` and `salt`** — both are required for the
   * subsequent `reveal()` call.
   *
   * @param pool        Pool PDA
   * @param tokenIn     Mint of the input token
   * @param vault       Vault PDA for (pool, tokenIn) — use {@link vaultPDA}
   * @param payerAta    Payer's associated token account for `tokenIn`
   * @param amount      u64 amount to swap
   * @param limitPrice  u64 worst-acceptable price
   * @param isBuy       `true` if buying `tokenOut`, `false` if selling `tokenIn`
   * @returns `{ txSig, commitHash, salt }`
   */
  async commit(
    pool: PublicKey,
    tokenIn: PublicKey,
    vault: PublicKey,
    payerAta: PublicKey,
    amount: BN,
    limitPrice: BN,
    isBuy: boolean
  ): Promise<CommitResult> {
    // Fetch pool to get the tokenOut mint for the hash preimage
    const poolState = await this.fetchPool(pool);
    const tokenOut = poolState.tokenOutMint;

    // Fresh random salt
    const salt = Buffer.from(crypto.randomBytes(16));
    const commitHash = makeCommitHash(tokenIn, tokenOut, amount, limitPrice, salt);

    const txSig: string = await this.program.methods
      .commitIntent(
        Array.from(commitHash),
        amount,
        isBuy
      )
      .accounts({
        payer: this.provider.wallet.publicKey,
        pool,
        payerTokenAccount: payerAta,
        mint: tokenIn,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { txSig, commitHash, salt };
  }

  // ── Reveal ───────────────────────────────────────────────────────────────

  /**
   * Reveal a previously committed swap intent.
   *
   * Must be called with the same parameters that produced the original commit
   * hash.  The on-chain program re-derives the hash and verifies it against the
   * stored commitment.
   *
   * @param pool        Pool PDA
   * @param tokenIn     Mint of the input token (same as at commit time)
   * @param tokenOut    Mint of the output token (same as at commit time)
   * @param amount      u64 amount (same as at commit time)
   * @param limitPrice  u64 limit price (same as at commit time)
   * @param salt        16-byte salt returned by `commit()`
   * @returns Transaction signature
   */
  async reveal(
    pool: PublicKey,
    tokenIn: PublicKey,
    tokenOut: PublicKey,
    amount: BN,
    limitPrice: BN,
    salt: Buffer
  ): Promise<string> {
    const txSig: string = await this.program.methods
      .revealIntent(
        tokenIn,
        tokenOut,
        amount,
        limitPrice,
        Array.from(salt)
      )
      .accounts({
        payer: this.provider.wallet.publicKey,
        pool,
      })
      .rpc();

    return txSig;
  }

  // ── Clear batch ──────────────────────────────────────────────────────────

  /**
   * Trigger batch clearing once the reveal window has closed.
   *
   * @param pool Pool PDA
   * @returns Transaction signature
   */
  async clearBatch(pool: PublicKey): Promise<string> {
    const txSig: string = await this.program.methods
      .clearBatch()
      .accounts({
        pool,
        caller: this.provider.wallet.publicKey,
      })
      .rpc();

    return txSig;
  }

  // ── Account fetch ────────────────────────────────────────────────────────

  /**
   * Fetch and decode the on-chain `BatchAuctionPool` account.
   *
   * @param pool Pool PDA
   * @returns Decoded {@link BatchAuctionPool}
   */
  async fetchPool(pool: PublicKey): Promise<BatchAuctionPool> {
    // AccountNamespace<Idl> is keyed by the IDL account names at the type level;
    // we access it dynamically and cast to avoid the strict index-signature error.
    const ns = this.program.account as unknown as Record<
      string,
      { fetch(address: PublicKey): Promise<unknown> }
    >;
    const raw = await ns["batchAuctionPool"].fetch(pool);
    return raw as BatchAuctionPool;
  }
}
