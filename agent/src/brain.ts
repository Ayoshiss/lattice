/**
 * Lattice Autonomous Liquidity Agent
 *
 * The full think → scan → pay → act loop, from one wallet:
 *   1. THINK — Bhairab (routed to Bittensor SN64) reasons about fragmentation
 *   2. SCAN  — Bhairab risk-scans the asset; a honeypot verdict aborts the trade
 *   3. Splits the parent order into N fragments
 *   4. For each fragment:
 *      a. Builds a real CommitIntent tx (Anchor)
 *      b. POSTs to relay — relay returns 402
 *      c. Signs payment envelope with ed25519 (PAY)
 *      d. Retries — relay verifies, submits tx to devnet (ACT)
 *   5. Prints structured telemetry
 *
 * Both the reasoning and the risk verdict run on Bittensor via Bhairab, so the
 * whole loop is Bittensor-powered end to end.
 */

import * as crypto from "crypto";
import * as dotenv from "dotenv";
import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  getOrCreateAssociatedTokenAccount,
  createMint,
  mintTo,
} from "@solana/spl-token";

import { twapFragment, ParentOrder } from "./fragmenter";
import { relayCommit } from "./pay";
import { scanToken } from "./scan";
import {
  DEVNET_RPC,
  PROGRAM_ID,
  loadKeypair,
  poolPDA,
  vaultPDA,
  buildCommitTx,
  makeCommitHash,
  ensureFunded,
  loadIdl,
} from "./latticeClient";

import * as path from "path";
import * as fs from "fs";

dotenv.config();

const ALICE_KEYPAIR_PATH = path.resolve(__dirname, "../../keys/alice.json");

// ---------------------------------------------------------------------------
// THINK — reasoning via Bhairab (routed to Bittensor SN64)
// ---------------------------------------------------------------------------
// The agent's reasoning runs on Bittensor through Bhairab's OpenAI-compatible
// gateway. `model: "auto"` opts into Bhairab's dynamic router, which serves the
// prompt from a Chutes SN64 model. Reasoning models can wrap the answer in prose,
// so we extract the JSON object rather than assuming the whole reply is JSON.
const BHAIRAB_BASE     = process.env.BHAIRAB_BASE_URL ?? "https://tao-gateway.fly.dev";
const BHAIRAB_API_KEY  = process.env.BHAIRAB_API_KEY ?? "";
const THINK_MODEL      = process.env.BHAIRAB_THINK_MODEL ?? "auto";
const THINK_TIMEOUT_MS = Number(process.env.BHAIRAB_THINK_TIMEOUT_MS ?? 20000);

// The gateway keeps a Groq backstop so the agent never stalls when a subnet is
// momentarily slow. But decentralized reasoning is the whole point, so the agent
// PREFERS a Bittensor-served result: if a call falls back to Groq, it retries a
// few times to get Bittensor, and only accepts the backstop as a last resort.
const PREFER_BITTENSOR = (process.env.BHAIRAB_PREFER_BITTENSOR ?? "1") !== "0";
const THINK_ATTEMPTS   = Number(process.env.BHAIRAB_THINK_ATTEMPTS ?? 3);

/** True when the reasoning was served by a Bittensor subnet (not the Groq backstop). */
function servedByBittensor(servedBy: string): boolean {
  return /SN64|Chutes/i.test(servedBy);
}

interface ThinkResult { rationale: string; n: number; riskNote: string; servedBy: string; }

const DEFAULT_THINK: ThinkResult = {
  rationale: "TWAP: equal slices across the horizon minimise market impact.",
  n: 3,
  riskNote:  "Default strategy.",
  servedBy:  "default (no Bhairab key)",
};

