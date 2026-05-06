/**
 * Lattice Private Relay — x402-gated CommitIntent submission
 *
 * Flow:
 *   POST /commit (no payment header) → 402 + envelope + nonce
 *   POST /commit (valid PAYMENT-SIGNATURE) → submit tx to devnet, return bundleId
 */
import express, { Request, Response } from "express";
import * as dotenv from "dotenv";
import { Connection, Transaction } from "@solana/web3.js";
import {
  build402Envelope,
  parsePaymentSignature,
  verifyPaymentSignature,
} from "./x402";

dotenv.config();

const app = express();
app.use(express.json({ limit: "256kb" }));

const PORT     = parseInt(process.env.PORT ?? "7402");
const DEVNET   = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const connection = new Connection(DEVNET, "confirmed");

// Per-request nonce store (in production: Redis with TTL)
const pendingNonces = new Map<string, number>(); // nonce → expiry ts

function issueNonce(nonce: string) {
  pendingNonces.set(nonce, Date.now() + 60_000); // 60 s TTL
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

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
app.get("/discovery", (_req: Request, res: Response) => {
  res.json({
    name:        "Lattice Private Relay",
    version:     "0.2.0",
    network:     "solana",
    endpoint:    `http://localhost:${PORT}/commit`,
    fee:         { asset: "USDC-dev", amount: "0.001" },
    description: "Private CommitIntent routing — no public mempool exposure",
    programId:   "AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV",
  });
});

// ---------------------------------------------------------------------------
// POST /commit
// ---------------------------------------------------------------------------
app.post("/commit", async (req: Request, res: Response) => {
  const sigHeader = req.headers["payment-signature"] as string | undefined;

  // ── Step 1: No payment header → issue 402 ─────────────────────────────
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

  // ── Step 2: Verify signature ───────────────────────────────────────────
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

  // ── Step 3: Submit tx to devnet ────────────────────────────────────────
  const body = req.body as {
    commitHash?: string;
    payer?:      string;
    txBase64?:   string;
  };

  console.log(
    `[relay] ✓ payment from ${parsed.from.slice(0, 8)}… | hash=${(body.commitHash ?? "").slice(0, 12)}…`
  );

  let txSig: string | null = null;
  let status: "submitted" | "no_tx" = "no_tx";

  if (body.txBase64) {
    try {
      const txBytes = Buffer.from(body.txBase64, "base64");
      const tx = Transaction.from(txBytes);
      txSig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight:       false,
        preflightCommitment: "confirmed",
      });
      await connection.confirmTransaction(txSig, "confirmed");
      status = "submitted";
      console.log(`[relay] ✓ devnet tx: ${txSig}`);
    } catch (err: any) {
      console.error(`[relay] tx failed: ${err.message}`);
      res.status(500).json({ error: `Tx submission failed: ${err.message}` });
      return;
    }
  } else {
    console.log("[relay] payment accepted — no txBase64 provided (payment-only mode)");
  }

  const bundleId = txSig
    ?? `bundle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  res.setHeader(
    "PAYMENT-RESPONSE",
    Buffer.from(JSON.stringify({ paid: true, from: parsed.from })).toString("base64")
  );
  res.status(200).json({
    bundleId,
    txSig,
    status,
    message: status === "submitted"
      ? "CommitIntent confirmed on devnet"
      : "Payment accepted",
    explorerUrl: txSig
      ? `https://explorer.solana.com/tx/${txSig}?cluster=devnet`
      : null,
  });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => res.json({ ok: true, port: PORT, rpc: DEVNET }));

app.listen(PORT, () => {
  console.log(`\nLattice relay v0.2.0  →  http://localhost:${PORT}`);
  console.log(`  GET  /discovery`);
  console.log(`  POST /commit   (x402, real devnet submission)`);
  console.log(`  GET  /health\n`);
});
