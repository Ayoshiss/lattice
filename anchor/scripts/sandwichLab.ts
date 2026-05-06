/**
 * Lattice SandwichLab — Day 2
 *
 * Side-by-side comparison:
 *   A) mockAMM (x·y=k)  — victim gets sandwiched, MEV extracted
 *   B) Lattice batch auction — uniform price, MEV = 0
 *
 * All arithmetic uses bigint for precision; amounts in base units (6 decimals).
 */

// ── ANSI colours ─────────────────────────────────────────────────────────────
const R = "\x1b[31m"; // red
const G = "\x1b[32m"; // green
const Y = "\x1b[33m"; // yellow
const C = "\x1b[36m"; // cyan
const B = "\x1b[1m";  // bold
const X = "\x1b[0m";  // reset

function fmt(n: bigint, decimals = 6): string {
  const s = n.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

function bps(val: bigint, base: bigint): string {
  return ((val * 10_000n) / base).toString();
}

// ── AMM maths (mirrors Rust constant-product logic) ──────────────────────────
function ammOut(reserveIn: bigint, reserveOut: bigint, amountIn: bigint): bigint {
  return (reserveOut * amountIn) / (reserveIn + amountIn);
}

// ── Lattice maths ─────────────────────────────────────────────────────────────
interface Order {
  amount: bigint;
  limitPrice: bigint; // USDC per SOL, 6 dec
  isBuy: boolean;
}

function clearingPrice(orders: Order[]): { price: bigint; matchedVol: bigint } {
  const revealed = orders.filter((o) => true); // all committed orders
  const prices = [...new Set(revealed.map((o) => o.limitPrice))].sort(
    (a, b) => Number(a - b)
  );

  let bestPrice = 0n;
  let bestVol = 0n;

  for (const p of prices) {
    const buyVol = revealed
      .filter((o) => o.isBuy && o.limitPrice >= p)
      .reduce((s, o) => s + o.amount, 0n);
    const sellVol = revealed
      .filter((o) => !o.isBuy && o.limitPrice <= p)
      .reduce((s, o) => s + o.amount, 0n);
    const matched = buyVol < sellVol ? buyVol : sellVol;

    if (matched > bestVol || (matched === bestVol && p < bestPrice)) {
      bestVol = matched;
      bestPrice = p;
    }
  }
  return { price: bestPrice, matchedVol: bestVol };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SCENARIO
// ═══════════════════════════════════════════════════════════════════════════════
//  Pool:    1,000,000 USDC / 10,000 SOL  → fair price = 100 USDC/SOL
//  Victim:  buy 10,000 USDC worth of SOL (limit = 102 USDC/SOL)
//  Searcher front-runs with 5,000 USDC, then back-runs
// ═══════════════════════════════════════════════════════════════════════════════

const DEC = 1_000_000n; // 6 decimals

// Pool reserves
const POOL_USDC = 1_000_000n * DEC; // 1 M USDC
const POOL_SOL  =    10_000n * DEC; // 10 k SOL (scaled)

// Victim order
const VICTIM_IN      =  10_000n * DEC; // 10,000 USDC
const VICTIM_LIMIT   =     102n * DEC; // max 102 USDC/SOL

// Searcher front-run size
const SEARCHER_USDC  =   5_000n * DEC; // 5,000 USDC

// ── A. mockAMM ───────────────────────────────────────────────────────────────
console.log();
console.log(`${B}${C}╔═══════════════════════════════════════════════════════╗${X}`);
console.log(`${B}${C}║            LATTICE  SANDWICH  LAB                     ║${X}`);
console.log(`${B}${C}╠═══════════════════════════════════════════════════════╣${X}`);
console.log(`${B}${C}║  Pool:   1,000,000 USDC  /  10,000 SOL               ║${X}`);
console.log(`${B}${C}║  Fair price:  100 USDC / SOL                          ║${X}`);
console.log(`${B}${C}║  Victim:      buy 10,000 USDC → SOL (limit 102)       ║${X}`);
console.log(`${B}${C}║  Searcher:    front-run 5,000 USDC, back-run profit    ║${X}`);
console.log(`${B}${C}╚═══════════════════════════════════════════════════════╝${X}`);
console.log();

// ── Baseline: victim WITHOUT sandwich ────────────────────────────────────────
const baselineOut = ammOut(POOL_USDC, POOL_SOL, VICTIM_IN);
const fairOut     = (VICTIM_IN * POOL_SOL) / POOL_USDC; // ideal at mid-price
const baseSlip    = fairOut - baselineOut;               // loss in SOL

console.log(`${B}━━━  A. mockAMM (x·y=k constant-product)  ━━━${X}`);
console.log();
console.log(`  ${Y}Without sandwich:${X}`);
console.log(`    Victim sends  : ${fmt(VICTIM_IN)} USDC`);
console.log(`    Ideal output  : ${fmt(fairOut)} SOL   (at fair price 100 USDC/SOL)`);
console.log(`    Actual output : ${fmt(baselineOut)} SOL`);
console.log(`    Slippage      : ${fmt(baseSlip)} SOL  (${bps(baseSlip, fairOut)} bps)`);
console.log();

// ── Step 1: Searcher front-run ────────────────────────────────────────────────
const searcherSolOut = ammOut(POOL_USDC, POOL_SOL, SEARCHER_USDC);
const poolUsdc1      = POOL_USDC + SEARCHER_USDC;
const poolSol1       = POOL_SOL  - searcherSolOut;

console.log(`  ${R}Front-run (searcher buys ${fmt(SEARCHER_USDC)} USDC → SOL first):${X}`);
console.log(`    Searcher gets : ${fmt(searcherSolOut)} SOL`);
console.log(`    Pool after    : ${fmt(poolUsdc1)} USDC / ${fmt(poolSol1)} SOL`);
console.log();

// ── Step 2: Victim executes AFTER front-run ───────────────────────────────────
const victimOutAfter    = ammOut(poolUsdc1, poolSol1, VICTIM_IN);
const poolUsdc2         = poolUsdc1 + VICTIM_IN;
const poolSol2          = poolSol1  - victimOutAfter;
const victimMEVloss     = baselineOut - victimOutAfter; // SOL stolen from victim
const victimMEVlossUsdc = (victimMEVloss * 100n);       // rough USDC value at 100/SOL

console.log(`  ${R}Victim executes AFTER front-run:${X}`);
console.log(`    Victim gets   : ${fmt(victimOutAfter)} SOL   (was ${fmt(baselineOut)} without sandwich)`);
console.log(`    Loss to victim: ${fmt(victimMEVloss)} SOL  (${bps(victimMEVloss, baselineOut)} bps degradation)`);
console.log();

// ── Step 3: Searcher back-run ─────────────────────────────────────────────────
const searcherUsdcBack = ammOut(poolSol2, poolUsdc2, searcherSolOut);
const searcherProfit   = searcherUsdcBack > SEARCHER_USDC
  ? searcherUsdcBack - SEARCHER_USDC
  : 0n;

console.log(`  ${R}Back-run (searcher sells ${fmt(searcherSolOut)} SOL → USDC):${X}`);
console.log(`    Searcher gets : ${fmt(searcherUsdcBack)} USDC   (spent ${fmt(SEARCHER_USDC)} USDC)`);
console.log(`    Searcher profit: ${fmt(searcherProfit)} USDC   ← MEV extracted from victim`);
console.log();
console.log(`  ${B}${R}TOTAL MEV EXTRACTED: ${fmt(searcherProfit)} USDC  (${bps(victimMEVloss, baselineOut)} bps of victim's fill)${X}`);
console.log();

// ── B. Lattice batch auction ──────────────────────────────────────────────────
console.log(`${B}━━━  B. Lattice Batch Auction (commit-reveal, uniform price)  ━━━${X}`);
console.log();

// Same market participants now submit sealed orders in the same batch.
// A market-maker provides liquidity: sell 10,000 USDC of SOL at limit 100.
const orders: Order[] = [
  { amount: VICTIM_IN,   limitPrice: VICTIM_LIMIT,  isBuy: true  }, // victim
  { amount: 5_000n*DEC,  limitPrice: 101n*DEC,       isBuy: true  }, // other buyer
  { amount: 15_000n*DEC, limitPrice: 99n*DEC,        isBuy: false }, // MM sells SOL
];

const { price: p_star, matchedVol } = clearingPrice(orders);
const victimFill = orders[0].limitPrice >= p_star ? orders[0].amount : 0n;
const victimSolOut = p_star > 0n ? (victimFill * DEC) / p_star : 0n;

console.log(`  Orders submitted (sealed — no one sees prices until reveal):`);
console.log(`    Victim  : buy  ${fmt(orders[0].amount)} USDC, limit ${fmt(orders[0].limitPrice,6)} USDC/SOL`);
console.log(`    Other   : buy  ${fmt(orders[1].amount)} USDC, limit ${fmt(orders[1].limitPrice,6)} USDC/SOL`);
console.log(`    MM      : sell ${fmt(orders[2].amount)} USDC of SOL, limit ${fmt(orders[2].limitPrice,6)} USDC/SOL`);
console.log();

if (p_star > 0n) {
  console.log(`  ${G}Batch clears at uniform price p* = ${fmt(p_star)} USDC/SOL${X}`);
  console.log(`  ${G}Victim receives : ${fmt(victimSolOut)} SOL${X}`);
  console.log(`  ${G}vs no-sandwich  : ${fmt(baselineOut)} SOL${X}`);

  const improvement = victimSolOut > baselineOut ? victimSolOut - baselineOut : 0n;
  if (improvement > 0n) {
    console.log(`  ${G}Price improvement: +${fmt(improvement)} SOL vs AMM baseline${X}`);
  }
  console.log();
  console.log(`  ${B}${G}TOTAL MEV EXTRACTED: 0 USDC  (0 bps)${X}`);
  console.log(`  ${G}Searcher CANNOT front-run: prices hidden until batch clears.${X}`);
  console.log(`  ${G}Uniform price = no intra-batch arbitrage possible.${X}`);
} else {
  console.log(`  ${Y}No crossing orders — no batch cleared.${X}`);
}

// ── Summary table ─────────────────────────────────────────────────────────────
console.log();
console.log(`${B}${C}╔═══════════════════════════════════════════════════════════════╗${X}`);
console.log(`${B}${C}║                    SUMMARY                                    ║${X}`);
console.log(`${B}${C}╠═════════════════════════╦══════════════╦═════════════════════╣${X}`);
console.log(`${B}${C}║  Metric                 ║  mockAMM     ║  Lattice            ║${X}`);
console.log(`${B}${C}╠═════════════════════════╬══════════════╬═════════════════════╣${X}`);
console.log(`${B}${C}║  Victim fill (SOL)       ║  ${R}${fmt(victimOutAfter).padEnd(10)}${C}  ║  ${G}${fmt(victimSolOut).padEnd(19)}${C}║${X}`);
console.log(`${B}${C}║  Slippage (bps)          ║  ${R}${bps(victimMEVloss, baselineOut).padEnd(10)}${C}  ║  ${G}${"0".padEnd(19)}${C}║${X}`);
console.log(`${B}${C}║  MEV extracted (USDC)    ║  ${R}${fmt(searcherProfit).padEnd(10)}${C}  ║  ${G}${"0".padEnd(19)}${C}║${X}`);
console.log(`${B}${C}║  Execution guarantee      ║  ${R}${"none".padEnd(10)}${C}  ║  ${G}${"uniform p*".padEnd(19)}${C}║${X}`);
console.log(`${B}${C}╚═════════════════════════╩══════════════╩═════════════════════╝${X}`);
console.log();
