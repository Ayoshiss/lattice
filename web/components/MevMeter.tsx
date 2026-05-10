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
        <span className="text-[10px] uppercase tracking-[0.18em] text-[#3a3a5a] font-mono">
          {label}
        </span>
      )}
      <div className="relative h-2 rounded-full bg-[#1a1a2e] overflow-hidden">
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
        <span className="text-[10px] text-[#3a3a5a] font-mono">
          {bps === 0 && color === "green" ? (
            <span className="flex items-center gap-1">
              <svg width="9" height="9" viewBox="0 0 10 12" fill="none">
                <rect x="1" y="5" width="8" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M2.5 5V4a2.5 2.5 0 015 0v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              locked at zero
            </span>
          ) : `max ${maxBps} bps`}
        </span>
      </div>
    </div>
  );
}
