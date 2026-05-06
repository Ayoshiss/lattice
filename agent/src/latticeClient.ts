/**
 * Lattice on-chain client for the agent.
 * Builds serialised CommitIntent transactions ready to be sent to the relay.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  createMint,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export const DEVNET_RPC   = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
export const PROGRAM_ID   = new PublicKey("AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV");
export const POOL_SEED    = Buffer.from("batch_pool");
export const VAULT_SEED   = Buffer.from("vault");

const IDL_PATH = path.resolve(__dirname, "../../anchor/target/idl/lattice.json");

export function loadIdl() {
  return JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
}

export function loadKeypair(jsonPath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function poolPDA(tokenIn: PublicKey, tokenOut: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, tokenIn.toBuffer(), tokenOut.toBuffer()],
    PROGRAM_ID
  );
}

export function vaultPDA(pool: PublicKey, mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, pool.toBuffer(), mint.toBuffer()],
    PROGRAM_ID
  );
}

export interface CommitParams {
  payer:        Keypair;
  pool:         PublicKey;
  tokenIn:      PublicKey;
  vault:        PublicKey;
  payerAta:     PublicKey;
  commitHash:   number[];   // 32 bytes
  amount:       anchor.BN;
  isBuy:        boolean;
}

/** Build and sign a CommitIntent tx. Returns base64 wire bytes. */
export async function buildCommitTx(
  connection: Connection,
  params: CommitParams
): Promise<string> {
  const idl = loadIdl();
  const wallet = {
    publicKey: params.payer.publicKey,
    signTransaction: async (tx: Transaction) => {
      tx.partialSign(params.payer);
      return tx;
    },
    signAllTransactions: async (txs: Transaction[]) => {
      txs.forEach((t) => t.partialSign(params.payer));
      return txs;
    },
  };

  const provider = new anchor.AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
  const program = new anchor.Program(idl, provider);

  const tx = await program.methods
    .commitIntent(params.commitHash, params.amount, params.isBuy)
    .accounts({
      payer:             params.payer.publicKey,
      pool:              params.pool,
      payerTokenAccount: params.payerAta,
      mint:              params.tokenIn,
      vault:             params.vault,
      tokenProgram:      TOKEN_PROGRAM_ID,
      systemProgram:     SystemProgram.programId,
    })
    .transaction();

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = params.payer.publicKey;
  tx.sign(params.payer);

  return tx.serialize().toString("base64");
}

/**
 * Derive a SHA-256 commit hash.
 * Mirrors the on-chain: sha256(tokenIn || tokenOut || amount_le8 || limitPrice_le8 || salt)
 */
export function makeCommitHash(opts: {
  tokenIn:    PublicKey;
  tokenOut:   PublicKey;
  amount:     anchor.BN;
  limitPrice: anchor.BN;
  salt:       Buffer;      // 16 bytes
}): { hash: number[]; salt: Buffer } {
  const h = crypto.createHash("sha256");
  h.update(opts.tokenIn.toBuffer());
  h.update(opts.tokenOut.toBuffer());
  h.update(opts.amount.toArrayLike(Buffer, "le", 8));
  h.update(opts.limitPrice.toArrayLike(Buffer, "le", 8));
  h.update(opts.salt);
  return { hash: Array.from(h.digest()), salt: opts.salt };
}

/** Convenience: airdrop if balance < minLamports. */
export async function ensureFunded(
  connection: Connection,
  pubkey: PublicKey,
  minLamports = 100_000_000
) {
  const bal = await connection.getBalance(pubkey);
  if (bal < minLamports) {
    console.log(`[latticeClient] airdropping to ${pubkey.toBase58()}…`);
    try {
      const sig = await connection.requestAirdrop(pubkey, 1_000_000_000);
      await connection.confirmTransaction(sig, "confirmed");
    } catch {
      console.warn("[latticeClient] airdrop failed — ensure wallet is funded");
    }
  }
}
