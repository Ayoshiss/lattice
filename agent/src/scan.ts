/**
 * Bhairab pre-trade risk scan — the SCAN step of the agent's
 * think → scan → pay → act loop.
 *
 * Before the agent commits an order to Lattice, it asks Bhairab whether the token
 * it's about to acquire is safe. A "stop" verdict (freeze-authority honeypot, rug,
 * crash) aborts the trade before any order is placed — the guardian gating
 * MEV-proof execution. Bhairab itself runs on Bittensor (SN64) for the AI verdict.
 */
import * as dotenv from "dotenv";
dotenv.config();

const BHAIRAB_SCAN_URL =
  process.env.BHAIRAB_SCAN_URL ?? "https://tao-gateway.fly.dev/v1/risk/scan";

export interface ScanResult {
  verdict: "proceed" | "caution" | "stop";
  confidence: number;
  summary: string;
  reasons: string[];
  signals: {
    found: boolean;
    symbol?: string;
    freezable?: boolean;
    mintRenounced?: boolean;
    liquidityUsd?: number;
    priceChange24hPct?: number;
  };
  verdictSource: string;
  latencyMs: number;
}

/** Scan a Solana token mint for pre-trade risk. Retries transient failures. */
export async function scanToken(mint: string, action = "buy"): Promise<ScanResult> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(BHAIRAB_SCAN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain: "solana", token: mint, action }),
      });
      if (!res.ok) {
        throw new Error(`Bhairab scan failed (HTTP ${res.status}): ${await res.text()}`);
      }
      return (await res.json()) as ScanResult;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
