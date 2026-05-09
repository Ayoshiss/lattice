import { SimResult, toDisplay } from "@/lib/sandwich";
import { MevMeter } from "./MevMeter";
import { LogEntry, LogStream } from "./LogStream";
import { BatchVisualizer, RealBatchData } from "./BatchVisualizer";

interface SlotInfo {
  remaining: number;
  total: number;
  label: string;
}

interface Props {
  result: SimResult;
  logs: LogEntry[];
  running: boolean;
  phase: "idle" | "commit" | "reveal" | "clear" | "done";
  txSig?: string;
  slotInfo?: SlotInfo | null;
  onSubmit: () => void;
  realBatchData?: RealBatchData | null;
}

const PHASES = ["commit", "reveal", "clear", "done"] as const;

// Semantic color map: gold=sealing, violet=math/reveal, green=settled
const PHASE_META: Record<string, { label: string; color: string; barColor: string; desc: string }> = {
  idle:   { label: "Ready",     color: "#3a3a5a",  barColor: "#3a3a5a",  desc: "" },
  commit: { label: "Sealing",   color: "#f0b429",  barColor: "#f0b429",  desc: "Hash posted on-chain — contents invisible" },
  reveal: { label: "Revealing", color: "#a78bfa",  barColor: "#a78bfa",  desc: "All orders open simultaneously" },
  clear:  { label: "Settling",  color: "#00ff88",  barColor: "#00ff88",  desc: "Computing uniform clearing price" },
  done:   { label: "Settled",   color: "#00ff88",  barColor: "#00ff88",  desc: "Order filled. Zero bot interference." },
};

function LockSVG({ lit }: { lit: boolean }) {
  const c = lit ? "#f0b429" : "#2a2a42";
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <rect x="1.5" y="5.5" width="10" height="7" rx="1.5" stroke={c} strokeWidth="1.2" />
      <path d="M3.5 5.5V4A3 3 0 019.5 4v1.5" stroke={c} strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="6.5" cy="9" r="1" fill={c} />
    </svg>
  );
}

function UnlockSVG({ lit }: { lit: boolean }) {
  const c = lit ? "#a78bfa" : "#2a2a42";
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <rect x="1.5" y="5.5" width="10" height="7" rx="1.5" stroke={c} strokeWidth="1.2" />
      <path d="M3.5 5.5V4A3 3 0 019.5 4" stroke={c} strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="6.5" cy="9" r="1" fill={c} />
    </svg>
  );
}

