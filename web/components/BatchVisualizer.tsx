import { useEffect, useState } from "react";

type Phase = "idle" | "commit" | "reveal" | "clear" | "done";

interface Order {
  id: string;
  label: string;
  price: number;
  isBuy: boolean;
  sealed: boolean;
  justRevealed?: boolean;
}

const DEMO_ORDERS: Order[] = [
  { id: "you",  label: "You",      price: 102, isBuy: true,  sealed: true },
  { id: "mm",   label: "MM",       price: 99,  isBuy: false, sealed: true },
  { id: "b1",   label: "Buyer 2",  price: 101, isBuy: true,  sealed: true },
  { id: "b2",   label: "Buyer 3",  price: 100, isBuy: true,  sealed: true },
  { id: "s1",   label: "Seller 2", price: 100, isBuy: false, sealed: true },
];

const CLEAR_PRICE = 100.5;

export interface RealBatchData {
  userBuyPrice:  number;
  mmSellPrice:   number;
  clearingPrice: number;
}

interface Props {
  phase: Phase;
  realBatchData?: RealBatchData | null;
}

export function BatchVisualizer({ phase, realBatchData }: Props) {
  const [orders, setOrders]       = useState<Order[]>(DEMO_ORDERS.map(o => ({ ...o, sealed: true })));
  const [sorted, setSorted]       = useState(false);
  const [clearLine, setClearLine] = useState(false);

  const liveOrders: Order[] = realBatchData
    ? [
        { id: "you",  label: "You",      price: realBatchData.userBuyPrice,         isBuy: true,  sealed: false },
        { id: "mm",   label: "MM",       price: realBatchData.mmSellPrice,          isBuy: false, sealed: false },
        { id: "b1",   label: "Buyer 2",  price: realBatchData.userBuyPrice - 1,     isBuy: true,  sealed: false },
        { id: "b2",   label: "Buyer 3",  price: realBatchData.clearingPrice,        isBuy: true,  sealed: false },
        { id: "s1",   label: "Seller 2", price: realBatchData.clearingPrice,        isBuy: false, sealed: false },
      ]
    : DEMO_ORDERS;

  const activePrice = realBatchData ? realBatchData.clearingPrice : CLEAR_PRICE;
  const basePrices  = liveOrders.map(o => o.price);
  const minP = Math.min(...basePrices) - 1;
  const maxP = Math.max(...basePrices) + 1;
  const range = maxP - minP || 1;

  useEffect(() => {
    if (phase === "idle" || phase === "commit") {
      setOrders(DEMO_ORDERS.map(o => ({ ...o, sealed: true, justRevealed: false })));
      setSorted(false);
      setClearLine(false);
    }

    if (phase === "reveal") {
      liveOrders.forEach((o, i) => {
        setTimeout(() => {
          setOrders(prev =>
            prev.map(p =>
              p.id === o.id ? { ...p, sealed: false, justRevealed: true } : p
            )
          );
          // Clear the "just revealed" flag after animation
          setTimeout(() => {
            setOrders(prev =>
              prev.map(p => p.id === o.id ? { ...p, justRevealed: false } : p)
            );
          }, 600);
        }, i * 380);
      });
      setSorted(false);
      setClearLine(false);
    }

    if (phase === "clear") {
      setTimeout(() => setSorted(true),    400);
      setTimeout(() => setClearLine(true), 950);
    }

    if (phase === "done") {
      if (realBatchData) setOrders(liveOrders);
      setSorted(true);
      setClearLine(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, realBatchData]);

  if (phase === "idle") return null;

  const displayOrders = sorted
    ? [...orders].sort((a, b) => b.price - a.price)
    : orders;

  const barPct  = (price: number) => `${Math.round(((price - minP) / range) * 100)}%`;
  const clearPct = `${Math.round(((activePrice - minP) / range) * 100)}%`;
  const isLive   = !!realBatchData && (phase === "done" || phase === "clear");

  return (
    <div className="rounded-xl border border-[#1a1a2e] bg-[#080812] px-4 py-3">

      {/* Header */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.18em] text-[#3a3a5a] font-mono">
          Batch order book
        </span>
        {phase === "commit" && (
          <span className="text-[10px] font-mono text-[#f0b42988]">
            — sealed, contents hidden
          </span>
        )}
        {phase === "reveal" && (
          <span className="text-[10px] font-mono text-[#a78bfa] animate-pulse">
            — revealing…
          </span>
        )}
        {phase === "clear" && (
          <span className="text-[10px] font-mono text-[#00ff88]">
            — finding clearing price p*
          </span>
        )}
        {phase === "done" && (
          <span className="text-[10px] font-mono text-[#00ff88]">
            — settled at {activePrice} USDC/SOL
          </span>
        )}
        {isLive && (
          <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded border border-[#00d4ff44]
                           text-[#00d4ff] bg-[#00d4ff08] uppercase tracking-wider font-mono">
            LIVE
          </span>
        )}
      </div>

      {/* Order rows */}
      <div className="space-y-1.5 relative">
        {displayOrders.map(order => (
          <div
            key={order.id}
            className="flex items-center gap-2 transition-all duration-500"
          >
            {/* Label */}
            <div className={`w-14 text-right text-[10px] font-mono shrink-0 transition-colors duration-500 ${
              order.id === "you" ? "text-[#00ff88] font-bold" : "text-[#3a3a5a]"
            }`}>
              {order.label}
            </div>

            {/* Bar */}
            <div className="flex-1 relative h-5">
              {order.sealed ? (
                /* Sealed bar — gold shimmer */
                <div className="h-full rounded overflow-hidden relative bg-[#1a1a2e]" style={{ width: "48%" }}>
                  {/* Gold shimmer sweep */}
                  <div
                    className="absolute inset-0 animate-shimmer"
                    style={{
                      background: "linear-gradient(90deg, #f0b42900 0%, #f0b42922 40%, #f0b42944 50%, #f0b42922 60%, #f0b42900 100%)",
                      backgroundSize: "200% 100%",
                    }}
                  />
                  {/* Sealed label */}
                  <div className="absolute inset-0 flex items-center pl-2">
                    <span className="text-[9px] font-mono text-[#f0b42955] tracking-[0.3em] select-none">
                      ·  ·  ·  ·  ·
                    </span>
                  </div>
                </div>
              ) : (
                /* Revealed bar */
                <div
                  className={`h-full rounded flex items-center justify-end pr-1.5 transition-all duration-700 ${
                    order.justRevealed ? "animate-[revealBar_0.5s_cubic-bezier(0.22,1,0.36,1)_both]" : ""
                  } ${
                    order.isBuy
                      ? order.id === "you"
                        ? "border border-[#00ff8844]"
                        : ""
                      : "border border-[#ff3b5c22]"
                  }`}
                  style={{
                    width: barPct(order.price),
                    backgroundColor: order.isBuy
                      ? order.id === "you" ? "#00ff8855" : "#00ff8828"
                      : "#ff3b5c28",
                  }}
                >
                  <span
                    className="text-[9px] font-mono font-bold"
                    style={{ color: order.isBuy ? "#00ff88" : "#ff3b5c" }}
                  >
                    {order.price}
                  </span>
                </div>
              )}
            </div>

            {/* Side badge */}
            <div
              className={`w-8 text-[9px] font-mono shrink-0 transition-opacity duration-300 ${
                order.sealed ? "opacity-0" : "opacity-100"
              }`}
              style={{ color: order.isBuy ? "#00ff8888" : "#ff3b5c88" }}
            >
              {order.isBuy ? "BUY" : "SELL"}
            </div>
          </div>
        ))}

        {/* Clearing price line */}
        {clearLine && (
          <div
            className="absolute top-0 bottom-0 w-px transition-all duration-700"
            style={{
              left: `calc(3.5rem + 0.5rem + ${clearPct})`,
              backgroundColor: "#f0b429",
              boxShadow: "0 0 0 1px #f0b42966, 0 0 12px #f0b42944",
            }}
          >
            <div
              className="absolute -top-5 left-2 text-[9px] font-mono whitespace-nowrap font-bold"
              style={{ color: "#f0b429" }}
            >
              p* = {activePrice}
            </div>
          </div>
        )}
      </div>

      {/* Price axis */}
      <div className="flex justify-between mt-2 pl-16 text-[9px] font-mono text-[#2a2a42]">
        <span>{minP.toFixed(0)}</span>
        <span>{(minP + range / 2).toFixed(1)}</span>
        <span>{maxP.toFixed(0)}</span>
      </div>
      <div className="pl-16 text-[9px] font-mono text-[#2a2a42] text-center -mt-0.5">
        limit price (USDC/SOL)
      </div>
    </div>
  );
}
