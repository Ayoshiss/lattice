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

const phaseInfo: Record<string, { label: string; icon: string; desc: string }> = {
  idle:   { label: "Ready",      icon: "⬜", desc: "" },
  commit: { label: "Sealing…",   icon: "🔒", desc: "Encrypting your order — nobody can see it" },
  reveal: { label: "Opening…",   icon: "🔓", desc: "Revealing after all orders are in" },
  clear:  { label: "Settling…",  icon: "⚖️",  desc: "Finding the fairest price for everyone" },
  done:   { label: "Settled ✓",  icon: "✅", desc: "Order filled. Zero bot interference." },
};

export function LatticePanel({ result, logs, running, phase, txSig, slotInfo, onSubmit, realBatchData }: Props) {
  const done = phase === "done";
  const phaseIdx = PHASES.indexOf(phase as any);

  return (
    <div className="flex flex-col rounded-xl border border-[#00ff8844] bg-[#0f0f1a] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#1e1e32] bg-[#00ff8808]">
        <div className="w-2 h-2 rounded-full bg-[#00ff88] shadow-[0_0_8px_#00ff88]" />
        <div>
          <div className="font-mono text-sm font-bold text-[#00ff88] tracking-wide">
            Lattice DEX
          </div>
          <div className="text-[10px] font-mono text-[#4a4a6a] mt-0.5">
            Orders are encrypted before submission — bots see nothing
          </div>
        </div>
        <span className="ml-auto text-[10px] font-mono px-2 py-1 rounded bg-[#00ff8818] text-[#00ff88] border border-[#00ff8833]">
          PROTECTED
        </span>
      </div>

      {/* Phase stepper (shown while running or done) */}
      {phase !== "idle" && (
        <div className="px-5 py-3 border-b border-[#1e1e32] bg-[#00ff8806]">
          <div className="flex items-center gap-1 mb-2">
            {PHASES.map((p, i) => {
              const active = phase === p;
              const past   = phaseIdx > i;
              return (
                <div key={p} className="flex items-center gap-1 flex-1">
                  <div className={`h-1 rounded-full flex-1 transition-all duration-700 ${
                    past   ? "bg-[#00ff88]" :
                    active ? "bg-[#00ff88] animate-pulse" :
                    "bg-[#1e1e32]"
                  }`} />
                  {i < PHASES.length - 1 && (
                    <div className={`w-1 h-1 rounded-full shrink-0 ${
                      past || active ? "bg-[#00ff8866]" : "bg-[#1e1e32]"
                    }`} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-base">{phaseInfo[phase].icon}</span>
            <span className="text-[11px] font-mono text-[#00ff88] font-semibold">
              {phaseInfo[phase].label}
            </span>
            <span className="text-[11px] font-mono text-[#4a4a6a]">
              — {phaseInfo[phase].desc}
            </span>
          </div>

          {/* Live slot countdown */}
          {slotInfo && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-widest">
                  {slotInfo.label}
                </span>
                <span className="text-[10px] font-mono text-[#00d4ff]">
                  {slotInfo.remaining} / {slotInfo.total} slots
                  <span className="text-[#4a4a6a] ml-1">
                    (~{Math.ceil(slotInfo.remaining * 0.4)}s)
                  </span>
                </span>
              </div>
              <div className="h-1 rounded-full bg-[#1e1e32] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#00d4ff] transition-all duration-500"
                  style={{ width: `${((slotInfo.total - slotInfo.remaining) / slotInfo.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* How it works */}
      <div className="px-5 py-4 space-y-2 border-b border-[#1e1e32] flex-1">
        <div className="text-[10px] uppercase tracking-widest text-[#4a4a6a] font-mono mb-3">
          What happens on Lattice
        </div>

        {[
          {
            icon: "🔒",
            label: "Your order is sealed before anyone sees it",
            detail: "A cryptographic hash is posted on-chain. No one — not even the relay — knows your price or amount.",
            color: "#00d4ff",
            active: phase === "commit",
          },
          {
            icon: "⏱️",
            label: "All orders reveal at the same moment",
            detail: "Once the window closes, everyone reveals simultaneously. There's no 'first mover' advantage.",
            color: "#00d4ff",
            active: phase === "reveal",
          },
          {
            icon: "⚖️",
            label: "One fair price clears the entire batch",
            detail: "The protocol finds the single price where supply meets demand. Every buyer and seller gets the same deal.",
            color: "#00ff88",
            active: phase === "clear" || phase === "done",
          },
        ].map((step, i) => (
          <div
            key={i}
            className={`flex gap-3 items-start rounded-lg px-3 py-2.5 border transition-all duration-500 ${
              step.active
                ? "bg-[#00ff8810] border-[#00ff8844]"
                : "bg-[#ffffff04] border-[#1e1e32]"
            }`}
          >
            <span className="text-base shrink-0 mt-0.5">{step.icon}</span>
            <div>
              <div
                className="text-xs font-mono font-semibold"
                style={{ color: step.color }}
              >
                {step.label}
              </div>
              <div className="text-[11px] font-mono text-[#4a4a6a] mt-0.5 leading-4">
                {step.detail}
              </div>
            </div>
          </div>
        ))}

        {/* Batch visualizer */}
        <BatchVisualizer phase={phase} realBatchData={realBatchData} />

        {/* Result */}
        <div className={`mt-3 rounded-lg border px-4 py-3 transition-all duration-700 ${
          done
            ? "border-[#00ff8844] bg-[#00ff880a]"
            : "border-[#1e1e32] bg-[#ffffff04]"
        }`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-widest">
                You receive
              </div>
              <div className={`text-2xl font-mono font-bold mt-1 transition-colors duration-500 ${
                done ? "text-[#00ff88]" : phase !== "idle" ? "text-[#4a4a6a]" : "text-[#2a2a4a]"
              }`}>
                {toDisplay(result.latticeVictimSol)} SOL
              </div>
              <div className="text-[11px] font-mono text-[#4a4a6a] mt-0.5">
                {done
                  ? `+${toDisplay(result.latticeImprovementSol)} SOL more than on a regular DEX`
                  : phase !== "idle"
                  ? "Pending settlement…"
                  : "Run the simulation to see your outcome"}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-widest">
                Bot profit
              </div>
              <div className={`text-2xl font-mono font-bold mt-1 transition-colors duration-500 ${
                done ? "text-[#00ff88]" : "text-[#2a2a4a]"
              }`}>
                $0
              </div>
              <div className="text-[11px] font-mono text-[#4a4a6a] mt-0.5">
                {done ? "Mathematically impossible" : "—"}
              </div>
            </div>
          </div>
        </div>

        <MevMeter bps={0} label="Bot value extracted from your trade" color="green" />

        {/* Devnet tx link */}
        {txSig && (
          <a
            href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] font-mono text-[#00d4ff] hover:underline"
          >
            <span>→</span>
            <span className="truncate">Verified on Solana devnet: {txSig.slice(0, 20)}…</span>
            <span className="shrink-0">↗</span>
          </a>
        )}
      </div>

      {/* Log stream */}
      <div className="px-5 py-3 border-t border-[#1e1e32]">
        <div className="text-[10px] uppercase tracking-widest text-[#4a4a6a] font-mono mb-2">
          Live order log
        </div>
        <LogStream entries={logs} />
      </div>

      {/* CTA */}
      <div className="px-5 pb-5 pt-3">
        <button
          onClick={onSubmit}
          disabled={running}
          className="w-full py-3 rounded-lg border border-[#00ff8855] bg-[#00ff8811]
                     text-[#00ff88] text-sm font-mono font-semibold tracking-wider
                     hover:bg-[#00ff8822] hover:border-[#00ff8888] transition-all
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running
            ? `${phaseInfo[phase]?.label ?? "Running…"}`
            : done
            ? "↺  Run Again"
            : "▶  Submit Protected Order"}
        </button>
      </div>
    </div>
  );
}
