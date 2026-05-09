import { useEffect, useState } from "react";

type Phase = "idle" | "commit" | "reveal" | "clear" | "done";

interface Order {
  id: string;
  label: string;
  price: number;    // limit price in USDC
  isBuy: boolean;
  sealed: boolean;  // true = grey, false = colored
}

// Synthetic order book: our real order + market-maker + 3 simulated others
const DEMO_ORDERS: Order[] = [
  { id: "you",  label: "You",      price: 102, isBuy: true,  sealed: true },
  { id: "mm",   label: "MM",       price: 99,  isBuy: false, sealed: true },
  { id: "b1",   label: "Buyer 2",  price: 101, isBuy: true,  sealed: true },
  { id: "b2",   label: "Buyer 3",  price: 100, isBuy: true,  sealed: true },
  { id: "s1",   label: "Seller 2", price: 100, isBuy: false, sealed: true },
];

const CLEAR_PRICE = 100.5; // midpoint between best bid/ask

export interface RealBatchData {
  userBuyPrice:  number;
  mmSellPrice:   number;
  clearingPrice: number;
}

interface Props {
  phase: Phase;
  /** When provided (after on-chain clearBatch), the visualizer uses live prices. */
  realBatchData?: RealBatchData | null;
}

export function BatchVisualizer({ phase, realBatchData }: Props) {
  const [orders, setOrders]       = useState<Order[]>(DEMO_ORDERS.map(o => ({ ...o, sealed: true })));
  const [sorted, setSorted]       = useState(false);
  const [clearLine, setClearLine] = useState(false);

  // Build the live order set when we have real data
  const liveOrders: Order[] = realBatchData
    ? [
        { id: "you",  label: "You",      price: realBatchData.userBuyPrice, isBuy: true,  sealed: false },
        { id: "mm",   label: "MM",       price: realBatchData.mmSellPrice,  isBuy: false, sealed: false },
        { id: "b1",   label: "Buyer 2",  price: realBatchData.userBuyPrice - 1, isBuy: true,  sealed: false },
        { id: "b2",   label: "Buyer 3",  price: realBatchData.clearingPrice,     isBuy: true,  sealed: false },
        { id: "s1",   label: "Seller 2", price: realBatchData.clearingPrice,     isBuy: false, sealed: false },
      ]
    : DEMO_ORDERS;

  // Determine current clearing price and axis bounds
  const activePrice = realBatchData ? realBatchData.clearingPrice : CLEAR_PRICE;
  const basePrices  = liveOrders.map(o => o.price);
  const minP = Math.min(...basePrices) - 1;
  const maxP = Math.max(...basePrices) + 1;
  const range = maxP - minP || 1;

  // When phase transitions, update visual state
  useEffect(() => {
    if (phase === "idle") {
      // Always reset to sealed DEMO_ORDERS — prevents stale realBatchData flicker on re-run
      setOrders(DEMO_ORDERS.map(o => ({ ...o, sealed: true })));
      setSorted(false);
      setClearLine(false);
    }

    if (phase === "commit") {
      // Same: always start from sealed demo orders; real data isn't available yet
      setOrders(DEMO_ORDERS.map(o => ({ ...o, sealed: true })));
      setSorted(false);
      setClearLine(false);
    }

    if (phase === "reveal") {
      // Reveal one by one with stagger using the current liveOrders snapshot
      liveOrders.forEach((o, i) => {
        setTimeout(() => {
          setOrders(prev => prev.map(p => p.id === o.id ? { ...p, sealed: false } : p));
        }, i * 350);
      });
      setSorted(false);
      setClearLine(false);
    }

    if (phase === "clear") {
      // Sort by price + show clearing line
      setTimeout(() => setSorted(true),    400);
      setTimeout(() => setClearLine(true), 900);
    }

    if (phase === "done") {
      // If real data arrived, switch to live orders (all revealed)
      if (realBatchData) {
        setOrders(liveOrders);
      }
      setSorted(true);
      setClearLine(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, realBatchData]);

  if (phase === "idle") return null;

  // Sort orders: buys descending, sells ascending — all by price for visualisation
  const displayOrders = sorted
    ? [...orders].sort((a, b) => b.price - a.price)
    : orders;

  const barWidth = (price: number) =>
    `${Math.round(((price - minP) / range) * 100)}%`;

  const clearPct = `${Math.round(((activePrice - minP) / range) * 100)}%`;

  const isLive = !!realBatchData && (phase === "done" || phase === "clear");

  return (
    <div className="rounded-lg border border-[#1e1e32] bg-[#0a0a14] px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-[#4a4a6a] font-mono mb-3 flex items-center gap-2 flex-wrap">
        Batch order book
        {phase === "commit" && <span className="text-[#4a4a6a] normal-case">— orders sealed, contents hidden</span>}
        {phase === "reveal" && <span className="text-[#00d4ff] normal-case animate-pulse">— revealing…</span>}
        {phase === "clear"  && <span className="text-[#00ff88] normal-case">— finding clearing price p*</span>}
        {phase === "done"   && <span className="text-[#00ff88] normal-case">— settled at {activePrice} USDC/SOL</span>}
        {isLive && (
          <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded border border-[#00d4ff44] text-[#00d4ff] bg-[#00d4ff08] normal-case uppercase tracking-wider">
            live
          </span>
        )}
      </div>

      <div className="space-y-1.5 relative">
        {displayOrders.map(order => (
          <div
            key={order.id}
            className="flex items-center gap-2 transition-all duration-500"
          >
            {/* Label */}
            <div className={`w-14 text-right text-[10px] font-mono shrink-0 transition-colors duration-500 ${
              order.id === "you" ? "text-[#00ff88] font-bold" : "text-[#4a4a6a]"
            }`}>
              {order.label}
            </div>

            {/* Bar */}
            <div className="flex-1 relative h-5">
              <div
                className={`h-full rounded transition-all duration-700 flex items-center justify-end pr-1.5 ${
                  order.sealed
                    ? "bg-[#2a2a4a]"
                    : order.isBuy
                    ? order.id === "you"
                      ? "bg-[#00ff8866] border border-[#00ff8844]"
                      : "bg-[#00ff8833]"
                    : "bg-[#ff3b5c33] border border-[#ff3b5c22]"
                }`}
                style={{ width: order.sealed ? "45%" : barWidth(order.price) }}
              >
                {!order.sealed && (
                  <span className={`text-[9px] font-mono font-bold transition-opacity duration-300 ${
                    order.isBuy ? "text-[#00ff88]" : "text-[#ff3b5c]"
                  }`}>
                    {order.price}
                  </span>
                )}
              </div>

              {/* Sealed overlay */}
              {order.sealed && (
                <div className="absolute inset-0 flex items-center pl-2">
                  <span className="text-[9px] font-mono text-[#2a2a4a]">████████</span>
                </div>
              )}
            </div>

            {/* Side badge */}
            <div className={`w-8 text-[9px] font-mono shrink-0 transition-opacity duration-300 ${
              order.sealed ? "opacity-0" : "opacity-100"
            } ${order.isBuy ? "text-[#00ff8888]" : "text-[#ff3b5c88]"}`}>
              {order.isBuy ? "BUY" : "SELL"}
            </div>
          </div>
        ))}

        {/* Clearing price line */}
        {clearLine && (
          <div
            className="absolute top-0 bottom-0 w-px bg-[#00d4ff] opacity-80 transition-all duration-700"
            style={{ left: `calc(3.5rem + 0.5rem + ${clearPct})` }}
          >
            <div className="absolute -top-5 left-1 text-[9px] font-mono text-[#00d4ff] whitespace-nowrap font-bold">
              p* = {CLEAR_PRICE}
            </div>
          </div>
        )}
      </div>

      {/* Price axis */}
      <div className="flex justify-between mt-2 pl-16 text-[9px] font-mono text-[#2a2a4a]">
        <span>{minP.toFixed(0)}</span>
        <span>{(minP + range / 2).toFixed(1)}</span>
        <span>{maxP.toFixed(0)}</span>
      </div>
      <div className="pl-16 text-[9px] font-mono text-[#2a2a4a] text-center -mt-0.5">
        limit price (USDC/SOL)
      </div>
    </div>
  );
}
