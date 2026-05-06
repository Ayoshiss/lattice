/** Pure-math AMM + Lattice simulation — no Solana deps, runs in browser. */

export const DEC = 1_000_000n;

export function ammOut(reserveIn: bigint, reserveOut: bigint, amountIn: bigint): bigint {
  if (amountIn === 0n) return 0n;
  return (reserveOut * amountIn) / (reserveIn + amountIn);
}

export function toBps(loss: bigint, base: bigint): number {
  if (base === 0n) return 0;
  return Number((loss * 10_000n) / base);
}

export function toDisplay(n: bigint, decimals = 6, maxFrac = 2): string {
  const s = n.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals) || "0";
  const fracFull = s.slice(-decimals).replace(/0+$/, "");
  const frac = fracFull.slice(0, maxFrac).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

export interface SimResult {
  // AMM baseline (no attack)
  baselineOut: bigint;
  baselineSlipBps: number;

  // Searcher front-run
  searcherSolOut: bigint;
  poolAfterFrontrun: { usdc: bigint; sol: bigint };

  // Victim after front-run
  victimOutAfter: bigint;
  victimLossBps: number;

  // Searcher back-run
  searcherUsdcBack: bigint;
  searcherProfit: bigint;
  mevExtractedBps: number;

  // Lattice
  latticePrice: bigint;
  latticeVictimSol: bigint;
  latticeImprovementSol: bigint;
}

export interface SimParams {
  poolUsdc: bigint;
  poolSol: bigint;
  victimIn: bigint;
  searcherIn: bigint;
}

export function runSimulation(p: SimParams): SimResult {
  const { poolUsdc, poolSol, victimIn, searcherIn } = p;

  // ── AMM baseline ──────────────────────────────────────────────────────────
  const baselineOut = ammOut(poolUsdc, poolSol, victimIn);
  const fairOut = (victimIn * poolSol) / poolUsdc;
  const baselineLoss = fairOut > baselineOut ? fairOut - baselineOut : 0n;
  const baselineSlipBps = toBps(baselineLoss, fairOut);

  // ── Front-run ─────────────────────────────────────────────────────────────
  const searcherSolOut = ammOut(poolUsdc, poolSol, searcherIn);
  const poolUsdc1 = poolUsdc + searcherIn;
  const poolSol1  = poolSol  - searcherSolOut;

  // ── Victim after front-run ────────────────────────────────────────────────
  const victimOutAfter = ammOut(poolUsdc1, poolSol1, victimIn);
  const poolUsdc2 = poolUsdc1 + victimIn;
  const poolSol2  = poolSol1  - victimOutAfter;
  const victimLoss = baselineOut > victimOutAfter ? baselineOut - victimOutAfter : 0n;
  const victimLossBps = toBps(victimLoss, baselineOut);

  // ── Back-run ──────────────────────────────────────────────────────────────
  const searcherUsdcBack = ammOut(poolSol2, poolUsdc2, searcherSolOut);
  const searcherProfit = searcherUsdcBack > searcherIn ? searcherUsdcBack - searcherIn : 0n;
  const mevExtractedBps = toBps(victimLoss, baselineOut);

  // ── Lattice ───────────────────────────────────────────────────────────────
  // Victim (buy, limit 102), Other buyer (buy, limit 101), MM (sell, limit 99)
  // Binary search: candidate prices = [99, 101, 102]
  // At p=99: buyVol(≥99) = victimIn + 5000 USDC equiv, sellVol(≤99) = 15000 USDC equiv
  // Simplified: clear at 99 USDC/SOL → victim gets victimIn / 99 SOL
  const latticePrice = 99n * DEC; // USDC per SOL
  const latticeVictimSol = (victimIn * DEC) / latticePrice;
  const latticeImprovementSol = latticeVictimSol > baselineOut ? latticeVictimSol - baselineOut : 0n;

  return {
    baselineOut, baselineSlipBps,
    searcherSolOut, poolAfterFrontrun: { usdc: poolUsdc1, sol: poolSol1 },
    victimOutAfter, victimLossBps,
    searcherUsdcBack, searcherProfit, mevExtractedBps,
    latticePrice, latticeVictimSol, latticeImprovementSol,
  };
}

export const DEFAULT_PARAMS: SimParams = {
  poolUsdc:   1_000_000n * DEC,
  poolSol:       10_000n * DEC,
  victimIn:      10_000n * DEC,
  searcherIn:     5_000n * DEC,
};
