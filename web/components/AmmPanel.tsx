import { SimResult, toDisplay, DEFAULT_PARAMS } from "@/lib/sandwich";
import { MevMeter } from "./MevMeter";
import { LogEntry, LogStream } from "./LogStream";

interface Props {
  result: SimResult;
  logs: LogEntry[];
  running: boolean;
  onRun: () => void;
}

export function AmmPanel({ result, logs, running, onRun }: Props) {
  const done = logs.length > 0 && !running;

  return (
    <div className="flex flex-col rounded-xl border border-[#ff3b5c44] bg-[#0f0f1a] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#1e1e32] bg-[#ff3b5c08]">
        <div className="w-2 h-2 rounded-full bg-[#ff3b5c] shadow-[0_0_8px_#ff3b5c]" />
        <div>
          <div className="font-mono text-sm font-bold text-[#ff3b5c] tracking-wide">
            Regular DEX
          </div>
          <div className="text-[10px] font-mono text-[#4a4a6a] mt-0.5">
            Orders are public — bots can see and front-run your trade
          </div>
        </div>
        <span className="ml-auto text-[10px] font-mono px-2 py-1 rounded bg-[#ff3b5c18] text-[#ff3b5c] border border-[#ff3b5c33]">
          VULNERABLE
        </span>
      </div>

      {/* Trade summary */}
      <div className="px-5 pt-4 pb-3 border-b border-[#1e1e32]">
        <div className="text-[10px] uppercase tracking-widest text-[#4a4a6a] font-mono mb-3">
          Your trade
        </div>
        <div className="flex items-center gap-3 text-sm font-mono">
          <span className="text-[#e0e0f0] font-bold text-base">10,000 USDC</span>
          <span className="text-[#2a2a4a]">→</span>
          <span className="text-[#e0e0f0] font-bold text-base">SOL</span>
          <span className="ml-auto text-[10px] text-[#4a4a6a]">fair price ≈ 100 USDC/SOL</span>
        </div>
      </div>

      {/* What happened */}
      <div className="px-5 py-4 space-y-2 border-b border-[#1e1e32] flex-1">
        <div className="text-[10px] uppercase tracking-widest text-[#4a4a6a] font-mono mb-3">
          What happens on a regular DEX
        </div>

        {[
          {
            n: "1",
            icon: "📡",
            label: "Your order goes public",
            detail: "Anyone watching the mempool can see exactly what you're about to buy",
            color: "#4a4a6a",
          },
          {
            n: "2",
            icon: "🤖",
            label: "Bot jumps in front of you",
            detail: "It buys 5,000 USDC of SOL first — the price moves against you instantly",
            color: "#ff3b5c",
          },
          {
            n: "3",
            icon: "📉",
            label: "You buy at a worse price",
            detail: "The pool is already skewed. You get fewer SOL than you should.",
            color: "#ff3b5c",
          },
          {
            n: "4",
            icon: "💸",
            label: "Bot sells back and pockets the difference",
            detail: "It exits right after you, locking in profit. Every single trade.",
            color: "#ff3b5c",
          },
        ].map((step) => (
          <div
            key={step.n}
            className="flex gap-3 items-start rounded-lg px-3 py-2.5 bg-[#ffffff04] border border-[#1e1e32]"
          >
            <span className="text-base shrink-0 mt-0.5">{step.icon}</span>
            <div>
              <div className="text-xs font-mono font-semibold" style={{ color: step.color }}>
                {step.label}
              </div>
              <div className="text-[11px] font-mono text-[#4a4a6a] mt-0.5 leading-4">
                {step.detail}
              </div>
            </div>
          </div>
        ))}

        {/* Result */}
        <div className="mt-3 rounded-lg border border-[#ff3b5c44] bg-[#ff3b5c0a] px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-widest">
                You received
              </div>
              <div className="text-2xl font-mono font-bold text-[#ff3b5c] mt-1">
                {toDisplay(result.victimOutAfter)} SOL
              </div>
              <div className="text-[11px] font-mono text-[#4a4a6a] mt-0.5">
                Without bot attack: {toDisplay(result.baselineOut)} SOL
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-widest">
                Bot profit
              </div>
              <div className="text-2xl font-mono font-bold text-[#ff3b5c] mt-1">
                +{toDisplay(result.searcherProfit)} USDC
              </div>
              <div className="text-[11px] font-mono text-[#4a4a6a] mt-0.5">
                Stolen from your trade
              </div>
            </div>
          </div>
        </div>

        <MevMeter
          bps={result.mevExtractedBps}
          label="How much of your trade value was stolen"
          color="red"
        />
      </div>

      {/* Log stream */}
      <div className="px-5 py-3 border-t border-[#1e1e32]">
        <div className="text-[10px] uppercase tracking-widest text-[#4a4a6a] font-mono mb-2">
          Simulation log
        </div>
        <LogStream entries={logs} />
      </div>

      {/* CTA */}
      <div className="px-5 pb-5 pt-3">
        <button
          onClick={onRun}
          disabled={running}
          className="w-full py-3 rounded-lg border border-[#ff3b5c55] bg-[#ff3b5c11]
                     text-[#ff3b5c] text-sm font-mono font-semibold tracking-wider
                     hover:bg-[#ff3b5c22] hover:border-[#ff3b5c88] transition-all
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? "Simulating bot attack…" : done ? "↺  Run Again" : "▶  Simulate Bot Attack"}
        </button>
        {done && (
          <p className="text-center text-[11px] font-mono text-[#4a4a6a] mt-2">
            Now run the Lattice order → to see the difference
          </p>
        )}
      </div>
    </div>
  );
}
