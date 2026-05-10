/**
 * setup-demo.ts — persistent demo environment setup
 *
 * Creates static keypairs for the Demo User and Ghost Market-Maker, a
 * persistent tokenIn mint, and pre-funds the Demo User's ATA with
 * 1,000,000 mock tokens.  All addresses + secret keys are written to
 * web/.env.local so demo.tsx and api/agent/run.ts never touch
 * createMint / mintTo at auction time.
 *
 * Run once (or any time you need to top-up / rotate keys):
 *   node --experimental-strip-types web/scripts/setup-demo.ts
 *   yarn workspace web setup:demo
 *
 * Idempotent: reuses existing keypairs and mints; only tops up balances.
 *
 * Architecture note
 * ─────────────────
 * tokenIn  = PERSISTENT  (same mint every run, Demo User ATA pre-funded)
 * tokenOut = FRESH per run  (unique pool PDA each run; `initializePool`
 *            uses `init`, not `init_if_needed`, so it can only be called
 *            once per (tokenIn, tokenOut) pair.  Fresh tokenOut is a
 *            single createMint — no mintTo race — Ghost MM ATA is funded
 *            BEFORE its commitIntent with confirmTransaction("confirmed").)
 */

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

// ── Config ────────────────────────────────────────────────────────────────────
const DEVNET_RPC    = "https://api.devnet.solana.com";
const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE      = path.resolve(__dirname, "../.env.local");

// Infrastructure payer that funds everything — deterministic seed, pre-funded
const INFRA_SEED    = new Uint8Array(32).fill(11);

// Pre-fund each demo wallet with this much SOL (covers ~3 runs at ~0.056 SOL/run)
const SOL_PER_WALLET = 0.2 * LAMPORTS_PER_SOL;

// tokenIn ATA target balance (1,000,000 tokens × 10⁶ decimals)
const TARGET_TOKEN_BALANCE = BigInt(1_000_000_000_000);
// Re-fund if below 1,000 tokens
const MIN_TOKEN_BALANCE    = BigInt(1_000_000_000);

// ── Env helpers ──────────────────────────────────────────────────────────────
function readEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_FILE)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

function writeEnv(vars: Record<string, string>): void {
  const merged = { ...readEnv(), ...vars };
  fs.writeFileSync(
    ENV_FILE,
    Object.entries(merged).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
    "utf8",
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function ensureAirdrop(
  connection: Connection,
  infra: Keypair,
  minSol: number,
): Promise<void> {
  const bal = await connection.getBalance(infra.publicKey);
  if (bal >= minSol * LAMPORTS_PER_SOL) {
    console.log(`  infra SOL: ${(bal / LAMPORTS_PER_SOL).toFixed(3)} ✓`);
    return;
  }
  console.log(`  infra SOL low (${(bal / LAMPORTS_PER_SOL).toFixed(3)}) — requesting airdrop…`);
  try {
    const sig = await connection.requestAirdrop(infra.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    const after = await connection.getBalance(infra.publicKey);
    console.log(`  infra SOL after airdrop: ${(after / LAMPORTS_PER_SOL).toFixed(3)}`);
  } catch (e: any) {
    console.warn(`  airdrop rate-limited: ${e.message}`);
  }
}

/** Load a keypair from a JSON-array secret key string, or generate a new one. */
function loadOrGenKeypair(secretKeyJson: string | undefined, label: string): Keypair {
  if (secretKeyJson) {
    try {
      const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKeyJson)));
      console.log(`  ${label}: reusing ${kp.publicKey.toBase58().slice(0, 20)}…`);
      return kp;
    } catch {
      console.warn(`  ${label}: invalid secret key in env — regenerating`);
    }
  }
  const kp = Keypair.generate();
  console.log(`  ${label}: generated ${kp.publicKey.toBase58()}`);
  return kp;
}

/** Ensure a wallet has at least `targetLamports` SOL.
 *  First tries infra transfer; if infra balance is too low, falls back to
 *  a direct devnet airdrop on the wallet (1 SOL max per airdrop). */
async function ensureSol(
  connection: Connection,
  infra: Keypair,
  wallet: Keypair,
  targetLamports: number,
  label: string,
): Promise<void> {
  const bal = await connection.getBalance(wallet.publicKey);
  if (bal >= targetLamports) {
    console.log(`  ${label} SOL: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} ✓`);
    return;
  }
  const needed = targetLamports - bal;
  const infraBal = await connection.getBalance(infra.publicKey);
  const TX_FEE_BUFFER = 10_000; // lamports buffer for tx fees

  if (infraBal >= needed + TX_FEE_BUFFER) {
    console.log(`  ${label} SOL: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} — topping up ${(needed / LAMPORTS_PER_SOL).toFixed(4)} SOL from infra…`);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: infra.publicKey,
        toPubkey:   wallet.publicKey,
        lamports:   needed,
      }),
    );
    await sendAndConfirmTransaction(connection, tx, [infra], { commitment: "confirmed" });
    const after = await connection.getBalance(wallet.publicKey);
    console.log(`  ${label} SOL after: ${(after / LAMPORTS_PER_SOL).toFixed(4)} ✓`);
  } else {
    console.log(`  ${label} SOL: infra insufficient — requesting airdrop directly to ${label}…`);
    try {
      const sig = await connection.requestAirdrop(wallet.publicKey, 1 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
      const after = await connection.getBalance(wallet.publicKey);
      console.log(`  ${label} SOL after airdrop: ${(after / LAMPORTS_PER_SOL).toFixed(4)} ✓`);
    } catch (e: any) {
      console.warn(`  ${label} airdrop failed: ${e.message}`);
      console.warn(`  Manual top-up needed: solana airdrop 1 ${wallet.publicKey.toBase58()} --url devnet`);
    }
  }
}

