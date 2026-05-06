import { useEffect, useRef, useState } from "react";

export interface LogEntry {
  ts: number;
  msg: string;
  kind: "info" | "warn" | "success" | "error" | "tx";
}

interface Props {
  entries: LogEntry[];
  maxLines?: number;
}

const kindStyle: Record<LogEntry["kind"], string> = {
  info:    "text-[#4a4a6a]",
  warn:    "text-yellow-400",
  success: "text-[#00ff88]",
  error:   "text-[#ff3b5c]",
  tx:      "text-[#00d4ff]",
};

const kindPrefix: Record<LogEntry["kind"], string> = {
  info:    "·",
  warn:    "!",
  success: "✓",
  error:   "✗",
  tx:      "→",
};

export function LogStream({ entries, maxLines = 12 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [blink, setBlink] = useState(true);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [entries]);

  useEffect(() => {
    const t = setInterval(() => setBlink((b) => !b), 530);
    return () => clearInterval(t);
  }, []);

  const visible = entries.slice(-maxLines);

  return (
    <div
      ref={ref}
      className="max-h-28 overflow-y-auto font-mono text-[11px] space-y-0.5 pr-1"
    >
      {visible.map((e, i) => (
        <div key={i} className={`flex gap-2 leading-5 ${kindStyle[e.kind]} slide-up`}>
          <span className="opacity-40 shrink-0 w-14">
            {new Date(e.ts).toLocaleTimeString("en", { hour12: false })}
          </span>
          <span className="shrink-0">{kindPrefix[e.kind]}</span>
          <span className="break-all">{e.msg}</span>
        </div>
      ))}
      {entries.length === 0 && (
        <div className="flex items-center gap-1.5 text-[#4a4a6a]">
          <span className="italic">press ▶ to run</span>
          <span style={{ opacity: blink ? 1 : 0 }} className="transition-opacity duration-100">▌</span>
        </div>
      )}
    </div>
  );
}
