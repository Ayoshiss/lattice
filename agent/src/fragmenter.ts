export interface ParentOrder {
  tokenIn: string;
  tokenOut: string;
  totalAmount: number; // in base units (e.g. USDC with 6 decimals)
  limitPrice: number;  // in USDC per SOL, or price-per-unit
  horizonSeconds: number;
}

export interface Fragment {
  index: number;
  amount: number;
  limitPrice: number;
  delayMs: number;
}

/**
 * TWAP fragmentation: split parent order into `n` equal-sized children
 * spaced evenly across the time horizon.
 */
export function twapFragment(order: ParentOrder, n = 10): Fragment[] {
  const sliceAmount = Math.floor(order.totalAmount / n);
  const intervalMs = (order.horizonSeconds * 1000) / n;

  return Array.from({ length: n }, (_, i) => ({
    index: i,
    amount: i === n - 1 ? order.totalAmount - sliceAmount * (n - 1) : sliceAmount,
    limitPrice: order.limitPrice,
    delayMs: i * intervalMs,
  }));
}
