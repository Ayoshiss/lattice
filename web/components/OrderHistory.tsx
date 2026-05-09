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
    <div className="rounded-xl border border-[#1e1e32] bg-[#0f0f1a] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1e32]">
        <div className="flex items-center gap-3">
          <span className="text-lg">📋</span>
          <div>
            <div className="font-mono text-sm font-bold text-[#e0e0f0] tracking-wide">
              Order History
            </div>
            <div className="text-[10px] font-mono text-[#4a4a6a] mt-0.5">
              {orders.length} order{orders.length !== 1 ? "s" : ""} this session · all confirmed on Solana devnet
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Summary stats */}
          <div className="hidden sm:flex items-center gap-4">
            <div className="text-center">
              <div className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-widest">Volume</div>
              <div className="text-sm font-mono font-bold text-[#e0e0f0]">${totalVolume.toLocaleString()}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-widest">MEV saved</div>
              <div className="text-sm font-mono font-bold text-[#00ff88]">${totalMevSaved.toFixed(2)}</div>
            </div>
          </div>
          <button
            onClick={() => { clearOrders(); setOrders([]); }}
            className="text-[10px] font-mono text-[#2a2a4a] hover:text-[#ff3b5c] transition-colors"
          >
            clear
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="border-b border-[#1e1e32]">
              <th className="text-left px-5 py-2 text-[#2a2a4a] uppercase tracking-wider font-normal">Time</th>
              <th className="text-left px-3 py-2 text-[#2a2a4a] uppercase tracking-wider font-normal">Type</th>
              <th className="text-left px-3 py-2 text-[#2a2a4a] uppercase tracking-wider font-normal">Amount</th>
              <th className="text-left px-3 py-2 text-[#2a2a4a] uppercase tracking-wider font-normal hidden sm:table-cell">Token</th>
              <th className="text-left px-3 py-2 text-[#2a2a4a] uppercase tracking-wider font-normal hidden sm:table-cell">Slices</th>
              <th className="text-right px-3 py-2 text-[#2a2a4a] uppercase tracking-wider font-normal">MEV saved</th>
              <th className="text-right px-5 py-2 text-[#2a2a4a] uppercase tracking-wider font-normal">Tx</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, idx) => (
              <tr
                key={o.id}
                className={`border-b border-[#0a0a14] transition-colors duration-700 ${
                  flash === o.id
                    ? "bg-[#00ff8808]"
                    : idx % 2 === 0
                    ? "bg-[#ffffff02]"
                    : ""
                }`}
              >
                <td className="px-5 py-2.5 text-[#4a4a6a] whitespace-nowrap">
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
                <td className="px-3 py-2.5 text-[#e0e0f0] font-semibold">
                  ${o.amountUsdc.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-[#4a4a6a] hidden sm:table-cell">
                  {o.tokenOut}
                </td>
                <td className="px-3 py-2.5 text-[#4a4a6a] hidden sm:table-cell">
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
                    <span className="text-[#2a2a4a]">—</span>
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
