import { useState } from "react";

const MEV_BPS = 98; // from our simulation — typical sandwich attack extraction

export function MevCalculator() {
  const [monthly, setMonthly] = useState(10000);

  const yearlyVolume  = monthly * 12;
  const yearlySavings = (yearlyVolume * MEV_BPS) / 10_000;
  const monthlySavings = yearlySavings / 12;

  const fmt = (n: number) =>
    n >= 1000
      ? `$${(n / 1000).toFixed(1)}k`
      : `$${n.toFixed(0)}`;

  return (
    <div className="rounded-xl border border-[#00d4ff33] bg-[#0f0f1a] overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#1e1e32] bg-[#00d4ff06]">
        <span className="text-lg">💰</span>
        <div>
          <div className="font-mono text-sm font-bold text-[#00d4ff] tracking-wide">
            How much are bots taking from you?
          </div>
          <div className="text-[10px] font-mono text-[#4a4a6a] mt-0.5">
            Based on 98 bps average MEV extraction — the exact rate from this demo
          </div>
        </div>
      </div>

      <div className="px-5 py-5">
        <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
          {/* Input */}
          <div className="flex-1 w-full">
            <label className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-widest block mb-2">
              Monthly trading volume (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4a6a] font-mono text-sm">$</span>
              <input
                type="number"
                min={100}
                step={1000}
                value={monthly}
                onChange={e => setMonthly(Math.max(0, Number(e.target.value)))}
                className="w-full bg-[#0a0a14] border border-[#1e1e32] rounded-lg pl-7 pr-4 py-3
                           text-[15px] font-mono font-bold text-[#e0e0f0]
                           focus:outline-none focus:border-[#00d4ff55]"
              />
            </div>
            {/* Quick picks */}
            <div className="flex gap-2 mt-2">
              {[1000, 10000, 50000, 100000].map(v => (
                <button
                  key={v}
                  onClick={() => setMonthly(v)}
                  className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                    monthly === v
                      ? "border-[#00d4ff55] text-[#00d4ff] bg-[#00d4ff11]"
                      : "border-[#1e1e32] text-[#4a4a6a] hover:border-[#2a2a4a]"
                  }`}
                >
                  {fmt(v)}
                </button>
              ))}
            </div>
          </div>

          {/* Arrow */}
          <div className="hidden sm:block text-[#2a2a4a] font-mono text-xl">→</div>

          {/* Output */}
          <div className="flex-1 w-full grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[#ff3b5c33] bg-[#ff3b5c08] px-4 py-3">
              <div className="text-[10px] font-mono text-[#ff3b5c88] uppercase tracking-widest mb-1">
                Bots steal / month
              </div>
              <div className="text-2xl font-mono font-bold text-[#ff3b5c]">
                {fmt(monthlySavings)}
              </div>
              <div className="text-[10px] font-mono text-[#4a4a6a] mt-0.5">
                {MEV_BPS} bps per trade
              </div>
            </div>
            <div className="rounded-lg border border-[#00ff8833] bg-[#00ff8808] px-4 py-3">
              <div className="text-[10px] font-mono text-[#00ff8888] uppercase tracking-widest mb-1">
                You save / year on Lattice
              </div>
              <div className="text-2xl font-mono font-bold text-[#00ff88]">
                {fmt(yearlySavings)}
              </div>
              <div className="text-[10px] font-mono text-[#4a4a6a] mt-0.5">
                {fmt(yearlyVolume)} annual volume
              </div>
            </div>
          </div>
        </div>

        {/* Bar comparison */}
        <div className="mt-5 space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-[#4a4a6a] w-24 shrink-0">Regular DEX</span>
            <div className="flex-1 h-2 rounded-full bg-[#ff3b5c22] overflow-hidden">
              <div className="h-full rounded-full bg-[#ff3b5c]" style={{ width: "100%" }} />
            </div>
            <span className="text-[10px] font-mono text-[#ff3b5c] w-16 text-right shrink-0">
              {fmt(monthly)}/mo
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-[#4a4a6a] w-24 shrink-0">What you keep</span>
            <div className="flex-1 h-2 rounded-full bg-[#00ff8822] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#00ff88] transition-all duration-500"
                style={{ width: `${((monthly - monthlySavings) / monthly) * 100}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-[#00ff88] w-16 text-right shrink-0">
              {fmt(monthly - monthlySavings)}/mo
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
