import { useState, useRef, useCallback, useEffect } from "react";
import { saveOrder } from "@/lib/orderHistory";
import { runSimulation, DEFAULT_PARAMS } from "@/lib/sandwich";

// MEV bps rate derived once from the sandwich simulation
const SIM_MEV_BPS = runSimulation(DEFAULT_PARAMS).mevExtractedBps;

interface Fragment {
  index: number;
  total: number;
  amount: number;
  txSig?: string;
  explorerUrl?: string;
  done: boolean;
}

interface Strategy {
  rationale: string;
  riskNote: string;
  n: number;
}

type AgentPhase = "idle" | "thinking" | "setup" | "executing" | "done" | "error";

/**
 * Parse a limit price from a natural-language trade instruction.
 * Looks for phrases like "at $150", "limit $180", "max price 200", "up to $160".
 * Falls back to 150 if nothing is found.
 */
function parseLimitPrice(text: string): number {
  const s = text.replace(/,/g, "").toLowerCase();

  // "at $150", "limit $180", "max $200", "up to $160", "price $175"
  const explicit = s.match(/(?:at|limit|max(?:imum)?|up\s+to|price)\s+\$?(\d+(?:\.\d+)?)\b/);
  if (explicit) return parseFloat(explicit[1]);

  // "limit price 150", "limit 150 usdc"
  const limitNum = s.match(/limit\s+(?:price\s+)?(\d+(?:\.\d+)?)/);
  if (limitNum) return parseFloat(limitNum[1]);

  return 150; // default
}

/**
 * Parse a dollar / USDC amount from a natural-language trade instruction.
 * Handles: $5,000 · $5k · 5000 USDC · 5k usdc · bare "5000"
 * Falls back to 1000 if nothing is found.
 */
function parseAmount(text: string): number {
  const s = text.replace(/,/g, "").toLowerCase();

  // "$5k" or "$5000"
  const dollarK = s.match(/\$(\d+(?:\.\d+)?)\s*k\b/);
  if (dollarK) return parseFloat(dollarK[1]) * 1_000;

  const dollar = s.match(/\$(\d+(?:\.\d+)?)\b/);
  if (dollar) return parseFloat(dollar[1]);

  // "5k usdc/usd" or "5000 usdc/usd"
  const usdcK = s.match(/(\d+(?:\.\d+)?)\s*k\s*(?:usdc|usd)\b/);
  if (usdcK) return parseFloat(usdcK[1]) * 1_000;

  const usdc = s.match(/(\d+(?:\.\d+)?)\s*(?:usdc|usd)\b/);
  if (usdc) return parseFloat(usdc[1]);

  // bare number ≥ 100 (avoids matching "5" in "step 5")
  const bare = s.match(/\b(\d{3,}(?:\.\d+)?)\b/);
  if (bare) return parseFloat(bare[1]);

  return 1_000; // default
}

const EXAMPLES = [
  "buy $2000 of SOL, I'm worried about market impact",
  "swap 500 USDC for wSOL quickly, I'm okay with some slippage",
  "large order: 5000 USDC into SOL over 60 seconds, minimize footprint",
];

