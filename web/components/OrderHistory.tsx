import { useState, useEffect, useCallback } from "react";
import { getOrders, clearOrders, timeAgo, OrderRecord } from "@/lib/orderHistory";

export function OrderHistory() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [flash, setFlash]   = useState<string | null>(null); // id of newest entry

  const refresh = useCallback(() => {
    const o = getOrders();
    setOrders(o);
  }, []);

  // Poll for new orders every 2s (catches saves from other components)
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  // Flash newest entry when orders change
  useEffect(() => {
    if (orders.length > 0) {
      setFlash(orders[0].id);
      const t = setTimeout(() => setFlash(null), 1200);
      return () => clearTimeout(t);
    }
  }, [orders.length]);

  if (orders.length === 0) return null;

  const totalMevSaved  = orders.reduce((s, o) => s + o.mevSavedUsdc, 0);
  const totalVolume    = orders.reduce((s, o) => s + o.amountUsdc, 0);

  return (
    <div className="rounded-2xl border border-[#1a1a2e] bg-[#0c0c1a] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a2e]">
        <div className="flex items-center gap-3">
          {/* Ledger / order history icon */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <rect x="2" y="1" width="10" height="14" rx="1.5" stroke="#a5a5a5" strokeWidth="1.2"/>
            <line x1="5" y1="5" x2="10" y2="5" stroke="#a5a5a5" strokeWidth="1" strokeLinecap="round"/>
            <line x1="5" y1="8" x2="10" y2="8" stroke="#a5a5a5" strokeWidth="1" strokeLinecap="round"/>
            <line x1="5" y1="11" x2="8"  y2="11" stroke="#a5a5a5" strokeWidth="1" strokeLinecap="round"/>
            <rect x="10" y="9" width="4" height="6" rx="1" fill="#00ff88" opacity="0.9"/>
            <path d="M11.5 12.5l.8.8 1.2-1.5" stroke="#0c0c1a" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div>
            <div className="font-mono text-sm font-bold text-[#f1f0f7] tracking-[0.08em]">
              Order History
            </div>
            <div className="text-[10px] font-mono text-[#3a3a5a] mt-0.5">
              {orders.length} order{orders.length !== 1 ? "s" : ""} this session · all confirmed on Solana devnet
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Summary stats */}
          <div className="hidden sm:flex items-center gap-4">
            <div className="text-center">
              <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-[0.18em]">Volume</div>
              <div className="text-sm font-mono font-bold text-[#f1f0f7]">${totalVolume.toLocaleString()}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-[0.18em]">MEV saved</div>
              <div className="text-sm font-mono font-bold text-[#00ff88]">${totalMevSaved.toFixed(2)}</div>
            </div>
          </div>
          <button
            onClick={() => { clearOrders(); setOrders([]); }}
            className="text-[10px] font-mono text-[#3a3a5a] hover:text-[#ff3b5c] transition-colors"
          >
            clear
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="border-b border-[#1a1a2e]">
              <th className="text-left px-5 py-2 text-[#3a3a5a] uppercase tracking-wider font-normal">Time</th>
              <th className="text-left px-3 py-2 text-[#3a3a5a] uppercase tracking-wider font-normal">Type</th>
              <th className="text-left px-3 py-2 text-[#3a3a5a] uppercase tracking-wider font-normal">Amount</th>
              <th className="text-left px-3 py-2 text-[#3a3a5a] uppercase tracking-wider font-normal hidden sm:table-cell">Token</th>
              <th className="text-left px-3 py-2 text-[#3a3a5a] uppercase tracking-wider font-normal hidden sm:table-cell">Slices</th>
              <th className="text-right px-3 py-2 text-[#3a3a5a] uppercase tracking-wider font-normal">MEV saved</th>
              <th className="text-right px-5 py-2 text-[#3a3a5a] uppercase tracking-wider font-normal">Tx</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, idx) => (
              <tr
                key={o.id}
                className={`border-b border-[#080812] transition-colors duration-700 ${
                  flash === o.id
                    ? "bg-[#00ff8808]"
                    : idx % 2 === 0
                    ? "bg-[#ffffff02]"
                    : ""
                }`}
              >
                <td className="px-5 py-2.5 text-[#3a3a5a] whitespace-nowrap">
                  {timeAgo(o.timestamp)}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                    o.type === "agent"
                      ? "bg-[#00d4ff18] text-[#00d4ff] border border-[#00d4ff33]"
                      : "bg-[#00ff8818] text-[#00ff88] border border-[#00ff8833]"
                  }`}>
                    {o.type === "agent" ? "AI Agent" : "Lattice"}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-[#f1f0f7] font-semibold">
                  ${o.amountUsdc.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-[#3a3a5a] hidden sm:table-cell">
                  {o.tokenOut}
                </td>
                <td className="px-3 py-2.5 text-[#3a3a5a] hidden sm:table-cell">
                  {o.slices ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-right text-[#00ff88] font-semibold">
                  +${o.mevSavedUsdc.toFixed(2)}
                </td>
                <td className="px-5 py-2.5 text-right">
                  {o.txSig ? (
                    <a
                      href={o.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#00d4ff] hover:underline"
                    >
                      {o.txSig.slice(0, 8)}… ↗
                    </a>
                  ) : (
                    <span className="text-[#a5a5a5]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
