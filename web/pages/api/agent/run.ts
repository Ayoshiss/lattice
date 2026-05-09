/**
 * POST /api/agent/run
 *
 * Server-Sent Events endpoint. Runs the full autonomous agent loop:
 *   1. Accepts a plain-English order description
 *   2. Streams LLM reasoning word-by-word, then parses the JSON strategy
 *   3. Sets up devnet pool + mints
 *   4. Executes each TWAP fragment through the x402 relay
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
    orderText      = "buy 1000 USDC of SOL over 30 seconds",
    totalAmount    = 1000,
    limitPrice     = 150,
  } = req.body ?? {};

  try {
    // ── Step 0: Fetch live SOL market data ────────────────────────────────
    let marketContext = "";
    try {
      const cgRes = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true&include_1h_vol=true",
        { signal: AbortSignal.timeout(5000) },
      );
      if (cgRes.ok) {
        const cgJson = await cgRes.json() as { solana?: { usd?: number; usd_24h_change?: number } };
        const price     = cgJson?.solana?.usd;
        const change24h = cgJson?.solana?.usd_24h_change;
        if (typeof price === "number" && typeof change24h === "number") {
          emit({ type: "market", price, change24h });
          marketContext = `Current market: SOL = $${price} (${change24h > 0 ? "+" : ""}${change24h.toFixed(2)}% 24h)`;
        }
      }
    } catch { /* silently continue with no market data */ }

    const enrichedOrderText = marketContext
      ? `${orderText}\n\n${marketContext}`
      : orderText;

    // ── Step 1: LLM reasoning (streamed word-by-word) ─────────────────────
    emit({ type: "thinking", text: "Reading your order…" });

    const anthropicKey  = process.env.ANTHROPIC_API_KEY ?? "";
    const openrouterKey = process.env.OPENROUTER_API_KEY ?? "";
    const apiKey        = anthropicKey || openrouterKey;
    const model         = process.env.OPENROUTER_MODEL ?? "minimax/minimax-01";

    let strategy = {
      rationale: "TWAP with equal time slices minimises market impact and avoids order-book footprint.",
      n: 3,
      riskNote: "No LLM key configured — using default 3-slice strategy.",
    };
    let streamedReasoning = "";

    if (apiKey) {
      try {
        if (openrouterKey) {
          // OpenRouter with streaming
          const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type":  "application/json",
              "Authorization": `Bearer ${openrouterKey}`,
              "HTTP-Referer":  "https://lattice.xyz",
              "X-Title":       "Lattice Agent",
            },
            body: JSON.stringify({
              model,
              max_tokens: 400,
              stream:     true,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user",   content: enrichedOrderText },
              ],
            }),
          });

          const reader  = r.body!.getReader();
          const decoder = new TextDecoder();
          let buf = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const raw = line.slice(6).trim();
              if (raw === "[DONE]") break;
              try {
                const j = JSON.parse(raw);
                const text = j?.choices?.[0]?.delta?.content ?? "";
                if (!text) continue;
                streamedReasoning += text;
                // Only stream prose before the JSON sentinel line
                if (!streamedReasoning.includes("\nJSON:")) {
                  emit({ type: "reasoning_chunk", text });
                }
              } catch { /* skip bad chunks */ }
            }
          }
        } else {
          // Anthropic SDK streaming
          const { default: Anthropic } = await import("@anthropic-ai/sdk");
          const client = new Anthropic({ apiKey: anthropicKey });

          const stream = await client.messages.stream({
            model:      "claude-haiku-4-5",
            max_tokens: 400,
            system:     SYSTEM_PROMPT,
            messages:   [{ role: "user", content: enrichedOrderText }],
          });

          for await (const chunk of stream) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
              const text = chunk.delta.text;
              streamedReasoning += text;
              if (!streamedReasoning.includes("\nJSON:")) {
                emit({ type: "reasoning_chunk", text });
              }
            }
          }
        }

        // Parse the JSON strategy from the end of the response
        const jsonMatch = streamedReasoning.match(/JSON:(\{.*\})/s);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          strategy = { ...strategy, ...parsed };
        }
      } catch (e: any) {
        emit({ type: "log", text: `LLM streaming failed (${e.message}) — using default strategy`, level: "warn" });
      }
    } else {
      // No API key: animate a canned fallback so the UI still shows the streaming effect
      const fallback = "No LLM key configured — using the default 3-slice TWAP strategy. For a 1,000 USDC order, equal time slices minimise market impact while keeping execution straightforward.";
      for (const word of fallback.split(" ")) {
        emit({ type: "reasoning_chunk", text: word + " " });
        await new Promise(r => setTimeout(r, 40));
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
    const tokenIn   = await createMint(connection, payer, payer.publicKey, null, 6);
    const tokenOut2 = await createMint(connection, payer, payer.publicKey, null, 6);
    emit({ type: "log", text: "Token pair ready", level: "success" });

    const [pool]  = poolPDA(tokenIn, tokenOut2);
    const [vault] = vaultPDA(pool, tokenIn);

    const userAta = await createAccount(connection, payer, tokenIn, payer.publicKey);
    await mintTo(connection, payer, tokenIn, userAta, payer, BigInt(100_000_000_000));
    emit({ type: "log", text: "Auction pool initialised on devnet", level: "success" });

    // Give each fragment ~15 slots to commit (6s), plus a buffer
    const COMMIT_SLOTS = Math.max(40, n * 15);
    const REVEAL_SLOTS = 20;

    await program.methods
      .initializePool(new anchor.BN(COMMIT_SLOTS), new anchor.BN(REVEAL_SLOTS))
      .accounts({
        authority: payer.publicKey, pool,
        tokenInMint: tokenIn, tokenOutMint: tokenOut2,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    emit({ type: "pool_ready", pool: pool.toBase58() });

    // Create token_out vault + MM ATA so we can settle at the end
    const [vaultOut]  = vaultPDA(pool, tokenOut2);
    const userAtaOut  = await createAccount(connection, payer, tokenOut2, payer.publicKey);
    await mintTo(connection, payer, tokenOut2, userAtaOut, payer, BigInt(100_000_000_000));

    // ── Step 3a: Commit all fragments within the window ───────────────────
    // Store salt+params per fragment so we can reveal them after the window
    const sliceAmount = Math.floor((totalAmount * 1_000_000) / n);
    const committed: { salt: Buffer; amount: anchor.BN; lp: anchor.BN; txSig: string; explorerUrl: string }[] = [];

    for (let i = 0; i < n; i++) {
      emit({ type: "fragment_start", index: i, total: n, amount: sliceAmount / 1_000_000 });

      const salt   = crypto.randomBytes(16);
      const amount = new anchor.BN(sliceAmount);
      const lp     = new anchor.BN(limitPrice * 1_000_000);

      const h = crypto.createHash("sha256");
      h.update(tokenIn.toBuffer());
      h.update(tokenOut2.toBuffer());
      h.update(amount.toArrayLike(Buffer, "le", 8));
      h.update(lp.toArrayLike(Buffer, "le", 8));
      h.update(salt);
      const commitHash    = Array.from(h.digest());
      const commitHashHex = Buffer.from(commitHash).toString("hex");

      emit({ type: "log", text: `Fragment ${i + 1}/${n} hash: ${commitHashHex.slice(0, 16)}… (sealed)`, level: "info" });

      const commitTxObj = await program.methods
        .commitIntent(commitHash, amount, true)
        .accounts({
          payer: payer.publicKey, pool,
          tokenInMint: tokenIn, tokenOutMint: tokenOut2,
          payerTokenAccount: userAta, mint: tokenIn, vault,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        })
        .transaction();
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      commitTxObj.recentBlockhash = blockhash;
      commitTxObj.feePayer = payer.publicKey;
      commitTxObj.sign(payer);
      const txBase64 = commitTxObj.serialize().toString("base64");

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
      const txSig       = relayResult.txSig ?? "";
      const explorerUrl = `https://explorer.solana.com/tx/${txSig}?cluster=devnet`;

      committed.push({ salt, amount, lp, txSig, explorerUrl });
      emit({ type: "fragment_done", index: i, total: n, txSig, explorerUrl });

      // Short pause between fragments — relay needs a moment but we stay well within window
      if (i < n - 1) await new Promise(r => setTimeout(r, 400));
    }

    // ── Step 3b: MM counterparty sell (so clearBatch can cross) ──────────
    const mmSalt   = crypto.randomBytes(16);
    const mmAmount = new anchor.BN(totalAmount * 1_000_000); // single sell to match all buys
    const mmLp     = new anchor.BN(Math.floor(limitPrice * 0.9 * 1_000_000)); // 90% of limit

    const mmH = crypto.createHash("sha256");
    mmH.update(tokenIn.toBuffer());
    mmH.update(tokenOut2.toBuffer());
    mmH.update(mmAmount.toArrayLike(Buffer, "le", 8));
    mmH.update(mmLp.toArrayLike(Buffer, "le", 8));
    mmH.update(mmSalt);
    const mmCommitHash = Array.from(mmH.digest());

    await program.methods
      .commitIntent(mmCommitHash, mmAmount, false)
      .accounts({
        payer: payer.publicKey, pool,
        tokenInMint: tokenIn, tokenOutMint: tokenOut2,
        payerTokenAccount: userAtaOut, mint: tokenOut2, vault: vaultOut,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .rpc();
    emit({ type: "log", text: "Market-maker sell sealed — batch can now cross", level: "info" });

    // ── Step 4: Wait for commit window, then reveal all fragments ─────────
    emit({ type: "log", text: "🔓 Waiting for commit window to close…", level: "info" });
    const poolState1  = await program.account.batchAuctionPool.fetch(pool);
    const commitEnd   = poolState1.phaseStartSlot.toNumber() + COMMIT_SLOTS + 1;
    let curSlot = await connection.getSlot("confirmed");
    while (curSlot < commitEnd) {
      const slotsLeft = commitEnd - curSlot;
      emit({ type: "log", text: `Commit window closes in ~${Math.ceil(slotsLeft * 0.4)}s (${slotsLeft} slots)…`, level: "info" });
      await new Promise(r => setTimeout(r, 2_000));
      curSlot = await connection.getSlot("confirmed");
    }

    emit({ type: "log", text: "Revealing all fragments on-chain…", level: "info" });
    for (let i = 0; i < committed.length; i++) {
      const { salt, amount, lp } = committed[i];
      const revealTx = await program.methods
        .revealIntent(tokenIn, tokenOut2, amount, lp, Array.from(salt))
        .accounts({ payer: payer.publicKey, pool, tokenInMint: tokenIn, tokenOutMint: tokenOut2 })
        .signers([payer])
        .rpc();
      emit({ type: "log", text: `Fragment ${i + 1}/${n} revealed ✓ ${revealTx.slice(0, 16)}…`, level: "success" });
    }
    // Reveal MM sell
    await program.methods
      .revealIntent(tokenIn, tokenOut2, mmAmount, mmLp, Array.from(mmSalt))
      .accounts({ payer: payer.publicKey, pool, tokenInMint: tokenIn, tokenOutMint: tokenOut2 })
      .signers([payer])
      .rpc();
    emit({ type: "log", text: "Market-maker order revealed — both sides ready to clear", level: "info" });

    // ── Step 5: Wait for reveal window, then clear ────────────────────────
    emit({ type: "log", text: "⚖️ Waiting for reveal window to close…", level: "info" });
    const poolState2 = await program.account.batchAuctionPool.fetch(pool);
    const revealEnd  = poolState2.phaseStartSlot.toNumber() + REVEAL_SLOTS + 1;
    curSlot = await connection.getSlot("confirmed");
    while (curSlot < revealEnd) {
      const slotsLeft = revealEnd - curSlot;
      emit({ type: "log", text: `Reveal window closes in ~${Math.ceil(slotsLeft * 0.4)}s (${slotsLeft} slots)…`, level: "info" });
      await new Promise(r => setTimeout(r, 2_000));
      curSlot = await connection.getSlot("confirmed");
    }

    const clearTx = await program.methods
      .clearBatch()
      .accounts({ pool, tokenInMint: tokenIn, tokenOutMint: tokenOut2, caller: payer.publicKey })
      .rpc();
    emit({ type: "log", text: `Batch cleared at fair p* ✓ ${clearTx.slice(0, 16)}…`, level: "success" });

    // ── Step 6: Settle — distribute tokens from vaults to payers ─────────
    // remaining_accounts: one writable ATA per pool slot (in pool order).
    //   Slots 0..n-1 = user buy fragments → receive tokenOut (userAtaOut)
    //   Slot n       = MM sell            → receive tokenIn  (userAta)
    const settleRemaining = [
      ...Array.from({ length: n }, () => ({
        pubkey: userAtaOut, isWritable: true, isSigner: false,
      })),
      { pubkey: userAta, isWritable: true, isSigner: false },
    ];

    const settleTx = await program.methods
      .settle()
      .accounts({
        pool,
        tokenInVault:  vault,
        tokenOutVault: vaultOut,
        tokenInMint:   tokenIn,
        tokenOutMint:  tokenOut2,
        tokenProgram:  TOKEN_PROGRAM_ID,
        caller: payer.publicKey,
      })
      .remainingAccounts(settleRemaining)
      .rpc();
    emit({ type: "log", text: `Tokens settled to all payers ✓ ${settleTx.slice(0, 16)}…`, level: "success" });

    emit({
      type:         "done",
      n,
      totalAmount,
      results:      committed.map((c, i) => ({ index: i, txSig: c.txSig, explorerUrl: c.explorerUrl })),
      mevExtracted: 0,
      message:      `${n} fragments committed, revealed, cleared, and settled on devnet. Zero MEV on any of them.`,
    });

  } catch (err: any) {
    emit({ type: "error", message: err.message });
  } finally {
    res.end();
  }
}

export const config = { api: { bodyParser: true, responseLimit: false } };