function ScalesSVG({ lit }: { lit: boolean }) {
  const c = lit ? "#00ff88" : "#2a2a42";
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <line x1="6.5" y1="1" x2="6.5" y2="12" stroke={c} strokeWidth="1.2" strokeLinecap="round" />
      <line x1="2.5" y1="3.5" x2="10.5" y2="3.5" stroke={c} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M1.5 3.5L0.5 6.5h3l-1-3" stroke={c} strokeWidth="1" strokeLinejoin="round" />
      <path d="M8.5 3.5l-1 3h3l-1-3" stroke={c} strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

function CheckSVG() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="#00ff88" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const stepDefs = [
  {
    n: "01",
    getIcon: (active: boolean) => <LockSVG lit={active} />,
    label: "Your order is sealed",
    detail: "A cryptographic hash is posted on-chain. No one — not even validators — knows your price.",
    color: "#f0b429",
    match: (p: string) => p === "commit",
  },
  {
    n: "02",
    getIcon: (active: boolean) => <UnlockSVG lit={active} />,
    label: "All orders reveal at once",
    detail: "After the window closes, everyone reveals simultaneously. No first-mover advantage.",
    color: "#a78bfa",
    match: (p: string) => p === "reveal",
  },
  {
    n: "03",
    getIcon: (active: boolean) => <ScalesSVG lit={active} />,
    label: "One fair price clears the batch",
    detail: "A single uniform price where supply meets demand. Every participant gets the same deal.",
    color: "#00ff88",
    match: (p: string) => p === "clear" || p === "done",
  },
];

export function LatticePanel({ result, logs, running, phase, txSig, slotInfo, onSubmit, realBatchData }: Props) {
  const done    = phase === "done";
  const phaseIdx = PHASES.indexOf(phase as typeof PHASES[number]);
  const meta    = PHASE_META[phase];

  return (
    <div className="flex flex-col rounded-2xl overflow-hidden border border-[#00ff8833] bg-[#0c0c1a]
                    shadow-[0_0_0_1px_#00ff8822,0_0_40px_#00ff880a]">

      {/* Header */}
      <div className="relative px-5 py-4 border-b border-[#00ff8822] bg-gradient-to-r from-[#00ff880a] to-transparent">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-2.5 h-2.5 rounded-full bg-[#00ff88] shadow-[0_0_8px_#00ff88]" />
            <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-[#00ff88] animate-ping opacity-40" />
          </div>
          <div>
            <div className="font-mono text-sm font-bold text-[#00ff88] tracking-[0.08em]">Lattice DEX</div>
            <div className="text-[10px] font-mono text-[#3a3a5a] mt-0.5">Sealed-bid batch auction — bots see nothing</div>
          </div>
          <span className="ml-auto text-[9px] font-mono px-2 py-1 rounded border border-[#00ff8833]
                           text-[#00ff88] bg-[#00ff8810] uppercase tracking-wider shrink-0">
            PROTECTED
          </span>
        </div>
      </div>

      {/* Phase stepper */}
      {phase !== "idle" && (
        <div className="px-5 py-4 border-b border-[#1a1a2e]">

          {/* Node track */}
          <div className="flex items-center mb-2">
            {PHASES.map((p, i) => {
              const isActive = phase === p;
              const isPast   = phaseIdx > i;
              const pMeta    = PHASE_META[p];
              return (
                <div key={p} className="flex items-center flex-1 last:flex-none">
                  {/* Node */}
                  <div
                    className="relative flex items-center justify-center w-6 h-6 rounded-full border-2 transition-all duration-500 shrink-0"
                    style={{
                      borderColor: isPast ? "#00ff88" : isActive ? pMeta.color : "#1a1a2e",
                      backgroundColor: isPast ? "#00ff8820" : isActive ? pMeta.color + "20" : "transparent",
                    }}
                  >
                    {isPast ? (
                      <CheckSVG />
                    ) : (
                      <div
                        className="w-1.5 h-1.5 rounded-full transition-all duration-300"
                        style={{ backgroundColor: isActive ? pMeta.color : "#2a2a42" }}
                      />
                    )}
                    {isActive && (
                      <div
                        className="absolute inset-0 rounded-full animate-ping opacity-30"
                        style={{ backgroundColor: pMeta.color }}
                      />
                    )}
                  </div>

                  {/* Connector */}
                  {i < PHASES.length - 1 && (
                    <div
                      className="flex-1 h-px transition-all duration-700"
                      style={{ backgroundColor: isPast ? "#00ff8866" : "#1a1a2e" }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Phase labels */}
          <div className="flex">
            {PHASES.map((p, i) => {
              const isActive = phase === p;
              const isPast   = phaseIdx > i;
              const pMeta    = PHASE_META[p];
              return (
                <div key={p} className="flex-1 text-center">
                  <div
                    className="text-[9px] font-mono font-bold uppercase tracking-wider transition-colors duration-300"
                    style={{ color: isPast ? "#00ff8866" : isActive ? pMeta.color : "#2a2a42" }}
                  >
                    {pMeta.label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active description */}
          {meta.desc && (
            <div className="mt-3 flex items-center gap-2">
              <div
                className="w-1 h-1 rounded-full animate-pulse shrink-0"
                style={{ backgroundColor: meta.color }}
              />
              <span
                className="text-[11px] font-mono"
                style={{ color: meta.color }}
              >
                {meta.desc}
              </span>
            </div>
          )}

          {/* Slot countdown */}
          {slotInfo && (
            <div className="mt-3">
              <div className="flex justify-between mb-1.5">
                <span className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-[0.15em]">
                  {slotInfo.label}
                </span>
                <span className="text-[10px] font-mono" style={{ color: meta.color }}>
                  {slotInfo.remaining}/{slotInfo.total} slots
                  <span className="text-[#3a3a5a] ml-1">
                    ≈ {Math.ceil(slotInfo.remaining * 0.4)}s
                  </span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-[#1a1a2e] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 relative overflow-hidden"
                  style={{
                    width: `${((slotInfo.total - slotInfo.remaining) / slotInfo.total) * 100}%`,
                    backgroundColor: meta.color,
                  }}
                >
                  {/* Shimmer sweep */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-shimmer" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* How it works */}
      <div className="px-5 py-4 space-y-2 border-b border-[#1a1a2e] flex-1">
        <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-[0.18em] mb-4">How Lattice protects you</div>

        {stepDefs.map((step, i) => {
          const isActive = step.match(phase);
          return (
            <div
              key={i}
              className="relative flex gap-3 items-start rounded-xl px-4 py-3 border transition-all duration-500"
              style={isActive ? {
                borderColor: step.color + "55",
                backgroundColor: step.color + "0d",
                boxShadow: `0 0 20px ${step.color}12`,
              } : {
                borderColor: "#1a1a2e",
                backgroundColor: "rgba(255,255,255,0.008)",
              }}
            >
              <span className="shrink-0 mt-0.5">{step.getIcon(isActive)}</span>
              <div className="flex-1 min-w-0">
                <div
                  className="text-[12px] font-mono font-semibold transition-colors duration-300"
                  style={{ color: isActive ? step.color : "#6b6b8a" }}
                >
                  {step.label}
                </div>
                <div className="text-[11px] font-mono text-[#3a3a5a] mt-0.5 leading-[1.55]">
                  {step.detail}
                </div>
              </div>
              {isActive && (
                <div
                  className="shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wider"
                  style={{
                    borderColor: step.color + "44",
                    color: step.color,
                    backgroundColor: step.color + "10",
                  }}
                >
                  LIVE
                </div>
              )}
            </div>
          );
        })}

        {/* Batch book */}
        <BatchVisualizer phase={phase} realBatchData={realBatchData} />

        {/* Result card */}
        <div className={`mt-4 rounded-xl border px-4 py-4 transition-all duration-700 ${
          done ? "border-[#00ff8844] bg-[#00ff880a]" : "border-[#1a1a2e] bg-[#ffffff02]"
        }`}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className={`text-[10px] font-mono uppercase tracking-wider mb-1 ${
                done ? "text-[#00ff8866]" : "text-[#3a3a5a]"
              }`}>You receive</div>
              <div className={`text-2xl font-mono font-black transition-colors duration-500 ${
                done ? "text-[#00ff88] count-up" :
                phase !== "idle" ? "text-[#3a3a5a]" : "text-[#2a2a42]"
              }`}>
                {done ? toDisplay(result.latticeVictimSol) : "—"} SOL
              </div>
              <div className="text-[10px] font-mono text-[#3a3a5a] mt-1">
                {done
                  ? `+${toDisplay(result.latticeImprovementSol)} SOL more than AMM`
                  : phase !== "idle" ? "pending settlement…" : "run to see outcome"}
              </div>
            </div>
            <div className="text-right">
              <div className={`text-[10px] font-mono uppercase tracking-wider mb-1 ${
                done ? "text-[#00ff8866]" : "text-[#3a3a5a]"
              }`}>Bot profit</div>
              <div className={`text-2xl font-mono font-black transition-colors duration-500 ${
                done ? "text-[#00ff88]" : "text-[#2a2a42]"
              }`}>
                $0
              </div>
              <div className="text-[10px] font-mono text-[#3a3a5a] mt-1">
                {done ? "mathematically impossible" : "—"}
              </div>
            </div>
          </div>
        </div>

        <MevMeter bps={0} label="Bot value extracted from your trade" color="green" />

        {txSig && (
          <a
            href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] font-mono text-[#00d4ff] hover:text-[#00d4ffcc] transition-colors"
          >
            <span className="shrink-0">↗</span>
            <span className="truncate">
              Verified on Solana devnet: {txSig.slice(0, 20)}…
            </span>
          </a>
        )}
      </div>

      {/* Log */}
      <div className="px-5 py-3 border-b border-[#1a1a2e]">
        <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-[0.18em] mb-2">Live order log</div>
        <LogStream entries={logs} />
      </div>

      {/* CTA */}
      <div className="px-5 py-4">
        <button
          onClick={onSubmit}
          disabled={running}
          className="btn-shimmer relative w-full py-3.5 rounded-xl border border-[#00ff8844] bg-[#00ff880c]
                     text-[#00ff88] text-sm font-mono font-bold tracking-wider overflow-hidden
                     hover:border-[#00ff8888] hover:bg-[#00ff8818] hover:shadow-green
                     transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running
            ? `${PHASE_META[phase]?.label ?? "Running"}…`
            : done
            ? "↺  Run Again"
            : "▶  Submit Protected Order"}
        </button>
        {done && (
          <p className="text-center text-[11px] font-mono text-[#3a3a5a] mt-2">
            Protected from MEV. Zero bot extraction.
          </p>
        )}
      </div>
    </div>
  );
}
