import { SimResult, toDisplay, DEFAULT_PARAMS } from "@/lib/sandwich";
import { MevMeter } from "./MevMeter";
import { LogEntry, LogStream } from "./LogStream";

interface Props {
  result: SimResult;
  logs: LogEntry[];
  running: boolean;
  onRun: () => void;
}

const steps = [
  {
    n: "01",
    title: "Your order broadcast",
    detail: "Anyone watching the mempool can see exactly what you're buying.",
    attack: false,
  },
  {
    n: "02",
    title: "Bot detects and front-runs",
    detail: "It buys SOL before your tx confirms — price moves instantly against you.",
    attack: true,
    highlight: true,
  },
  {
    n: "03",
    title: "You fill at a worse price",
    detail: "The pool is skewed. You receive fewer tokens than you should have.",
    attack: true,
  },
  {
    n: "04",
    title: "Bot exits, pockets the spread",
    detail: "It sells back immediately after you — zero risk, guaranteed profit.",
    attack: true,
  },
];

export function AmmPanel({ result, logs, running, onRun }: Props) {
  const done = logs.length > 0 && !running;

  return (
    <div className="flex flex-col rounded-2xl overflow-hidden border border-[#ff3b5c33] bg-[#0c0c1a]
                    shadow-[0_0_0_1px_#ff3b5c22,0_0_40px_#ff3b5c0a]">

      {/* Header */}
      <div className="relative px-5 py-4 border-b border-[#ff3b5c22] bg-gradient-to-r from-[#ff3b5c0a] to-transparent">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff3b5c]" />
            <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-[#ff3b5c] animate-ping opacity-60" />
          </div>
          <div>
            <div className="font-mono text-sm font-bold text-[#ff3b5c] tracking-[0.08em]">Regular DEX</div>
            <div className="text-[10px] font-mono text-[#3a3a5a] mt-0.5">Orders are public — bots can see everything</div>
          </div>
          <span className="ml-auto text-[9px] font-mono px-2 py-1 rounded border border-[#ff3b5c33]
                           text-[#ff3b5c] bg-[#ff3b5c10] uppercase tracking-wider shrink-0">
            VULNERABLE
          </span>
        </div>
      </div>

      {/* Trade */}
      <div className="px-5 py-4 border-b border-[#1a1a2e]">
        <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-[0.18em] mb-3">Your trade</div>
        <div className="flex items-center gap-3 font-mono">
          <span className="text-[#f1f0f7] font-bold text-lg">10,000 USDC</span>
          <span className="text-[#2a2a42]">→</span>
          <span className="text-[#f1f0f7] font-bold text-lg">SOL</span>
          <span className="ml-auto text-[10px] text-[#3a3a5a]">fair ≈ 100 USDC/SOL</span>
        </div>
      </div>

      {/* Attack steps */}
      <div className="px-5 py-4 space-y-2 border-b border-[#1a1a2e] flex-1">
        <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-[0.18em] mb-4">What happens</div>

        {steps.map((s) => (
          <div key={s.n} className={`relative flex gap-3 items-start rounded-xl px-4 py-3 border transition-all ${
            s.highlight
              ? "border-[#ff3b5c55] bg-[#ff3b5c12] shadow-[0_0_20px_#ff3b5c18]"
              : s.attack
              ? "border-[#ff3b5c22] bg-[#ff3b5c06]"
              : "border-[#1a1a2e] bg-[#ffffff02]"
          }`}>
            {/* Step number */}
            <span className={`text-[9px] font-mono font-bold shrink-0 mt-0.5 ${
              s.highlight ? "text-[#ff3b5c]" : s.attack ? "text-[#ff3b5c66]" : "text-[#2a2a42]"
            }`}>{s.n}</span>

            <div className="flex-1 min-w-0">
              <div className={`text-[12px] font-mono font-semibold ${
                s.highlight ? "text-[#ff3b5c]" : s.attack ? "text-[#ff3b5c99]" : "text-[#6b6b8a]"
              }`}>{s.title}</div>
              <div className="text-[11px] font-mono text-[#3a3a5a] mt-0.5 leading-[1.55]">{s.detail}</div>
            </div>

            {s.highlight && (
              <div className="shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded
                              border border-[#ff3b5c44] text-[#ff3b5c] bg-[#ff3b5c10] uppercase tracking-wider">
                EXPLOIT
              </div>
            )}
          </div>
        ))}

        {/* Result card */}
        <div className="mt-4 rounded-xl border border-[#ff3b5c44] bg-[#ff3b5c0a] px-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] font-mono text-[#ff3b5c55] uppercase tracking-wider mb-1">You received</div>
              <div className={`text-2xl font-mono font-black text-[#ff3b5c] ${done ? "count-up" : ""}`}>
                {toDisplay(result.victimOutAfter)} SOL
              </div>
              <div className="text-[10px] font-mono text-[#3a3a5a] mt-1">
                fair: {toDisplay(result.baselineOut)} SOL
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-mono text-[#ff3b5c55] uppercase tracking-wider mb-1">Bot profit</div>
              <div className={`text-2xl font-mono font-black text-[#ff3b5c] ${done ? "count-up" : ""}`}>
                +{toDisplay(result.searcherProfit)} USDC
              </div>
              <div className="text-[10px] font-mono text-[#3a3a5a] mt-1">stolen from your trade</div>
            </div>
          </div>
        </div>

        <MevMeter bps={result.mevExtractedBps} label="Trade value extracted by bots" color="red" />
      </div>

      {/* Log */}
      <div className="px-5 py-3 border-b border-[#1a1a2e]">
        <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-[0.18em] mb-2">Simulation log</div>
        <LogStream entries={logs} />
      </div>

      {/* CTA */}
      <div className="px-5 py-4">
        <button
          onClick={onRun}
          disabled={running}
          className="w-full py-3.5 rounded-xl border border-[#ff3b5c44] bg-[#ff3b5c0c]
                     text-[#ff3b5c] text-sm font-mono font-bold tracking-wider
                     hover:border-[#ff3b5c88] hover:bg-[#ff3b5c18] hover:shadow-red
                     transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? "Simulating attack…" : done ? "↺  Run Again" : "▶  Simulate Bot Attack"}
        </button>
        {done && (
          <p className="text-center text-[11px] font-mono text-[#3a3a5a] mt-2">
            Now run the Lattice order →
          </p>
        )}
      </div>
    </div>
  );
}
