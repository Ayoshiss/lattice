/**
 * Lattice Private Relay — x402-gated CommitIntent submission via Jito Bundles
 *
 * Flow:
 *   POST /commit (no payment header) → 402 + envelope + nonce
 *   POST /commit (valid PAYMENT-SIGNATURE) → bundle tx via Jito, return bundleId
 *
 * Jito integration:
 *   - Transactions are wrapped in a Jito bundle with a dynamic tip instruction.
 *   - Bundles bypass the public mempool — trade intents remain opaque until
 *     the validator includes them, eliminating pre-execution front-running.
 *   - Tip is calibrated to the 80th percentile of recent priority fees.
 *   - Falls back to direct RPC if the Jito block engine is unreachable (devnet).
 */
import express, { Request, Response } from "express";
import * as dotenv from "dotenv";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import {
  build402Envelope,
  parsePaymentSignature,
  verifyPaymentSignature,
} from "./x402";
import {
  sendCommitViaJito,
  estimateTipLamports,
  JITO_TIP_ACCOUNTS,
} from "./jito";

dotenv.config();

const app = express();
app.use(express.json({ limit: "256kb" }));

const PORT        = parseInt(process.env.PORT ?? "7402");
const DEVNET      = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const NETWORK     = (process.env.SOLANA_NETWORK ?? "devnet") as "mainnet" | "devnet";
const USE_JITO    = (process.env.USE_JITO ?? "true") !== "false";
const connection  = new Connection(DEVNET, "confirmed");

// Optional relay payer keypair for tip signing (loads from env RELAY_PAYER_SECRET_KEY as JSON array).
let relayPayer: Keypair | null = null;
const payerSecret = process.env.RELAY_PAYER_SECRET_KEY;
if (payerSecret) {
  try {
    relayPayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(payerSecret)));
    console.log(`[relay] payer loaded: ${relayPayer.publicKey.toBase58()}`);
  } catch (e) {
    console.warn("[relay] RELAY_PAYER_SECRET_KEY invalid — Jito tip signing disabled");
  }
}

// Per-request nonce store (production: Redis with TTL)
const pendingNonces = new Map<string, number>();

function issueNonce(nonce: string) {
  pendingNonces.set(nonce, Date.now() + 60_000);
  for (const [k, exp] of pendingNonces) {
    if (Date.now() > exp) pendingNonces.delete(k);
  }
}

function consumeNonce(nonce: string): boolean {
  const exp = pendingNonces.get(nonce);
  if (!exp || Date.now() > exp) return false;
  pendingNonces.delete(nonce);
  return true;
}

// ── GET /discovery ─────────────────────────────────────────────────────────────
app.get("/discovery", (_req: Request, res: Response) => {
  res.json({
    name:        "Lattice Private Relay",
    version:     "0.3.0",
    network:     "solana",
    endpoint:    `http://localhost:${PORT}/commit`,
    fee:         { asset: "USDC-dev", amount: "0.001" },
    description: "Private CommitIntent routing via Jito Bundles — zero mempool exposure",
    programId:   "AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV",
    jito: {
      enabled:      USE_JITO,
      network:      NETWORK,
      tipAccounts:  JITO_TIP_ACCOUNTS.slice(0, 3),
      tipStrategy:  "p80_priority_fee",
    },
  });
});

