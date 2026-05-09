export interface OrderRecord {
  id: string;
  timestamp: number;
  type: "lattice" | "agent";
  amountUsdc: number;
  tokenOut: string;
  mevSavedUsdc: number;
  txSig: string;
  explorerUrl: string;
  slices?: number;
}

const KEY = "lattice_order_history";

export function saveOrder(r: OrderRecord): void {
  if (typeof window === "undefined") return;
  const existing = getOrders();
  const updated = [r, ...existing].slice(0, 30);
  try { localStorage.setItem(KEY, JSON.stringify(updated)); } catch { /* storage full */ }
}

export function getOrders(): OrderRecord[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}

export function clearOrders(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