export function AgentPanel() {
  const [phase, setPhase]           = useState<AgentPhase>("idle");
  const [orderText, setOrderText]   = useState("");
  const [reasoning, setReasoning]   = useState("");
  const [strategy, setStrategy]     = useState<Strategy | null>(null);
  const [logs, setLogs]             = useState<{ text: string; level: string }[]>([]);
  const [fragments, setFragments]   = useState<Fragment[]>([]);
  const [errorMsg, setErrorMsg]     = useState("");
  const [pool, setPool]             = useState("");
  const [market, setMarket]         = useState<{ price: number; change24h: number } | null>(null);
  const [blink, setBlink]           = useState(true);
  const logRef    = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  // Blinking cursor
  useEffect(() => {
    const t = setInterval(() => setBlink(b => !b), 530);
    return () => clearInterval(t);
  }, []);

  const addLog = useCallback((text: string, level: string) => {
    setLogs(prev => [...prev, { text, level }]);
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, 30);
  }, []);

  const run = useCallback(async () => {
    if (!orderText.trim()) return;

    setPhase("thinking");
    setReasoning("");
    setStrategy(null);
    setLogs([]);
    setFragments([]);
    setErrorMsg("");
    setPool("");
    setMarket(null);

    abortRef.current = new AbortController();

    try {
      const resp = await fetch("/api/agent/run", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderText: orderText.trim(), totalAmount: parseAmount(orderText), limitPrice: parseLimitPrice(orderText) }),
        signal:  abortRef.current.signal,
      });

      if (!resp.body) throw new Error("No response body");

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: any;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          switch (evt.type) {
            case "market":
              setMarket({ price: evt.price, change24h: evt.change24h });
              break;

            case "thinking":
              setPhase("thinking");
              break;

            case "reasoning_chunk":
              setReasoning(prev => prev + evt.text);
              break;

            case "strategy":
              setStrategy({ rationale: evt.rationale, riskNote: evt.riskNote, n: evt.n });
              setPhase("setup");
              break;

            case "log":
              addLog(evt.text, evt.level ?? "info");
              break;

            case "pool_ready":
              setPool(evt.pool);
              setPhase("executing");
              break;

            case "fragment_start":
              setFragments(prev => {
                const next = [...prev];
                next[evt.index] = { index: evt.index, total: evt.total, amount: evt.amount, done: false };
                return next;
              });
              break;

            case "fragment_done":
              setFragments(prev => {
                const next = [...prev];
                next[evt.index] = {
                  ...(next[evt.index] ?? { index: evt.index, total: evt.total, amount: 0 }),
                  txSig: evt.txSig, explorerUrl: evt.explorerUrl, done: true,
                };
                return next;
              });
              break;

            case "done":
              setPhase("done");
              // Save to order history — use last confirmed fragment tx as the record
              setFragments(prev => {
                const last = prev.filter(f => f.done).pop();
                if (last?.txSig) {
                  const amt      = Number(evt.totalAmount ?? 1000);
                  const mevSaved = parseFloat(((amt * SIM_MEV_BPS) / 10_000).toFixed(2));
                  saveOrder({
                    id:           crypto.randomUUID(),
                    timestamp:    Date.now(),
                    type:         "agent",
                    amountUsdc:   amt,
                    tokenOut:     "SOL",
                    mevSavedUsdc: mevSaved,
                    txSig:        last.txSig,
                    explorerUrl:  last.explorerUrl ?? "",
                    slices:       evt.n,
                  });
                }
                return prev;
              });
              break;

            case "error":
              setErrorMsg(evt.message);
              setPhase("error");
              break;
          }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setErrorMsg(e.message);
        setPhase("error");
      }
    }
  }, [orderText, addLog]);

  const stop = () => {
    abortRef.current?.abort();
    setPhase("idle");
  };

  const reset = () => {
    setPhase("idle");
    setReasoning("");
    setStrategy(null);
    setLogs([]);
    setFragments([]);
    setErrorMsg("");
    setPool("");
  };

  const isRunning = phase === "thinking" || phase === "setup" || phase === "executing";
  const isIdle    = phase === "idle";

  return (
    <div className="flex flex-col rounded-2xl border border-[#00d4ff33] bg-[#0c0c1a] overflow-hidden
                    shadow-[0_0_0_1px_#00d4ff22,0_0_40px_#00d4ff0a]">
      {/* Header */}
      <div className="relative flex items-center gap-3 px-5 py-4 border-b border-[#00d4ff22] bg-gradient-to-r from-[#00d4ff0a] to-transparent">
        <div className="relative">
          <div className="w-2.5 h-2.5 rounded-full bg-[#00d4ff] shadow-[0_0_8px_#00d4ff]" />
          <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-[#00d4ff] animate-ping opacity-40" />
        </div>
        <div>
          <div className="font-mono text-sm font-bold text-[#00d4ff] tracking-[0.08em]">
            AI Trading Agent
          </div>
          <div className="text-[10px] font-mono text-[#3a3a5a] mt-0.5">
            Describe your trade in plain English — the agent decides how to execute it
          </div>
        </div>
        <span className="ml-auto text-[9px] font-mono px-2 py-1 rounded border border-[#00d4ff33]
                         text-[#00d4ff] bg-[#00d4ff10] uppercase tracking-wider shrink-0">
          AUTONOMOUS
        </span>
      </div>

      {/* Order input */}
      <div className="px-5 pt-4 pb-3 border-b border-[#1a1a2e]">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-widest text-[#3a3a5a] font-mono">
            Your order
          </div>
          {market && (
            <div className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
              market.change24h >= 0
                ? "text-[#00ff88] border-[#00ff8833] bg-[#00ff8808]"
                : "text-[#ff3b5c] border-[#ff3b5c33] bg-[#ff3b5c08]"
            }`}>
              SOL ${market.price.toFixed(2)} {market.change24h >= 0 ? "▲" : "▼"} {Math.abs(market.change24h).toFixed(2)}% 24h
            </div>
          )}
        </div>
        <textarea
          value={orderText}
          onChange={e => setOrderText(e.target.value)}
          disabled={isRunning}
          placeholder={`e.g. "buy $2000 of SOL, I'm worried about market impact"`}
          rows={2}
          className="w-full bg-[#080812] border border-[#1a1a2e] rounded-lg px-3 py-2.5
                     text-[13px] font-mono text-[#f1f0f7] placeholder-[#2a2a42] resize-none
                     focus:outline-none focus:border-[#00d4ff55] disabled:opacity-50
                     leading-5"
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey && !isRunning && orderText.trim()) {
              e.preventDefault();
              run();
            }
          }}
        />
        {/* Example pills — only show when idle and empty */}
        {isIdle && !orderText && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                onClick={() => setOrderText(ex)}
                className="text-[10px] font-mono px-2 py-1 rounded border border-[#1a1a2e]
                           text-[#3a3a5a] hover:border-[#00d4ff44] hover:text-[#00d4ff]
                           transition-colors truncate max-w-xs"
              >
                {ex.length > 48 ? ex.slice(0, 48) + "…" : ex}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* AI Reasoning — streams live */}
      <div className="px-5 py-4 border-b border-[#1a1a2e]">
        <div className="text-[10px] uppercase tracking-widest text-[#3a3a5a] font-mono mb-3 flex items-center gap-2">
          AI reasoning
          {phase === "thinking" && (
            <span className="inline-flex gap-0.5 ml-1">
              <span className="w-1 h-1 rounded-full bg-[#00d4ff] animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1 h-1 rounded-full bg-[#00d4ff] animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1 h-1 rounded-full bg-[#00d4ff] animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          )}
        </div>

        {/* Streamed prose */}
        <div className="min-h-[48px] text-[13px] font-mono text-[#c0c0e0] leading-6">
          {reasoning || (isIdle
            ? <span className="italic text-[#2a2a4a]">AI will reason about your trade here…</span>
            : null
          )}
          {/* Blinking cursor while streaming */}
          {phase === "thinking" && (
            <span style={{ opacity: blink ? 1 : 0 }} className="transition-opacity duration-100 text-[#00d4ff]">▌</span>
          )}
        </div>

        {/* Strategy card — appears after reasoning finishes */}
        {strategy && (
          <div className="flex gap-2 mt-3">
            <div className="w-16 shrink-0 rounded-lg bg-[#00d4ff0a] border border-[#00d4ff22] flex flex-col items-center justify-center py-2">
              <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-wider">Slices</div>
              <div className="text-2xl font-mono font-bold text-[#00d4ff]">{strategy.n}</div>
            </div>
            <div className="flex-1 rounded-lg bg-[#ffffff04] border border-[#1a1a2e] px-3 py-2">
              <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-wider mb-1">Risk note</div>
              <div className="text-[11px] font-mono text-[#6a6a8a] leading-4">{strategy.riskNote}</div>
            </div>
          </div>
        )}
      </div>

      {/* Execution */}
      <div className="px-5 py-4 border-b border-[#1a1a2e] flex-1">
        <div className="text-[10px] uppercase tracking-widest text-[#3a3a5a] font-mono mb-3">
          Execution
        </div>

        {/* Fragment progress bar */}
        {strategy && (
          <div className="flex gap-1.5 mb-3">
            {Array.from({ length: strategy.n }).map((_, i) => {
              const f = fragments[i];
              return (
                <div key={i} className={`flex-1 h-1.5 rounded-full transition-all duration-500 ${
                  f?.done
                    ? "bg-[#00ff88] shadow-[0_0_6px_#00ff88]"
                    : f
                    ? "bg-[#00d4ff44] animate-pulse"
                    : "bg-[#1e1e32]"
                }`} />
              );
            })}
          </div>
        )}

        {/* Fragment cards */}
        {fragments.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {fragments.map(f => (
              <div
                key={f.index}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 border text-[11px] font-mono transition-colors duration-300 ${
                  f.done
                    ? "border-[#00ff8833] bg-[#00ff8808] text-[#00ff88]"
                    : "border-[#00d4ff33] bg-[#00d4ff08] text-[#00d4ff] animate-pulse"
                }`}
              >
                <span className="shrink-0 font-bold">
                  {f.done ? "✓" : "◌"} Fragment {f.index + 1}/{f.total}
                </span>
                <span className="text-[#3a3a5a]">{f.amount.toFixed(2)} USDC</span>
                {f.done && f.txSig ? (
                  <a
                    href={f.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-[#00d4ff] hover:underline shrink-0"
                  >
                    {f.txSig.slice(0, 12)}… ↗
                  </a>
                ) : (
                  <span className="ml-auto text-[#3a3a5a]">executing…</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pool link */}
        {pool && (
          <div className="text-[10px] font-mono text-[#3a3a5a] mb-2">
            Pool:{" "}
            <a
              href={`https://explorer.solana.com/address/${pool}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00d4ff] hover:underline"
            >
              {pool.slice(0, 20)}… ↗
            </a>
          </div>
        )}

        {/* Log stream */}
        <div ref={logRef} className="max-h-24 overflow-y-auto font-mono text-[11px] space-y-0.5 pr-1">
          {logs.map((e, i) => (
            <div key={i} className={`flex gap-2 leading-5 ${
              e.level === "warn"    ? "text-yellow-400" :
              e.level === "success" ? "text-[#00ff88]"  :
              e.level === "error"   ? "text-[#ff3b5c]"  :
                                      "text-[#3a3a5a]"
            }`}>
              <span className="shrink-0">
                {e.level === "warn" ? "!" : e.level === "success" ? "✓" : e.level === "error" ? "✗" : "·"}
              </span>
              <span className="break-all">{e.text}</span>
            </div>
          ))}
          {logs.length === 0 && isIdle && (
            <div className="italic text-[#2a2a4a]">Waiting to run…</div>
          )}
        </div>

        {/* Error */}
        {phase === "error" && (
          <div className="mt-2 rounded-lg border border-[#ff3b5c44] bg-[#ff3b5c0a] px-3 py-2 text-[12px] font-mono text-[#ff3b5c]">
            ✗ {errorMsg}
          </div>
        )}

        {/* Done */}
        {phase === "done" && (
          <div className="mt-2 rounded-lg border border-[#00ff8844] bg-[#00ff8808] px-3 py-2.5">
            <div className="text-[12px] font-mono font-bold text-[#00ff88]">
              ✓ All {strategy?.n} fragments confirmed on devnet
            </div>
            <div className="text-[11px] font-mono text-[#3a3a5a] mt-0.5">
              Zero MEV — order was invisible until settlement
            </div>
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="px-5 pb-5 pt-3">
        {isRunning ? (
          <button
            onClick={stop}
            className="w-full py-3.5 rounded-xl border border-[#3a3a5a44] bg-[#1a1a2e]
                       text-[#3a3a5a] text-sm font-mono font-bold tracking-wider
                       hover:border-[#ff3b5c55] hover:text-[#ff3b5c] transition-all duration-200"
          >
            ◼  Stop Agent
          </button>
        ) : (
          <button
            onClick={phase === "idle" ? run : reset}
            disabled={isIdle && !orderText.trim()}
            className="btn-shimmer relative w-full py-3.5 rounded-xl border border-[#00d4ff44] bg-[#00d4ff0c]
                       text-[#00d4ff] text-sm font-mono font-bold tracking-wider overflow-hidden
                       hover:bg-[#00d4ff18] hover:border-[#00d4ff88] hover:shadow-cyan
                       transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {phase === "done"  ? "↺  Run Again" :
             phase === "error" ? "↺  Retry" :
             "▶  Run AI Agent"}
          </button>
        )}
        <p className="text-center text-[10px] font-mono text-[#2a2a42] mt-2">
          Press Enter or click ▶ · each fragment executes live on Solana devnet
        </p>
      </div>
    </div>
  );
}
