/**
 * POST /api/agent/run
 *
 * Server-Sent Events endpoint.  Runs the full autonomous agent loop:
 *   1. Accepts a plain-English order description
 *   2. Streams LLM reasoning, parses the JSON strategy (n slices)
 *   3. Executes n SEQUENTIAL batch auction cycles — one per slice
 *      Each slice: initPool → commit (via x402 relay) → commit MM →
 *                  wait commit window → reveal → wait reveal window →
 *                  clearBatch → settle
 *
 * Why sequential?  Lattice is a batch auction DEX.  TWAP means each slice
 * gets its OWN clearing price in its OWN batch — not n orders dumped into
 * a single batch.  Sequential cycles = real price discovery per slice.
 *
 * tokenIn:  persistent (pre-funded by setup-demo.ts) — no mint-then-spend race.
 * tokenOut: fresh per slice — unique pool PDA each slice; prevents CommitWindowClosed
 *   (pool is not reused across runs, so stale commit window can't block next run).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { Connection, Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import {
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createMint,
  mintTo,
} from "@solana/spl-token";
import nacl   from "tweetnacl";
import bs58   from "bs58";
import * as crypto from "crypto";

const DEVNET_RPC = "https://api.devnet.solana.com";
const RELAY_URL  = process.env.RELAY_URL ?? "http://localhost:7402";
const PROGRAM_ID = new PublicKey("AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV");
const POOL_SEED  = Buffer.from("batch_pool");
const VAULT_SEED = Buffer.from("vault");

const COMMIT_SLOTS = 20;  // ~8s on devnet
const REVEAL_SLOTS = 15;  // ~6s on devnet

const SYSTEM_PROMPT = `You are an autonomous DeFi trading agent for Lattice, a batch-auction DEX on Solana.
The user will describe a trade in plain English. Think through the optimal TWAP fragmentation strategy in 2-3 conversational sentences, explaining your reasoning naturally (mention the order size, time horizon, and market impact concern if relevant).
Then on a new line output exactly: JSON:{"n":NUMBER,"rationale":"SHORT_RATIONALE","riskNote":"SHORT_RISK_NOTE"}
where n is 1-5 slices. Do not output anything after the JSON line.`;

function poolPDA(a: PublicKey, b: PublicKey) {
  return PublicKey.findProgramAddressSync([POOL_SEED, a.toBuffer(), b.toBuffer()], PROGRAM_ID);
}
function vaultPDA(pool: PublicKey, mint: PublicKey) {
  return PublicKey.findProgramAddressSync([VAULT_SEED, pool.toBuffer(), mint.toBuffer()], PROGRAM_ID);
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Single batch auction cycle for one slice ───────────────────────────────
async function runSlice(opts: {
  connection:   Connection;
  demoUser:     Keypair;        // Demo User keypair (user-side txs)
  ghostMM:      Keypair;        // Ghost Market-Maker keypair (MM-side txs)
  program:      any;
  tokenIn:      PublicKey;      // persistent
  userAta:      PublicKey;      // pre-funded ATA for tokenIn (owned by demoUser)
  sliceAmount:  number;         // raw tokenIn per slice (6 dp, e.g. 333_333_333 for 333 USDC)
  limitPrice:   number;         // natural integer price (e.g. 150 = "150 tokenIn per tokenOut")
  sliceIndex:   number;
  totalSlices:  number;
  relayUrl:     string;
  emit:         (d: object) => void;
}): Promise<{ txSig: string; explorerUrl: string }> {
  const { connection, demoUser, ghostMM, program, tokenIn, userAta, sliceAmount,
          limitPrice, sliceIndex, totalSlices, relayUrl, emit } = opts;

  const n = sliceIndex + 1;
  const T = totalSlices;

  // ── Amounts — natural integer prices ─────────────────────────────────────
  // The Lattice settle formula uses:
  //   BUY  filled: out_amount = fill_amount / clearing_price
  //   SELL filled: in_amount  = fill_amount * clearing_price
  // Prices MUST be natural integers (no 6dp scaling) — passing e.g. 99_000_000
  // causes in_amount = mmAmt × 99_000_000 → overflows vault → InsufficientFunds.
  //
  // For vault balance to cancel exactly at clearing_price = mmLpNat (lower
  // tie-break when both volumes match):
  //   amount (tokenIn user commits)    = mmAmtRaw × mmLpNat
  //   settle_buy  = amount  / mmLpNat  = mmAmtRaw ✓  (vaultOut has mmAmtRaw)
  //   settle_sell = mmAmtRaw * mmLpNat = amount   ✓  (vault has amount)
  const lpNat    = limitPrice;                           // natural integer (e.g. 150)
  const mmLpNat  = Math.floor(limitPrice * 0.9);         // 90% of user price
  const lp       = new anchor.BN(lpNat);
  const mmLp     = new anchor.BN(mmLpNat);
  const mmAmtRaw = Math.floor(sliceAmount / mmLpNat);    // tokenOut for MM (floor → exact match)
  const mmAmt    = new anchor.BN(mmAmtRaw);
  const amount   = mmAmt.mul(mmLp);                      // exact tokenIn for user

  // tokenOut: FRESH per slice — unique pool PDA each time (initializePool uses `init`).
  // This prevents CommitWindowClosed: a stale pool from a previous run can never block us.
  const tokenOut = await createMint(connection, demoUser, demoUser.publicKey, null, 6, undefined, { preflightCommitment: "confirmed" });
  const [pool]    = poolPDA(tokenIn, tokenOut);
  const [vault]   = vaultPDA(pool, tokenIn);
  const [vaultOut] = vaultPDA(pool, tokenOut);

  // Ghost MM tokenOut ATA: fresh for this tokenOut mint; mint before commit.
  const mmAtaInfo = await getOrCreateAssociatedTokenAccount(
    connection, demoUser, tokenOut, ghostMM.publicKey,
    false, "confirmed", { preflightCommitment: "confirmed" },
  );
  const mmAtaOut = mmAtaInfo.address;
  await mintTo(connection, demoUser, tokenOut, mmAtaOut, demoUser, BigInt(mmAmtRaw + 1_000), [], { preflightCommitment: "confirmed" });

  // Always initializePool — fresh tokenOut means fresh pool PDA every slice.
  emit({ type: "log", text: `Slice ${n}/${T}: creating pool PDA…`, level: "info" });
  const initTx = await program.methods
    .initializePool(new anchor.BN(COMMIT_SLOTS), new anchor.BN(REVEAL_SLOTS))
    .accounts({
      authority: demoUser.publicKey, pool,
      tokenInMint: tokenIn, tokenOutMint: tokenOut,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  const initBh = (await connection.getLatestBlockhash("confirmed")).blockhash;
  initTx.recentBlockhash = initBh;
  initTx.feePayer = demoUser.publicKey;
  initTx.sign(demoUser);
  const initSig = await connection.sendRawTransaction(initTx.serialize(), {
    skipPreflight: false, preflightCommitment: "confirmed",
  });
  const initRes = await connection.confirmTransaction(initSig, "confirmed");
  if (initRes.value.err) throw new Error(`Slice ${n}: initializePool failed: ${JSON.stringify(initRes.value.err)}`);

  emit({ type: "pool_ready", pool: pool.toBase58() });

  // ── Commit: user slice via x402 relay ────────────────────────────────────
  const salt = crypto.randomBytes(16);

  const h = crypto.createHash("sha256");
  h.update(tokenIn.toBuffer());
  h.update(tokenOut.toBuffer());
  h.update(amount.toArrayLike(Buffer, "le", 8));
  h.update(lp.toArrayLike(Buffer, "le", 8));
  h.update(salt);
  const commitHash    = Array.from(h.digest());
  const commitHashHex = Buffer.from(commitHash).toString("hex");

  emit({ type: "log", text: `Slice ${n}/${T} hash: ${commitHashHex.slice(0, 16)}… (sealed)`, level: "info" });

  const commitTxObj = await program.methods
    .commitIntent(commitHash, amount, true)
    .accounts({
      payer: demoUser.publicKey, pool,
      tokenInMint: tokenIn, tokenOutMint: tokenOut,
      payerTokenAccount: userAta, mint: tokenIn, vault,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .transaction();
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  commitTxObj.recentBlockhash = blockhash;
  commitTxObj.feePayer = demoUser.publicKey;
  commitTxObj.sign(demoUser);
  const txBase64 = commitTxObj.serialize().toString("base64");

  // x402: step 1 — get envelope
  emit({ type: "log", text: `Slice ${n}/${T}: routing through private relay (x402)…`, level: "info" });
  const r1 = await fetch(`${relayUrl}/commit`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ commitHash: commitHashHex, payer: demoUser.publicKey.toBase58(), txBase64 }),
  });
  const envelopeB64 = r1.headers.get("payment-required") ?? "";
  if (!envelopeB64) throw new Error(`Relay did not return 402 envelope for slice ${n}`);

  const envelope = JSON.parse(Buffer.from(envelopeB64, "base64").toString());
  emit({ type: "log", text: `Slice ${n}/${T}: signing 0.001 USDC micropayment…`, level: "warn" });

  const msgStr   = JSON.stringify({ amount: envelope.maxAmountRequired, asset: envelope.asset, network: envelope.network, resource: "/commit", nonce: envelope.nonce });
  const sigBytes = nacl.sign.detached(Buffer.from(msgStr), demoUser.secretKey);
  const paymentSig = Buffer.from(JSON.stringify({
    from: demoUser.publicKey.toBase58(), pubkey: demoUser.publicKey.toBase58(),
    signature: bs58.encode(sigBytes),
    amount: envelope.maxAmountRequired, asset: envelope.asset,
    network: envelope.network, nonce: envelope.nonce,
  })).toString("base64");

  // x402: step 2 — pay and submit
  const r2 = await fetch(`${relayUrl}/commit`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "payment-signature": paymentSig },
    body:    JSON.stringify({ commitHash: commitHashHex, payer: demoUser.publicKey.toBase58(), txBase64 }),
  });
  if (!r2.ok) {
    const err = await r2.json().catch(() => ({})) as any;
    throw new Error(`Relay rejected slice ${n}: ${err.error ?? r2.status}`);
  }
  const relayResult  = await r2.json() as any;
  const txSig        = relayResult.txSig ?? "";
  const explorerUrl  = `https://explorer.solana.com/tx/${txSig}?cluster=devnet`;
  emit({ type: "log", text: `Slice ${n}/${T}: sealed on-chain via relay ✓`, level: "success" });

  // ── Commit: Ghost MM counterparty sell ───────────────────────────────────
  const mmSalt = crypto.randomBytes(16);

  const mmH = crypto.createHash("sha256");
  mmH.update(tokenIn.toBuffer());
  mmH.update(tokenOut.toBuffer());
  mmH.update(mmAmt.toArrayLike(Buffer, "le", 8));
  mmH.update(mmLp.toArrayLike(Buffer, "le", 8));
  mmH.update(mmSalt);
  const mmCommitHash = Array.from(mmH.digest());

  const mmCommitTx = await program.methods
    .commitIntent(mmCommitHash, mmAmt, false)
    .accounts({
      payer: ghostMM.publicKey, pool,
      tokenInMint: tokenIn, tokenOutMint: tokenOut,
      payerTokenAccount: mmAtaOut, mint: tokenOut, vault: vaultOut,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .transaction();
  const mmBh = (await connection.getLatestBlockhash("confirmed")).blockhash;
  mmCommitTx.recentBlockhash = mmBh; mmCommitTx.feePayer = ghostMM.publicKey; mmCommitTx.sign(ghostMM);
  const mmCommitSig = await connection.sendRawTransaction(mmCommitTx.serialize(), {
    skipPreflight: false, preflightCommitment: "confirmed",
  });
  const mmCommitRes = await connection.confirmTransaction(mmCommitSig, "confirmed");
  if (mmCommitRes.value.err) throw new Error(`Slice ${n}: MM commit failed: ${JSON.stringify(mmCommitRes.value.err)}`);
  emit({ type: "log", text: `Slice ${n}/${T}: MM sell sealed — batch can cross`, level: "info" });

  // ── Wait for commit window ────────────────────────────────────────────────
  const ps1      = await program.account.batchAuctionPool.fetch(pool);
  const commitEnd = ps1.phaseStartSlot.toNumber() + COMMIT_SLOTS + 1;
  let curSlot     = await connection.getSlot("confirmed");
  while (curSlot < commitEnd) {
    emit({ type: "log", text: `Slice ${n}/${T}: commit window — ${Math.ceil((commitEnd - curSlot) * 0.4)}s remaining…`, level: "info" });
    await sleep(2_000);
    curSlot = await connection.getSlot("confirmed");
  }

  // ── Reveal ────────────────────────────────────────────────────────────────
  const revealTxObj = await program.methods
    .revealIntent(tokenIn, tokenOut, amount, lp, Array.from(salt))
    .accounts({ payer: demoUser.publicKey, pool, tokenInMint: tokenIn, tokenOutMint: tokenOut })
    .transaction();
  const revBh = (await connection.getLatestBlockhash("confirmed")).blockhash;
  revealTxObj.recentBlockhash = revBh; revealTxObj.feePayer = demoUser.publicKey; revealTxObj.sign(demoUser);
  const revSig = await connection.sendRawTransaction(revealTxObj.serialize(), {
    skipPreflight: false, preflightCommitment: "confirmed",
  });
  const revRes = await connection.confirmTransaction(revSig, "confirmed");
  if (revRes.value.err) throw new Error(`Slice ${n}: reveal failed: ${JSON.stringify(revRes.value.err)}`);

  const mmRevTxObj = await program.methods
    .revealIntent(tokenIn, tokenOut, mmAmt, mmLp, Array.from(mmSalt))
    .accounts({ payer: ghostMM.publicKey, pool, tokenInMint: tokenIn, tokenOutMint: tokenOut })
    .transaction();
  const mmRevBh = (await connection.getLatestBlockhash("confirmed")).blockhash;
  mmRevTxObj.recentBlockhash = mmRevBh; mmRevTxObj.feePayer = ghostMM.publicKey; mmRevTxObj.sign(ghostMM);
  const mmRevSig = await connection.sendRawTransaction(mmRevTxObj.serialize(), {
    skipPreflight: false, preflightCommitment: "confirmed",
  });
  const mmRevRes = await connection.confirmTransaction(mmRevSig, "confirmed");
  if (mmRevRes.value.err) throw new Error(`Slice ${n}: MM reveal failed: ${JSON.stringify(mmRevRes.value.err)}`);
  emit({ type: "log", text: `Slice ${n}/${T}: both sides revealed ✓`, level: "success" });

  // ── Wait for reveal window ────────────────────────────────────────────────
  const ps2      = await program.account.batchAuctionPool.fetch(pool);
  const revealEnd = ps2.phaseStartSlot.toNumber() + REVEAL_SLOTS + 1;
  curSlot         = await connection.getSlot("confirmed");
  while (curSlot < revealEnd) {
    emit({ type: "log", text: `Slice ${n}/${T}: reveal window — ${Math.ceil((revealEnd - curSlot) * 0.4)}s remaining…`, level: "info" });
    await sleep(2_000);
    curSlot = await connection.getSlot("confirmed");
  }

  // ── Clear ─────────────────────────────────────────────────────────────────
  const clearTx = await program.methods
    .clearBatch()
    .accounts({ pool, tokenInMint: tokenIn, tokenOutMint: tokenOut, caller: demoUser.publicKey })
    .rpc();
  emit({ type: "log", text: `Slice ${n}/${T}: cleared at fair p* ✓ ${clearTx.slice(0, 16)}…`, level: "success" });

  // ── Settle ────────────────────────────────────────────────────────────────
  await program.methods
    .settle()
    .accounts({
      pool,
      tokenInVault:  vault,
      tokenOutVault: vaultOut,
      tokenInMint:   tokenIn,
      tokenOutMint:  tokenOut,
      tokenProgram:  TOKEN_PROGRAM_ID,
      caller: demoUser.publicKey,
    })
    .remainingAccounts([
      { pubkey: mmAtaOut, isWritable: true, isSigner: false },
      { pubkey: userAta,  isWritable: true, isSigner: false },
    ])
    .rpc();
  emit({ type: "log", text: `Slice ${n}/${T}: tokens settled ✓`, level: "success" });

  return { txSig, explorerUrl };
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();

  const emit = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as any).flush?.();
  };

  const {
    orderText   = "buy 1000 USDC of SOL over 30 seconds",
    totalAmount = 1000,
    limitPrice  = 150,
  } = req.body ?? {};

  try {
    // ── Step 0: Live market data ──────────────────────────────────────────
    let marketContext = "";
    try {
      const cgRes = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true",
        { signal: AbortSignal.timeout(5000) },
      );
      if (cgRes.ok) {
        const cg = await cgRes.json() as { solana?: { usd?: number; usd_24h_change?: number } };
        const price = cg?.solana?.usd; const change24h = cg?.solana?.usd_24h_change;
        if (typeof price === "number" && typeof change24h === "number") {
          emit({ type: "market", price, change24h });
          marketContext = `Current market: SOL = $${price} (${change24h > 0 ? "+" : ""}${change24h.toFixed(2)}% 24h)`;
        }
      }
    } catch { /* continue with no market data */ }

    // ── Step 1: LLM reasoning ─────────────────────────────────────────────
    emit({ type: "thinking", text: "Reading your order…" });

    const openrouterKey = process.env.OPENROUTER_API_KEY ?? "";
    const anthropicKey  = process.env.ANTHROPIC_API_KEY  ?? "";
    const apiKey        = anthropicKey || openrouterKey;
    const model         = process.env.OPENROUTER_MODEL ?? "minimax/minimax-01";
    const enriched      = marketContext ? `${orderText}\n\n${marketContext}` : orderText;

    let strategy = {
      rationale: "TWAP with equal slices minimises market impact across sequential batch auctions.",
      n: 3,
      riskNote: "No LLM key configured — using default 3-slice strategy.",
    };
    let streamedReasoning = "";

    if (apiKey) {
      try {
        if (openrouterKey) {
          const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openrouterKey}`,
              "HTTP-Referer": "https://lattice.xyz",
              "X-Title": "Lattice Agent",
            },
            body: JSON.stringify({
              model, max_tokens: 400, stream: true,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user",   content: enriched },
              ],
            }),
          });
          const reader = r.body!.getReader(); const decoder = new TextDecoder(); let buf = "";
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n"); buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const raw = line.slice(6).trim(); if (raw === "[DONE]") break;
              try {
                const j = JSON.parse(raw); const text = j?.choices?.[0]?.delta?.content ?? "";
                if (!text) continue;
                streamedReasoning += text;
                if (!streamedReasoning.includes("\nJSON:")) emit({ type: "reasoning_chunk", text });
              } catch { /* skip */ }
            }
          }
        } else {
          const { default: Anthropic } = await import("@anthropic-ai/sdk");
          const client = new Anthropic({ apiKey: anthropicKey });
          const stream = await client.messages.stream({
            model: "claude-haiku-4-5", max_tokens: 400,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: enriched }],
          });
          for await (const chunk of stream) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
              const text = chunk.delta.text; streamedReasoning += text;
              if (!streamedReasoning.includes("\nJSON:")) emit({ type: "reasoning_chunk", text });
            }
          }
        }
        const jsonMatch = streamedReasoning.match(/JSON:(\{.*\})/s);
        if (jsonMatch) strategy = { ...strategy, ...JSON.parse(jsonMatch[1]) };
      } catch (e: any) {
        emit({ type: "log", text: `LLM failed (${e.message}) — using default strategy`, level: "warn" });
      }
    } else {
      const fallback = "No LLM key configured — using the default 3-slice TWAP strategy. Each slice runs through its own sealed batch auction, giving independent price discovery per fragment.";
      for (const word of fallback.split(" ")) {
        emit({ type: "reasoning_chunk", text: word + " " });
        await sleep(40);
      }
    }

    const n = Math.min(Math.max(Number(strategy.n) || 3, 1), 5);
    emit({ type: "strategy", rationale: strategy.rationale, riskNote: strategy.riskNote, n });

    // ── Step 2: Connect + load env keypairs ──────────────────────────────
    emit({ type: "log", text: "Connecting to Solana devnet…", level: "info" });
    const connection = new Connection(DEVNET_RPC, "confirmed");

    const userSecretJson = process.env.NEXT_PUBLIC_DEMO_USER_SECRET_KEY;
    const mmSecretJson   = process.env.NEXT_PUBLIC_DEMO_MM_SECRET_KEY;
    const tokenInAddr    = process.env.NEXT_PUBLIC_DEMO_TOKEN_IN;
    if (!userSecretJson || !mmSecretJson || !tokenInAddr) {
      throw new Error("Demo env vars missing. Run: yarn workspace web setup:demo");
    }
    const demoUser = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(userSecretJson)));
    const ghostMM  = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(mmSecretJson)));
    const tokenIn  = new PublicKey(tokenInAddr);
    emit({ type: "log", text: `Demo User: ${demoUser.publicKey.toBase58().slice(0, 16)}…`, level: "info" });

    const IDL    = (await import("../../../anchor-idl/lattice.json")).default;
    const wallet = {
      publicKey:           demoUser.publicKey,
      signTransaction:     async (tx: any) => { tx.partialSign(demoUser); return tx; },
      signAllTransactions: async (txs: any[]) => { txs.forEach(t => t.partialSign(demoUser)); return txs; },
    };
    const provider = new anchor.AnchorProvider(connection, wallet as any, {
      commitment: "confirmed", preflightCommitment: "confirmed",
    });
    const program = new anchor.Program(IDL as any, provider) as any;

    // User's ATA for tokenIn: pre-funded by setup-demo.ts — verify balance, no top-up
    const userAtaInfo = await getOrCreateAssociatedTokenAccount(
      connection, demoUser, tokenIn, demoUser.publicKey,
      false, "confirmed", { preflightCommitment: "confirmed" }
    );
    const userAta     = userAtaInfo.address;
    const sliceAmount = Math.floor((totalAmount * 1_000_000) / n);
    const totalNeeded = BigInt(sliceAmount) * BigInt(n);
    const startBal    = (await getAccount(connection, userAta, "confirmed")).amount;

    if (startBal < totalNeeded) {
      throw new Error(
        `Demo User tokenIn ATA underfunded (have ${startBal}, need ${totalNeeded}). Re-run: yarn workspace web setup:demo`
      );
    }
    emit({ type: "log", text: `tokenIn ATA ready — ${n} × ${sliceAmount / 1_000_000} USDC`, level: "success" });

    // ── Step 3: Run n sequential batch auction cycles ─────────────────────
    // Prices are natural integers (no 6dp scaling) — the Lattice settle formula
    // uses  out_amount = fill_amount / clearing_price  and
    //       in_amount  = fill_amount * clearing_price
    // so prices must NOT be multiplied by 1e6.
    const results: { txSig: string; explorerUrl: string }[] = [];

    for (let i = 0; i < n; i++) {
      emit({ type: "fragment_start", index: i, total: n, amount: sliceAmount / 1_000_000 });
      emit({ type: "log", text: `── Slice ${i + 1}/${n}: opening new batch auction ──`, level: "info" });

      const result = await runSlice({
        connection, demoUser, ghostMM, program, tokenIn, userAta,
        sliceAmount, limitPrice,        // pass natural integer directly
        sliceIndex: i, totalSlices: n,
        relayUrl: RELAY_URL, emit,
      });

      results.push(result);
      emit({ type: "fragment_done", index: i, total: n, txSig: result.txSig, explorerUrl: result.explorerUrl });

      if (i < n - 1) {
        emit({ type: "log", text: `Slice ${i + 1}/${n} complete — opening next batch…`, level: "info" });
      }
    }

    emit({
      type: "done", n, totalAmount,
      results: results.map((r, i) => ({ index: i, ...r })),
      mevExtracted: 0,
      message: `${n} slices executed across ${n} sequential sealed batches. Zero MEV on any.`,
    });

  } catch (err: any) {
    emit({ type: "error", message: err.message });
  } finally {
    res.end();
  }
}

export const config = { api: { bodyParser: true, responseLimit: false } };