async function ensureTokenInMint(
  connection: Connection,
  infra: Keypair,
  existing: string | undefined,
): Promise<PublicKey> {
  if (existing) {
    try {
      const info = await connection.getAccountInfo(new PublicKey(existing));
      if (info) {
        console.log(`  tokenIn mint: reusing ${existing.slice(0, 20)}…`);
        return new PublicKey(existing);
      }
    } catch { /* fall through */ }
    console.log("  tokenIn mint: not found on devnet — creating new one");
  }
  console.log("  tokenIn mint: creating…");
  const mint = await createMint(connection, infra, infra.publicKey, null, 6);
  console.log(`  tokenIn mint: ${mint.toBase58()}`);
  return mint;
}

async function ensureTokenBalance(
  connection: Connection,
  infra: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  label: string,
): Promise<void> {
  const ataInfo = await getOrCreateAssociatedTokenAccount(
    connection, infra, mint, owner,
    false, "confirmed", { preflightCommitment: "confirmed" },
  );

  let balance: bigint;
  try {
    balance = (await getAccount(connection, ataInfo.address, "confirmed")).amount;
  } catch {
    balance = BigInt(0);
  }

  console.log(`  ${label} ATA: ${ataInfo.address.toBase58().slice(0, 20)}… | ${balance.toLocaleString()} raw`);

  if (balance >= MIN_TOKEN_BALANCE) {
    console.log(`  ${label}: token balance sufficient ✓`);
    return;
  }

  const topup = TARGET_TOKEN_BALANCE - balance;
  console.log(`  ${label}: minting ${topup.toLocaleString()} raw tokens…`);
  const sig = await mintTo(connection, infra, mint, ataInfo.address, infra, topup);
  await connection.confirmTransaction(sig, "confirmed");
  const after = (await getAccount(connection, ataInfo.address, "confirmed")).amount;
  console.log(`  ${label}: new balance ${after.toLocaleString()} raw ✓`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n── Lattice Demo Setup ──────────────────────────────────────────");
  console.log("  tokenIn:  PERSISTENT (pre-funded Demo User ATA, no hot-path minting)");
  console.log("  tokenOut: FRESH per run (created at run time; unique pool PDA each run)");
  console.log("  pool:     FRESH per run (~0.056 SOL rent+fees/run; 0.5 SOL wallet covers ~8 runs)");
  console.log();

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const infra      = Keypair.fromSeed(INFRA_SEED);
  const env        = readEnv();

  console.log(`Infra payer: ${infra.publicKey.toBase58()}`);

  // 1. Ensure infra has SOL
  console.log("\n[1/5] Infra SOL…");
  await ensureAirdrop(connection, infra, 0.5);

  // 2. Load or generate Demo User + Ghost MM keypairs
  console.log("\n[2/5] Demo keypairs…");
  const demoUser = loadOrGenKeypair(env["NEXT_PUBLIC_DEMO_USER_SECRET_KEY"], "Demo User");
  const ghostMM  = loadOrGenKeypair(env["NEXT_PUBLIC_DEMO_MM_SECRET_KEY"],  "Ghost MM ");

  // 3. Fund both wallets with SOL for tx fees
  // - Each demo run creates a fresh pool PDA (~0.051 SOL rent); 1 SOL covers ~17 runs.
  console.log("\n[3/5] SOL for tx fees…");
  await ensureSol(connection, infra, demoUser, SOL_PER_WALLET, "Demo User");
  await ensureSol(connection, infra, ghostMM,  SOL_PER_WALLET, "Ghost MM ");

  // 4. tokenIn mint + Demo User ATA
  console.log("\n[4/5] tokenIn mint + Demo User ATA…");
  const tokenIn = await ensureTokenInMint(connection, infra, env["NEXT_PUBLIC_DEMO_TOKEN_IN"]);
  await ensureTokenBalance(connection, infra, tokenIn, demoUser.publicKey, "Demo User tokenIn");

  // 5. Ghost MM tokenIn ATA (pre-created so settle can send tokenIn back to it if needed)
  console.log("\n[5/5] Ghost MM tokenIn ATA (for settlement)…");
  const mmTokenInAtaInfo = await getOrCreateAssociatedTokenAccount(
    connection, infra, tokenIn, ghostMM.publicKey,
    false, "confirmed", { preflightCommitment: "confirmed" },
  );
  console.log(`  Ghost MM tokenIn ATA: ${mmTokenInAtaInfo.address.toBase58().slice(0, 20)}… ✓`);

  // Write to .env.local
  console.log("\nSaving to .env.local…");
  writeEnv({
    NEXT_PUBLIC_DEMO_TOKEN_IN:        tokenIn.toBase58(),
    NEXT_PUBLIC_DEMO_USER_SECRET_KEY: JSON.stringify(Array.from(demoUser.secretKey)),
    NEXT_PUBLIC_DEMO_MM_SECRET_KEY:   JSON.stringify(Array.from(ghostMM.secretKey)),
  });
  console.log(`  NEXT_PUBLIC_DEMO_TOKEN_IN        = ${tokenIn.toBase58()}`);
  console.log(`  NEXT_PUBLIC_DEMO_USER_SECRET_KEY = [${demoUser.secretKey.slice(0, 4).join(",")}…]`);
  console.log(`  NEXT_PUBLIC_DEMO_MM_SECRET_KEY   = [${ghostMM.secretKey.slice(0, 4).join(",")}…]`);

  console.log("\n✓ Demo environment ready.  Restart `next dev` to pick up env vars.\n");
  console.log("  Note: each run creates a fresh tokenOut + pool PDA (~0.056 SOL/run; 0.5 SOL covers ~8 runs).\n");
}

main().catch((e) => { console.error("Setup failed:", e.message ?? e); process.exit(1); });