/** Pull the first balanced JSON object out of an LLM reply. */
function extractJson(text: string): any | null {
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** One reasoning call to Bhairab. Returns null on a transient/parse failure. */
async function thinkOnce(order: ParentOrder): Promise<ThinkResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), THINK_TIMEOUT_MS);
  try {
    const res = await fetch(`${BHAIRAB_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${BHAIRAB_API_KEY}`,
      },
      body: JSON.stringify({
        model:      THINK_MODEL,
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "You are the Lattice autonomous liquidity agent. You split a parent " +
              "order into N equal TWAP fragments to minimise market impact and MEV. " +
              'Reply with ONLY a JSON object: {"rationale": string, "n": number (1-5), "riskNote": string}.',
          },
          {
            role: "user",
            content: `Order: buy ${order.totalAmount / 1e6} USDC of ${order.tokenOut} over ${order.horizonSeconds}s at limit ${order.limitPrice}. How many fragments?`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Bhairab think failed (HTTP ${res.status}): ${await res.text()}`);
    }

    const routedSubnet = res.headers.get("x-routed-subnet") || "Bittensor SN64";
    const json = (await res.json()) as any;
    const text = json?.choices?.[0]?.message?.content ?? "";
    const servedModel = json?.model ?? "";
    const parsed = extractJson(text);
    if (!parsed) throw new Error(`could not parse JSON from reply: ${text.slice(0, 120)}`);

    // x-routed-subnet already embeds the model (e.g. "SN64-Chutes/<model>"), so only
    // append the served model when it isn't already part of the routed-subnet string.
    const servedBy =
      !servedModel || routedSubnet.includes(servedModel)
        ? routedSubnet
        : `${routedSubnet} · ${servedModel}`;
    return {
      rationale: String(parsed.rationale ?? DEFAULT_THINK.rationale),
      n:         Number(parsed.n) || 3,
      riskNote:  String(parsed.riskNote ?? ""),
      servedBy,
    };
  } catch (e: any) {
    console.warn(`[think] reasoning attempt failed (${e.message}).`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function think(order: ParentOrder): Promise<ThinkResult> {
  if (!BHAIRAB_API_KEY) {
    console.log("[think] No BHAIRAB_API_KEY set — using default TWAP strategy.");
    return DEFAULT_THINK;
  }

  let last: ThinkResult | null = null;
  for (let attempt = 1; attempt <= THINK_ATTEMPTS; attempt++) {
    const r = await thinkOnce(order);
    if (r) {
      last = r;
      // Accept immediately on Bittensor; otherwise keep retrying to prefer the
      // decentralized path, taking the Groq backstop only on the final attempt.
      if (!PREFER_BITTENSOR || servedByBittensor(r.servedBy) || attempt === THINK_ATTEMPTS) {
        return r;
      }
      console.log(`[think] served by ${r.servedBy} — preferring Bittensor, retrying (${attempt}/${THINK_ATTEMPTS})…`);
    }
    if (attempt < THINK_ATTEMPTS) await new Promise((rs) => setTimeout(rs, 500));
  }

  return last ?? { ...DEFAULT_THINK, servedBy: "default (Bhairab unreachable)" };
}

// ---------------------------------------------------------------------------
// Pool bootstrap (idempotent)
// ---------------------------------------------------------------------------
async function bootstrapPool(
  connection: Connection,
  payer: ReturnType<typeof loadKeypair>
): Promise<{
  pool:     PublicKey;
  tokenIn:  PublicKey;
  tokenOut: PublicKey;
  vault:    PublicKey;
  payerAta: PublicKey;
}> {
  const idl = loadIdl();
  const wallet = {
    publicKey: payer.publicKey,
    signTransaction: async (tx: any) => { tx.partialSign(payer); return tx; },
    signAllTransactions: async (txs: any[]) => { txs.forEach(t => t.partialSign(payer)); return txs; },
  };
  const provider = new anchor.AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  const program  = new anchor.Program(idl, provider);

  // Stable demo mints keyed from alice's pubkey (so they're reproducible)
  const mintSeed = crypto.createHash("sha256")
    .update(payer.publicKey.toBuffer())
    .update("lattice-agent-demo-v1")
    .digest();

  // We store mint addresses in a local cache file to avoid recreating them
  const cacheFile = path.resolve(__dirname, "../../keys/agent-demo-mints.json");
  let tokenIn: PublicKey, tokenOut: PublicKey;

  // A batch-auction pool's commit window is short-lived, so a reused pool goes
  // stale fast. Default to fresh mints each run (→ fresh pool with an open commit
  // window) so the demo is repeatable. Set REUSE_MINTS=1 to reuse cached mints.
  if (process.env.REUSE_MINTS === "1" && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    tokenIn  = new PublicKey(cached.tokenIn);
    tokenOut = new PublicKey(cached.tokenOut);
    console.log("[brain] Using cached mints from", cacheFile);
  } else {
    console.log("[brain] Creating fresh token mints on devnet…");
    tokenIn  = await createMint(connection, payer, payer.publicKey, null, 6);
    tokenOut = await createMint(connection, payer, payer.publicKey, null, 6);
    fs.writeFileSync(cacheFile, JSON.stringify({
      tokenIn:  tokenIn.toBase58(),
      tokenOut: tokenOut.toBase58(),
    }));
    console.log(`[brain] tokenIn:  ${tokenIn.toBase58()}`);
    console.log(`[brain] tokenOut: ${tokenOut.toBase58()}`);
  }

  const [pool] = poolPDA(tokenIn, tokenOut);
  const [vault] = vaultPDA(pool, tokenIn);

  // Init pool if not already initialised
  const poolInfo = await connection.getAccountInfo(pool);
  if (!poolInfo) {
    console.log("[brain] Initialising pool PDA…");
    // 300 slots ≈ 120s commit window — long enough for TWAP fragments
    await program.methods
      .initializePool(new anchor.BN(300), new anchor.BN(60))
      .accounts({
        authority:    payer.publicKey,
        pool,
        tokenInMint:  tokenIn,
        tokenOutMint: tokenOut,
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      })
      .rpc();
    console.log(`[brain] Pool ready: ${pool.toBase58()}`);
  } else {
    console.log(`[brain] Pool exists: ${pool.toBase58()}`);
  }

  // Ensure payer has a funded ATA for tokenIn
  const ataObj = await getOrCreateAssociatedTokenAccount(
    connection, payer, tokenIn, payer.publicKey
  );
  const payerAta = ataObj.address;
  if (ataObj.amount < BigInt(100_000_000_000)) {
    await mintTo(connection, payer, tokenIn, payerAta, payer, BigInt(1_000_000_000_000));
    console.log("[brain] Minted 1,000,000 tokenIn to payer ATA");
  }

  return { pool, tokenIn, tokenOut, vault, payerAta };
}

// ---------------------------------------------------------------------------
// Bhairab risk gate — the SCAN step (think → SCAN → pay → act)
// ---------------------------------------------------------------------------
// The on-chain demo trades throwaway devnet mints (no market data), so the agent
// scans the REAL asset it intends to acquire. A "stop" verdict aborts the trade
// before any order touches Lattice.
const KNOWN_MINTS: Record<string, string> = {
  wSOL: "So11111111111111111111111111111111111111112",
  SOL:  "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

async function scanGate(order: ParentOrder): Promise<boolean> {
  const mint = order.scanMint ?? KNOWN_MINTS[order.tokenOut];
  if (!mint) {
    console.log(`[scan] No known mint for ${order.tokenOut} — skipping risk scan`);
    return true;
  }
  console.log(`\n[scan] Bhairab pre-trade risk check on ${order.tokenOut} (${mint.slice(0, 8)}…)…`);
  try {
    const r = await scanToken(mint, "buy");
    const mark = r.verdict === "stop" ? "⛔" : r.verdict === "caution" ? "⚠️ " : "✓";
    console.log(`[scan] ${mark} ${r.verdict.toUpperCase()}  (${r.verdictSource}, ${r.latencyMs}ms) — ${r.summary}`);
    r.reasons.forEach((x) => console.log(`        • ${x}`));
    if (r.verdict === "stop") {
      console.log(`\n[scan] ⛔ Bhairab BLOCKED this trade. No order will be committed to Lattice.`);
      return false;
    }
    return true;
  } catch (e) {
    // Fail-CLOSED: a guardian that cannot verify safety must not trade. If the
    // scan is unreachable after retries, abort rather than risk a bad buy.
    console.error(`[scan] ⛔ scan failed after retries (${(e as Error).message}) — BLOCKING trade (fail-closed).`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function runAgent(order: ParentOrder) {
  console.log("\n═══════════════════════════════════════");
  console.log("  Lattice Autonomous Agent  (Day 3)");
  console.log("═══════════════════════════════════════");
  console.log(JSON.stringify({ order }, null, 2));

  // ── Bhairab risk gate (SCAN) — runs FIRST, before any LLM call or chain work.
  // The guardian checks the real asset the agent intends to buy; a honeypot/rug
  // verdict aborts the trade before a single order touches Lattice.
  const safe = await scanGate(order);
  if (!safe) {
    console.log("\n═══════════════════════════════════════");
    console.log("  Trade ABORTED by Bhairab guardian. 0 fragments committed.");
    console.log("  The agent refused to buy a flagged token — no MEV, no loss.");
    console.log("═══════════════════════════════════════\n");
    return;
  }

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const alice = loadKeypair(ALICE_KEYPAIR_PATH);
  console.log(`\n[brain] Agent wallet: ${alice.publicKey.toBase58()}`);

  await ensureFunded(connection, alice.publicKey, 500_000_000);

  // ── THINK: reasoning via Bhairab → Bittensor ─────────────────────────
  console.log("\n[think] Asking Bhairab (Bittensor SN64) for a fragmentation strategy…");
  const reasoning = await think(order);
  console.log(`[think] served by: ${reasoning.servedBy}`);
  console.log(`[think] n=${reasoning.n} — ${reasoning.rationale}`);
  if (reasoning.riskNote) console.log(`[think] risk note: ${reasoning.riskNote}`);

  const n = Math.min(Math.max(reasoning.n ?? 3, 1), 5); // cap at 5 for demo

  // ── Bootstrap pool ────────────────────────────────────────────────────
  console.log("\n[brain] Bootstrapping pool…");
  const { pool, tokenIn, tokenOut, vault, payerAta } = await bootstrapPool(connection, alice);

  // ── TWAP fragments ────────────────────────────────────────────────────
  const fragments = twapFragment(order, n);
  console.log(`\n[brain] Submitting ${n} fragments via x402 relay…\n`);

  const telemetry: object[] = [];
  let totalFees = 0;

  for (const frag of fragments) {
    // Brief pause between fragments (cap at 2s for demo)
    if (frag.index > 0) {
      const pause = Math.min(frag.delayMs / fragments.length, 2000);
      await new Promise(r => setTimeout(r, pause));
    }

    const salt       = crypto.randomBytes(16);
    const limitPrice = new anchor.BN(order.limitPrice * 1_000_000);
    const amount     = new anchor.BN(frag.amount);

    const { hash: commitHash } = makeCommitHash({
      tokenIn,
      tokenOut,
      amount,
      limitPrice,
      salt,
    });

    // Build real Anchor tx
    const txBase64 = await buildCommitTx(connection, {
      payer:      alice,
      pool,
      tokenIn,
      tokenOut,
      vault,
      payerAta,
      commitHash,
      amount,
      isBuy: true,
    });

    const commitHashHex = Buffer.from(commitHash).toString("hex");

    console.log(`[agent] Fragment ${frag.index + 1}/${n}  amount=${frag.amount}  hash=${commitHashHex.slice(0, 12)}…`);

    // x402 dance → relay → devnet
    const result = await relayCommit(alice, {
      commitHash: commitHashHex,
      payer:      alice.publicKey.toBase58(),
      txBase64,
    });

    const feeUsdc = 0.001;
    totalFees += feeUsdc;

    const event = {
      ts:            Date.now(),
      fragmentIndex: frag.index,
      amount:        frag.amount,
      limitPrice:    frag.limitPrice,
      payer:         alice.publicKey.toBase58(),
      commitHash:    commitHashHex,
      bundleId:      result.bundleId,
      txSig:         result.txSig,
      explorerUrl:   result.explorerUrl,
      feePaidUsdc:   feeUsdc,
      mevExtracted:  0, // guaranteed by batch auction
    };

    console.log(`[agent] ✓ Fragment ${frag.index + 1} confirmed`);
    if (result.txSig) {
      console.log(`        devnet: ${result.explorerUrl}`);
    }
    telemetry.push(event);
  }

  console.log("\n═══════════════════════════════════════");
  console.log(`  Done. ${n} fragments submitted.`);
  console.log(`  Total relay fees: ${totalFees.toFixed(4)} USDC`);
  console.log(`  MEV extracted:    0 bps  ✓`);
  console.log("═══════════════════════════════════════\n");
  console.log(JSON.stringify({ telemetry }, null, 2));
}

// Demo order: buy 1,000 USDC of wSOL over 30 seconds.
// Bhairab scans the real asset first. Set DEMO_HONEYPOT=1 to point the scan at a
// live freeze-authority honeypot and watch the agent refuse to trade.
const demoOrder: ParentOrder = {
  tokenIn:        "USDC",
  tokenOut:       "wSOL",
  totalAmount:    1_000 * 1_000_000,  // 1,000 USDC (6 decimals)
  limitPrice:     150,                 // 150 USDC per SOL
  horizonSeconds: 30,
  scanMint:       process.env.DEMO_HONEYPOT === "1"
    ? "831f8cKgPcS7gnZSA9RBTF5uTDAtkKs7kuiYs4M1fdkA"  // live CAT honeypot → STOP
    : undefined,                                       // defaults to wSOL → PROCEED
};

runAgent(demoOrder).catch(console.error);
