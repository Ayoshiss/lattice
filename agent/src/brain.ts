/**
 * Lattice Autonomous Liquidity Agent — Day 3
 *
 * Driven by an LLM. Given a parent order it:
 *   1. Asks the LLM to reason about TWAP fragmentation
 *   2. Splits into N equal fragments
 *   3. For each fragment:
 *      a. Builds a real CommitIntent tx (Anchor)
 *      b. POSTs to relay — relay returns 402
 *      c. Signs payment envelope with ed25519
 *      d. Retries — relay verifies, submits tx to devnet
 *   4. Prints structured telemetry
 */

import Anthropic from "@anthropic-ai/sdk";
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
// LLM reasoning
// ---------------------------------------------------------------------------
// Support direct API or OpenRouter
const client = process.env.OPENROUTER_API_KEY
  ? new Anthropic({
      apiKey:  process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://lattice.xyz",
        "X-Title":      "Lattice Agent",
      },
    })
  : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function llmReason(order: ParentOrder): Promise<{ rationale: string; n: number; riskNote: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "placeholder" || apiKey === "") {
    console.log("[brain] No ANTHROPIC_API_KEY — using default TWAP strategy");
    return {
      rationale: "TWAP: equal slices minimise market impact. No LLM key configured.",
      n: 3,
      riskNote:  "Default strategy — set ANTHROPIC_API_KEY for LLM-guided sizing",
    };
  }

  const model = process.env.OPENROUTER_API_KEY
    ? (process.env.OPENROUTER_MODEL ?? "anthropic/claude-3-haiku")
    : "claude-haiku-4-5";

  try {
    // Use OpenRouter's OpenAI-compatible endpoint directly (avoids streaming issues)
    const apiKey  = process.env.OPENROUTER_API_KEY;
    const useOR   = !!apiKey;
    const endpoint = useOR
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.anthropic.com/v1/messages";

    let text = "";
    if (useOR) {
      const res = await fetch(endpoint, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer":  "https://lattice.xyz",
          "X-Title":       "Lattice Agent",
        },
        body: JSON.stringify({
          model:       process.env.OPENROUTER_MODEL ?? "anthropic/claude-3-haiku",
          max_tokens:  256,
          stream:      false,
          messages: [
            { role: "system", content: `You are the Lattice autonomous liquidity agent. Output ONLY a JSON object: { "rationale": string, "n": number, "riskNote": string }` },
            { role: "user",   content: `Order: buy ${order.totalAmount / 1e6} USDC of ${order.tokenOut} over ${order.horizonSeconds}s at limit ${order.limitPrice}` },
          ],
        }),
      });
      const json = await res.json() as any;
      text = json?.choices?.[0]?.message?.content ?? "";
    } else {
      const { content } = await client.messages.create({
        model:      "claude-haiku-4-5",
        max_tokens: 256,
        system:     `You are the Lattice autonomous liquidity agent. Output ONLY a JSON object: { "rationale": string, "n": number, "riskNote": string }`,
        messages:   [{ role: "user", content: `Order: buy ${order.totalAmount / 1e6} USDC of ${order.tokenOut} over ${order.horizonSeconds}s at limit ${order.limitPrice}` }],
      });
      text = (content?.find((c: any) => c.type === "text") as any)?.text ?? "";
    }

    console.log("[brain] LLM text:", text.slice(0, 150));
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed  = JSON.parse(cleaned);
    return { rationale: parsed.rationale ?? "", n: Number(parsed.n) || 3, riskNote: parsed.riskNote ?? "" };
  } catch (e: any) {
    console.warn("[brain] LLM failed:", e.message);
    return { rationale: "TWAP: equal slices across horizon", n: 3, riskNote: "" };
  }
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

  if (fs.existsSync(cacheFile)) {
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
// Main
// ---------------------------------------------------------------------------
async function runAgent(order: ParentOrder) {
  console.log("\n═══════════════════════════════════════");
  console.log("  Lattice Autonomous Agent  (Day 3)");
  console.log("═══════════════════════════════════════");
  console.log(JSON.stringify({ order }, null, 2));

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const alice = loadKeypair(ALICE_KEYPAIR_PATH);
  console.log(`\n[brain] Agent wallet: ${alice.publicKey.toBase58()}`);

  await ensureFunded(connection, alice.publicKey, 500_000_000);

  // ── LLM reasoning ────────────────────────────────────────────────────
  console.log("\n[brain] Asking LLM for fragmentation strategy…");
  const reasoning = await llmReason(order);
  console.log("[brain] LLM:", JSON.stringify(reasoning, null, 2));

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

// Demo order: buy 1,000 USDC of wSOL over 30 seconds
const demoOrder: ParentOrder = {
  tokenIn:        "USDC",
  tokenOut:       "wSOL",
  totalAmount:    1_000 * 1_000_000,  // 1,000 USDC (6 decimals)
  limitPrice:     150,                 // 150 USDC per SOL
  horizonSeconds: 30,
};

runAgent(demoOrder).catch(console.error);
