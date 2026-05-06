/**
 * x402 payment client — real ed25519 signing via nacl.
 *
 * Protocol:
 *   1. POST /commit → relay returns 402 with PAYMENT-REQUIRED header (base64 JSON)
 *   2. Agent parses envelope, signs the payment message with its keypair
 *   3. Agent retries with PAYMENT-SIGNATURE header (base64 JSON)
 *   4. Relay verifies nacl signature, submits tx to devnet
 */

import nacl from "tweetnacl";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

const RELAY_URL = process.env.RELAY_URL ?? "http://localhost:7402";

export interface RelayInfo {
  name:      string;
  endpoint:  string;
  fee:       { asset: string; amount: string };
  programId: string;
}

export async function discoverRelay(): Promise<RelayInfo> {
  const res = await fetch(`${RELAY_URL}/discovery`);
  if (!res.ok) throw new Error(`Discovery failed: ${res.status}`);
  return res.json() as Promise<RelayInfo>;
}

/** Build the JSON message the relay expects the agent to sign. */
function buildSignedMessage(opts: {
  amount:   string;
  asset:    string;
  network:  string;
  resource: string;
  nonce:    string;
}): Uint8Array {
  const msg = JSON.stringify({
    amount:   opts.amount,
    asset:    opts.asset,
    network:  opts.network,
    resource: opts.resource,
    nonce:    opts.nonce,
  });
  return Buffer.from(msg);
}

/** Sign a payment envelope with a Solana Keypair (ed25519). */
export function signPayment(
  keypair: Keypair,
  envelope: {
    maxAmountRequired: string;
    asset:             string;
    network:           string;
    resource:          string;
    nonce:             string;
  }
): string {
  const msg = buildSignedMessage({
    amount:   envelope.maxAmountRequired,
    asset:    envelope.asset,
    network:  envelope.network,
    resource: envelope.resource,
    nonce:    envelope.nonce,
  });

  const sigBytes = nacl.sign.detached(msg, keypair.secretKey);

  const header = {
    from:      keypair.publicKey.toBase58(),
    pubkey:    keypair.publicKey.toBase58(),
    signature: bs58.encode(sigBytes),
    amount:    envelope.maxAmountRequired,
    asset:     envelope.asset,
    network:   envelope.network,
    nonce:     envelope.nonce,
  };

  return Buffer.from(JSON.stringify(header)).toString("base64");
}

export interface RelayResult {
  bundleId:    string;
  txSig:       string | null;
  status:      string;
  explorerUrl: string | null;
}

/**
 * POST a CommitIntent to the relay, handling the full 402 dance.
 * Uses real nacl ed25519 signatures.
 */
export async function relayCommit(
  keypair: Keypair,
  opts: {
    commitHash: string;
    payer:      string;
    txBase64?:  string;
  }
): Promise<RelayResult> {
  const relay = await discoverRelay();

  // ── Attempt 1: No payment header → expect 402 ─────────────────────────
  const first = await fetch(relay.endpoint, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(opts),
  });

  if (first.ok) {
    return first.json() as Promise<RelayResult>;
  }
  if (first.status !== 402) {
    throw new Error(`Unexpected relay status ${first.status}`);
  }

  // ── Parse 402 envelope ─────────────────────────────────────────────────
  const envelopeB64 = first.headers.get("payment-required") ?? "";
  let envelope: {
    asset:             string;
    network:           string;
    maxAmountRequired: string;
    resource:          string;
    nonce:             string;
  };
  try {
    envelope = JSON.parse(Buffer.from(envelopeB64, "base64").toString("utf8"));
  } catch {
    throw new Error("Failed to parse 402 payment envelope");
  }

  // ── Sign and retry ─────────────────────────────────────────────────────
  const paymentSig = signPayment(keypair, envelope);

  const second = await fetch(relay.endpoint, {
    method:  "POST",
    headers: {
      "Content-Type":       "application/json",
      "payment-signature":  paymentSig,
    },
    body: JSON.stringify(opts),
  });

  if (!second.ok) {
    const body = await second.text();
    throw new Error(`Relay rejected payment: ${second.status} — ${body}`);
  }

  return second.json() as Promise<RelayResult>;
}
