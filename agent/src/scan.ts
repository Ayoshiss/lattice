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

// An API key authenticates the scan against the keyed tier, which isn't subject to
// the free tier's per-IP rate limit. When present we send it; the scan still works
// keyless, it's just more rate-limit-resilient under load.
const BHAIRAB_API_KEY = process.env.BHAIRAB_API_KEY ?? "";

// Per-attempt timeout. A guardian that hangs is as dangerous as one that's wrong:
// it stalls the agent indefinitely. We bound each attempt so a slow scan surfaces
// as a retryable error and, if all retries exhaust, fails closed at the caller.
const SCAN_TIMEOUT_MS = Number(process.env.BHAIRAB_SCAN_TIMEOUT_MS ?? 6000);
const SCAN_MAX_ATTEMPTS = Number(process.env.BHAIRAB_SCAN_ATTEMPTS ?? 4);

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

/** Scan a Solana token mint for pre-trade risk. Retries transient failures,
 *  and bounds each attempt with a timeout so a hung guardian can't stall the agent. */
export async function scanToken(mint: string, action = "buy"): Promise<ScanResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (BHAIRAB_API_KEY) headers["Authorization"] = `Bearer ${BHAIRAB_API_KEY}`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= SCAN_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
    try {
      const res = await fetch(BHAIRAB_SCAN_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ chain: "solana", token: mint, action }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Bhairab scan failed (HTTP ${res.status}): ${await res.text()}`);
      }
      return (await res.json()) as ScanResult;
    } catch (e) {
      lastErr =
        e instanceof Error && e.name === "AbortError"
          ? new Error(`Bhairab scan timed out after ${SCAN_TIMEOUT_MS}ms`)
          : e;
      if (attempt < SCAN_MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 800 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
