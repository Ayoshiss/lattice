import { useEffect, useRef, useState } from "react";

interface Props {
  label: string;
  value: string;
  sub?: string;
  color?: "cyan" | "green" | "red" | "muted";
  flash?: boolean;
  large?: boolean;
}

const colorMap = {
  cyan:  "text-[#00d4ff]",
  green: "text-[#00ff88]",
  red:   "text-[#ff3b5c]",
  muted: "text-[#4a4a6a]",
};

export function StatCard({ label, value, sub, color = "cyan", flash, large }: Props) {
  const [cls, setCls] = useState("");
  const prev = useRef(value);

  useEffect(() => {
    if (flash && value !== prev.current) {
      const c = color === "red" ? "flash-red" : "flash-green";
      setCls(c);
      const t = setTimeout(() => setCls(""), 700);
      prev.current = value;
      return () => clearTimeout(t);
    }
  }, [value, flash, color]);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-[#4a4a6a] font-mono">
        {label}
      </span>
      <span
        className={`font-mono font-bold leading-none ${colorMap[color]} ${
          large ? "text-3xl" : "text-xl"
        } ${cls}`}
      >
        {value}
      </span>
      {sub && (
        <span className="text-[11px] text-[#4a4a6a] font-mono">{sub}</span>
      )}
    </div>
  );
}
