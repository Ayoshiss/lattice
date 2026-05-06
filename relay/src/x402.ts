import { Buffer } from "buffer";
import nacl from "tweetnacl";
import bs58 from "bs58";

export const RELAY_USDC_RECIPIENT =
  process.env.RELAY_USDC_RECIPIENT ?? "11111111111111111111111111111111";

const USDC_DEV_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export interface PaymentRequired {
  scheme: "exact";
  network: "solana";
  asset: string;
  recipient: string;
  maxAmountRequired: string;
  resource: string;
  mimeType: string;
  nonce: string;
}

export function build402Envelope(resource: string): { header: string; nonce: string } {
  const nonce = Buffer.from(nacl.randomBytes(16)).toString("hex");
  const payload: PaymentRequired = {
    scheme:             "exact",
    network:            "solana",
    asset:              USDC_DEV_MINT,
    recipient:          RELAY_USDC_RECIPIENT,
    maxAmountRequired:  "1000",    // 0.001 USDC (6 dec)
    resource,
    mimeType:           "application/json",
    nonce,
  };
  return {
    header: Buffer.from(JSON.stringify(payload)).toString("base64"),
    nonce,
  };
}

export interface PaymentSignatureHeader {
  from:      string;   // base58 ed25519 pubkey
  pubkey:    string;   // same as from (explicit)
  signature: string;   // base58 nacl signature over the signed message
  amount:    string;
  asset:     string;
  network:   string;
  nonce:     string;   // must match the 402 nonce
}

/** The signed message the agent produces: JSON-stable representation. */
export function buildSignedMessage(opts: {
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

export function parsePaymentSignature(
  header: string
): PaymentSignatureHeader | null {
  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    return JSON.parse(decoded) as PaymentSignatureHeader;
  } catch {
    return null;
  }
}

/**
 * Verify: ed25519 signature over the signed message matches pubkey,
 * amount >= 1000 (0.001 USDC), nonce matches server's expected nonce.
 */
export function verifyPaymentSignature(
  sig: PaymentSignatureHeader,
  expectedNonce?: string
): boolean {
  try {
    // Structural check
    if (!sig.from || !sig.signature || !sig.pubkey) return false;
    if (parseInt(sig.amount) < 1000) return false;
    if (expectedNonce && sig.nonce !== expectedNonce) return false;

    const pubkeyBytes = bs58.decode(sig.pubkey);
    const sigBytes    = bs58.decode(sig.signature);
    const msg = buildSignedMessage({
      amount:   sig.amount,
      asset:    sig.asset,
      network:  sig.network,
      resource: "/commit",
      nonce:    sig.nonce,
    });

    return nacl.sign.detached.verify(msg, sigBytes, pubkeyBytes);
  } catch {
    return false;
  }
}