// ── POST /commit ───────────────────────────────────────────────────────────────
app.post("/commit", async (req: Request, res: Response) => {
  const sigHeader = req.headers["payment-signature"] as string | undefined;

  // ── Step 1: No payment header → issue 402 ──────────────────────────────────
  if (!sigHeader) {
    const { header, nonce } = build402Envelope("/commit");
    issueNonce(nonce);
    res.setHeader("PAYMENT-REQUIRED", header);
    res.status(402).json({
      error:        "Payment required",
      instructions: "Sign the PAYMENT-REQUIRED envelope and retry with PAYMENT-SIGNATURE header",
      amount:       "0.001 USDC",
    });
    return;
  }

  // ── Step 2: Verify payment signature ───────────────────────────────────────
  const parsed = parsePaymentSignature(sigHeader);
  if (!parsed) {
    res.status(400).json({ error: "Malformed PAYMENT-SIGNATURE header" });
    return;
  }

  const nonceValid = consumeNonce(parsed.nonce);
  const sigValid   = verifyPaymentSignature(parsed, parsed.nonce);

  if (!sigValid || !nonceValid) {
    const { header, nonce } = build402Envelope("/commit");
    issueNonce(nonce);
    res.setHeader("PAYMENT-REQUIRED", header);
    res.status(402).json({
      error: sigValid
        ? "Expired nonce — retry with fresh envelope"
        : "Invalid payment signature",
    });
    return;
  }

  // ── Step 3: Submit via Jito bundle (or direct RPC fallback) ────────────────
  const body = req.body as {
    commitHash?: string;
    payer?:      string;
    txBase64?:   string;
  };

  console.log(
    `[relay] ✓ payment from ${parsed.from.slice(0, 8)}… | hash=${(body.commitHash ?? "").slice(0, 12)}…`
  );

  if (!body.txBase64) {
    console.log("[relay] payment accepted — no txBase64 provided (payment-only mode)");
    const bundleId = `bundle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    res.setHeader(
      "PAYMENT-RESPONSE",
      Buffer.from(JSON.stringify({ paid: true, from: parsed.from })).toString("base64")
    );
    res.status(200).json({
      bundleId,
      txSig:       null,
      status:      "no_tx",
      message:     "Payment accepted",
      explorerUrl: null,
    });
    return;
  }

  const txBytes = Buffer.from(body.txBase64, "base64");

  // ── Jito bundle submission path ────────────────────────────────────────────
  if (USE_JITO && relayPayer) {
    try {
      const result = await sendCommitViaJito(connection, txBytes, relayPayer, NETWORK);

      console.log(
        `[relay] ✓ jito bundle: ${result.bundleId} | tip=${result.jitoTipLamports} lamports | status=${result.status}`
      );

      res.setHeader(
        "PAYMENT-RESPONSE",
        Buffer.from(JSON.stringify({ paid: true, from: parsed.from })).toString("base64")
      );
      res.status(200).json({
        bundleId:        result.bundleId,
        txSig:           result.txSig,
        status:          result.status,
        jitoTipLamports: result.jitoTipLamports,
        message:         result.status === "landed"
          ? "CommitIntent landed via Jito bundle"
          : "CommitIntent bundle submitted to Jito block engine",
        explorerUrl: result.explorerUrl,
      });
      return;
    } catch (err: any) {
      console.error(`[relay] Jito path failed: ${err.message} — falling through to direct RPC`);
    }
  }

  // ── Direct RPC fallback (no Jito payer configured or Jito disabled) ─────────
  try {
    const tx    = Transaction.from(txBytes);
    const txSig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight:       false,
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(txSig, "confirmed");

    console.log(`[relay] ✓ devnet tx (direct): ${txSig}`);

    res.setHeader(
      "PAYMENT-RESPONSE",
      Buffer.from(JSON.stringify({ paid: true, from: parsed.from })).toString("base64")
    );
    res.status(200).json({
      bundleId:    txSig,
      txSig,
      status:      "submitted",
      message:     "CommitIntent confirmed on devnet (direct RPC)",
      explorerUrl: `https://explorer.solana.com/tx/${txSig}?cluster=devnet`,
    });
  } catch (err: any) {
    console.error(`[relay] tx failed: ${err.message}`);
    res.status(500).json({ error: `Tx submission failed: ${err.message}` });
  }
});

// ── GET /tip-estimate ──────────────────────────────────────────────────────────
app.get("/tip-estimate", async (_req: Request, res: Response) => {
  try {
    const lamports = await estimateTipLamports(connection);
    res.json({
      strategy:    "p80_priority_fee",
      lamports,
      sol:         lamports / 1e9,
      jitoEnabled: USE_JITO,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /health ────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) =>
  res.json({ ok: true, port: PORT, rpc: DEVNET, jitoEnabled: USE_JITO, network: NETWORK })
);

app.listen(PORT, () => {
  console.log(`\nLattice relay v0.3.0  →  http://localhost:${PORT}`);
  console.log(`  GET  /discovery`);
  console.log(`  POST /commit       (x402 → Jito bundle)`);
  console.log(`  GET  /tip-estimate (dynamic tip calibration)`);
  console.log(`  GET  /health`);
  console.log(`\n  Jito: ${USE_JITO ? "ENABLED" : "disabled (direct RPC)"} | network: ${NETWORK}\n`);
});
