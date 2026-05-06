interface Props {
  bps: number;
  maxBps?: number;
  color?: "red" | "green";
  label?: string;
}

export function MevMeter({ bps, maxBps = 200, color = "red", label }: Props) {
  const pct = Math.min((bps / maxBps) * 100, 100);
  const barColor = color === "red" ? "#ff3b5c" : "#00ff88";
  const glowColor = color === "red" ? "#ff3b5c44" : "#00ff8844";

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <span className="text-[10px] uppercase tracking-widest text-[#4a4a6a] font-mono">
          {label}
        </span>
      )}
      <div className="relative h-2 rounded-full bg-[#1e1e32] overflow-hidden">
        {bps === 0 ? (
          /* zero state: show a locked stripe pattern */
          <div
            className="absolute inset-0 rounded-full opacity-20"
            style={{ background: `repeating-linear-gradient(90deg, ${barColor} 0px, ${barColor} 4px, transparent 4px, transparent 8px)` }}
          />
        ) : (
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: barColor, boxShadow: `0 0 8px ${glowColor}` }}
          />
        )}
      </div>
      <div className="flex justify-between">
        <span className="text-xs font-mono font-bold" style={{ color: barColor }}>
          {bps} bps
        </span>
        <span className="text-[10px] text-[#4a4a6a] font-mono">
          {bps === 0 && color === "green" ? "🔒 locked at zero" : `max ${maxBps} bps`}
        </span>
      </div>
    </div>
  );
}
