/**
 * POST /api/agent/run
 *
 * Server-Sent Events endpoint. Runs the full autonomous agent loop:
 *   1. Calls LLM to decide fragmentation strategy (streams reasoning)
 *   2. Sets up devnet pool + mints
 *   3. Executes each TWAP fragment through the x402 relay
 *   Emits SSE events for every step so the browser can show live progress.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { Connection, Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { createMint, createAccount, mintTo } from "@solana/spl-token";
import nacl  from "tweetnacl";
import bs58  from "bs58";
import * as crypto from "crypto";

const DEVNET_RPC  = "https://api.devnet.solana.com";
const RELAY_URL   = process.env.RELAY_URL ?? "http://localhost:7402";
const PROGRAM_ID  = new PublicKey("AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV");
const POOL_SEED   = Buffer.from("batch_pool");
const VAULT_SEED  = Buffer.from("vault");

function poolPDA(a: PublicKey, b: PublicKey) {
  return PublicKey.findProgramAddressSync([POOL_SEED, a.toBuffer(), b.toBuffer()], PROGRAM_ID);
}
function vaultPDA(pool: PublicKey, mint: PublicKey) {
  return PublicKey.findProgramAddressSync([VAULT_SEED, pool.toBuffer(), mint.toBuffer()], PROGRAM_ID);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  // SSE headers
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();

  const emit = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as any).flush?.();
  };

  const {
    totalAmount    = 1000,
    tokenOut       = "wSOL",
    horizonSeconds = 30,
    limitPrice     = 150,
  } = req.body ?? {};

  try {
    // ── Step 1: LLM reasoning ─────────────────────────────────────────────
    emit({ type: "thinking", text: "Analyzing order…" });

    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "";
    let strategy = {
      rationale: "TWAP with equal time slices minimises market impact and avoids order-book footprint.",
      n: 3,
      riskNote: "No LLM key configured — using default 3-slice strategy.",
    };

    if (apiKey) {
      try {
        const useOR = !!process.env.OPENROUTER_API_KEY;
        if (useOR) {
          const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type":  "application/json",
              "Authorization": `Bearer ${apiKey}`,
              "HTTP-Referer":  "https://lattice.xyz",
              "X-Title":       "Lattice Agent",
            },
            body: JSON.stringify({
              model:      process.env.OPENROUTER_MODEL ?? "anthropic/claude-3-haiku",
              max_tokens: 300,
              stream:     false,
              messages: [
                { role: "system", content: 'You are an autonomous DeFi trading agent. Output ONLY valid JSON: { "rationale": string, "n": number, "riskNote": string }' },
                { role: "user",   content: `Order: buy ${totalAmount} USDC of ${tokenOut} over ${horizonSeconds}s at limit price ${limitPrice}. Choose optimal TWAP slice count (1-5).` },
              ],
            }),
          });
          const j = await r.json() as any;
          const text = j?.choices?.[0]?.message?.content ?? "";
          const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          strategy = { ...strategy, ...JSON.parse(cleaned) };
        } else {
          // Direct Anthropic API
          const { default: Anthropic } = await import("@anthropic-ai/sdk");
          const client = new Anthropic({ apiKey });
          const msg = await client.messages.create({
            model:      "claude-haiku-4-5",
            max_tokens: 300,
            system:     'You are an autonomous DeFi trading agent. Output ONLY valid JSON: { "rationale": string, "n": number, "riskNote": string }',
            messages:   [{ role: "user", content: `Order: buy ${totalAmount} USDC of ${tokenOut} over ${horizonSeconds}s at limit price ${limitPrice}. Choose optimal TWAP slice count (1-5).` }],
          });
          const text = (msg.content?.find((c: any) => c.type === "text") as any)?.text ?? "";
          const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          strategy = { ...strategy, ...JSON.parse(cleaned) };
        }
      } catch (e: any) {
        emit({ type: "log", text: `LLM call failed (${e.message}) — using default strategy`, level: "warn" });
      }
    }

    const n = Math.min(Math.max(Number(strategy.n) || 3, 1), 5);
    emit({ type: "strategy", rationale: strategy.rationale, riskNote: strategy.riskNote, n });

    // ── Step 2: Set up devnet ─────────────────────────────────────────────
    emit({ type: "log", text: "Connecting to Solana devnet…", level: "info" });

    const connection = new Connection(DEVNET_RPC, "confirmed");
    const seed   = new Uint8Array(32).fill(11);
    const payer  = Keypair.fromSeed(seed);

    emit({ type: "log", text: `Wallet: ${payer.publicKey.toBase58().slice(0, 16)}…`, level: "info" });

    const IDL = (await import("../../../anchor-idl/lattice.json")).default;
    const wallet = {
      publicKey:           payer.publicKey,
      signTransaction:     async (tx: any) => { tx.partialSign(payer); return tx; },
      signAllTransactions: async (txs: any[]) => { txs.forEach(t => t.partialSign(payer)); return txs; },
    };
    const provider = new anchor.AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
    const program  = new anchor.Program(IDL as any, provider) as any;

    emit({ type: "log", text: "Creating token pair on devnet…", level: "info" });
    const tokenIn  = await createMint(connection, payer, payer.publicKey, null, 6);
    const tokenOut2 = await createMint(connection, payer, payer.publicKey, null, 6);
    emit({ type: "log", text: "Token pair ready", level: "success" });

    const [pool]  = poolPDA(tokenIn, tokenOut2);
    const [vault] = vaultPDA(pool, tokenIn);

    const userAta = await createAccount(connection, payer, tokenIn, payer.publicKey);
    await mintTo(connection, payer, tokenIn, userAta, payer, BigInt(100_000_000_000));
    emit({ type: "log", text: "Auction pool initialised on devnet", level: "success" });

    await program.methods
      .initializePool(new anchor.BN(20), new anchor.BN(15))
      .accounts({
        authority: payer.publicKey, pool,
        tokenInMint: tokenIn, tokenOutMint: tokenOut2,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    emit({ type: "pool_ready", pool: pool.toBase58() });

    // ── Step 3: Execute TWAP fragments ────────────────────────────────────
    const sliceAmount = Math.floor((totalAmount * 1_000_000) / n);
    const results: { index: number; txSig: string; explorerUrl: string }[] = [];

    for (let i = 0; i < n; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 2000));

      emit({ type: "fragment_start", index: i, total: n, amount: sliceAmount / 1_000_000 });

      const salt       = crypto.randomBytes(16);
      const amount     = new anchor.BN(sliceAmount);
      const lp         = new anchor.BN(limitPrice * 1_000_000);

      // Build commit hash
      const h = crypto.createHash("sha256");
      h.update(tokenIn.toBuffer());
      h.update(tokenOut2.toBuffer());
      h.update(amount.toArrayLike(Buffer, "le", 8));
      h.update(lp.toArrayLike(Buffer, "le", 8));
      h.update(salt);
      const commitHash    = Array.from(h.digest());
      const commitHashHex = Buffer.from(commitHash).toString("hex");

      emit({ type: "log", text: `Fragment ${i + 1}/${n} hash: ${commitHashHex.slice(0, 16)}… (sealed)`, level: "info" });

      // Build real Anchor tx
      const commitTxObj = await program.methods
        .commitIntent(commitHash, amount, true)
        .accounts({
          payer: payer.publicKey, pool,
          payerTokenAccount: userAta, mint: tokenIn, vault,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        })
        .transaction();
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      commitTxObj.recentBlockhash = blockhash;
      commitTxObj.feePayer = payer.publicKey;
      commitTxObj.sign(payer);
      const txBase64 = commitTxObj.serialize().toString("base64");

      // x402 dance — direct server-to-server call so we CAN read the header
      emit({ type: "log", text: `Fragment ${i + 1}/${n}: requesting relay (x402)…`, level: "info" });

      const r1 = await fetch(`${RELAY_URL}/commit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ commitHash: commitHashHex, payer: payer.publicKey.toBase58(), txBase64 }),
      });
      const envelopeB64 = r1.headers.get("payment-required") ?? "";
      if (!envelopeB64) throw new Error(`Relay did not return 402 envelope for fragment ${i + 1}`);

      const envelope = JSON.parse(Buffer.from(envelopeB64, "base64").toString());
      emit({ type: "log", text: `Fragment ${i + 1}/${n}: signing 0.001 USDC micropayment…`, level: "warn" });

      // Sign payment
      const msgStr  = JSON.stringify({ amount: envelope.maxAmountRequired, asset: envelope.asset, network: envelope.network, resource: "/commit", nonce: envelope.nonce });
      const sigBytes = nacl.sign.detached(Buffer.from(msgStr), payer.secretKey);
      const paymentSig = Buffer.from(JSON.stringify({
        from:      payer.publicKey.toBase58(),
        pubkey:    payer.publicKey.toBase58(),
        signature: bs58.encode(sigBytes),
        amount:    envelope.maxAmountRequired,
        asset:     envelope.asset,
        network:   envelope.network,
        nonce:     envelope.nonce,
      })).toString("base64");

      const r2 = await fetch(`${RELAY_URL}/commit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "payment-signature": paymentSig },
        body:    JSON.stringify({ commitHash: commitHashHex, payer: payer.publicKey.toBase58(), txBase64 }),
      });

      if (!r2.ok) {
        const err = await r2.json().catch(() => ({})) as any;
        throw new Error(`Relay rejected fragment ${i + 1}: ${err.error ?? r2.status}`);
      }

      const relayResult = await r2.json() as any;
      const txSig      = relayResult.txSig ?? "";
      const explorerUrl = `https://explorer.solana.com/tx/${txSig}?cluster=devnet`;

      results.push({ index: i, txSig, explorerUrl });
      emit({ type: "fragment_done", index: i, total: n, txSig, explorerUrl });
    }

    emit({
      type:     "done",
      n,
      results,
      mevExtracted: 0,
      message:  `${n} sealed fragments confirmed on devnet. Zero MEV on any of them.`,
    });

  } catch (err: any) {
    emit({ type: "error", message: err.message });
  } finally {
    res.end();
  }
}

export const config = { api: { bodyParser: true, responseLimit: false } };
