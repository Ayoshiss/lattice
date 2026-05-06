import { useState, useRef, useCallback } from "react";

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

export function AgentPanel() {
  const [phase, setPhase]         = useState<AgentPhase>("idle");
  const [thinking, setThinking]   = useState("");
  const [strategy, setStrategy]   = useState<Strategy | null>(null);
  const [logs, setLogs]           = useState<{ text: string; level: string }[]>([]);
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [errorMsg, setErrorMsg]   = useState("");
  const [pool, setPool]           = useState("");
  const [totalAmount, setTotalAmount] = useState(1000);
  const [horizonSecs, setHorizonSecs] = useState(30);
  const [limitPrice, setLimitPrice]   = useState(150);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addLog = useCallback((text: string, level: string) => {
    setLogs(prev => [...prev, { text, level }]);
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, 30);
  }, []);

  const run = useCallback(async () => {
    // Reset state
    setPhase("thinking");
    setThinking("");
    setStrategy(null);
    setLogs([]);
    setFragments([]);
    setErrorMsg("");
    setPool("");

    abortRef.current = new AbortController();

    try {
      const resp = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalAmount, tokenOut: "wSOL", horizonSeconds: horizonSecs, limitPrice }),
        signal: abortRef.current.signal,
      });

      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
            case "thinking":
              setThinking(evt.text);
              setPhase("thinking");
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
                next[evt.index] = {
                  index: evt.index,
                  total: evt.total,
                  amount: evt.amount,
                  done: false,
                };
                return next;
              });
              break;

            case "fragment_done":
              setFragments(prev => {
                const next = [...prev];
                next[evt.index] = {
                  ...(next[evt.index] ?? { index: evt.index, total: evt.total, amount: 0 }),
                  txSig: evt.txSig,
                  explorerUrl: evt.explorerUrl,
                  done: true,
                };
                return next;
              });
              break;

            case "done":
              setPhase("done");
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
  }, [totalAmount, horizonSecs, limitPrice, addLog]);

  const stop = () => {
    abortRef.current?.abort();
    setPhase("idle");
  };

  const isRunning = phase === "thinking" || phase === "setup" || phase === "executing";

  return (
    <div className="flex flex-col rounded-xl border border-[#00d4ff44] bg-[#0f0f1a] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#1e1e32] bg-[#00d4ff08]">
        <div className="w-2 h-2 rounded-full bg-[#00d4ff] shadow-[0_0_8px_#00d4ff]" />
        <div>
          <div className="font-mono text-sm font-bold text-[#00d4ff] tracking-wide">
            AI Trading Agent
          </div>
          <div className="text-[10px] font-mono text-[#4a4a6a] mt-0.5">
            LLM decides the strategy — agent executes on Solana devnet
          </div>
        </div>
        <span className="ml-auto text-[10px] font-mono px-2 py-1 rounded bg-[#00d4ff18] text-[#00d4ff] border border-[#00d4ff33]">
          AUTONOMOUS
        </span>
      </div>

      {/* Order config */}
      <div className="px-5 pt-4 pb-3 border-b border-[#1e1e32]">
        <div className="text-[10px] uppercase tracking-widest text-[#4a4a6a] font-mono mb-3">
          Order parameters
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-mono text-[#4a4a6a] block mb-1">Amount (USDC)</label>
            <input
              type="number"
              value={totalAmount}
              onChange={e => setTotalAmount(Number(e.target.value))}
              disabled={isRunning}
              className="w-full bg-[#0a0a14] border border-[#1e1e32] rounded px-2 py-1.5
                         text-[13px] font-mono text-[#e0e0f0] focus:outline-none focus:border-[#00d4ff55]
                         disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-[#4a4a6a] block mb-1">Horizon (sec)</label>
            <input
              type="number"
              value={horizonSecs}
              onChange={e => setHorizonSecs(Number(e.target.value))}
              disabled={isRunning}
              className="w-full bg-[#0a0a14] border border-[#1e1e32] rounded px-2 py-1.5
                         text-[13px] font-mono text-[#e0e0f0] focus:outline-none focus:border-[#00d4ff55]
                         disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-[#4a4a6a] block mb-1">Limit price</label>
            <input
              type="number"
              value={limitPrice}
              onChange={e => setLimitPrice(Number(e.target.value))}
              disabled={isRunning}
              className="w-full bg-[#0a0a14] border border-[#1e1e32] rounded px-2 py-1.5
                         text-[13px] font-mono text-[#e0e0f0] focus:outline-none focus:border-[#00d4ff55]
                         disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      {/* AI Reasoning */}
      <div className="px-5 py-4 border-b border-[#1e1e32]">
        <div className="text-[10px] uppercase tracking-widest text-[#4a4a6a] font-mono mb-3 flex items-center gap-2">
          AI strategy
          {phase === "thinking" && (
            <span className="inline-flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-[#00d4ff] animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1 h-1 rounded-full bg-[#00d4ff] animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1 h-1 rounded-full bg-[#00d4ff] animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          )}
        </div>

        {phase === "idle" && !strategy && (
          <div className="text-[12px] font-mono text-[#2a2a4a] italic">
            LLM will analyze the order and choose the optimal TWAP slice count…
          </div>
        )}

        {phase === "thinking" && (
          <div className="text-[12px] font-mono text-[#4a4a6a] animate-pulse">
            {thinking || "Analyzing order…"}
          </div>
        )}

        {strategy && (
          <div className="space-y-2">
            <div className="rounded-lg bg-[#00d4ff08] border border-[#00d4ff22] px-3 py-2.5">
              <div className="text-[10px] font-mono text-[#00d4ff66] uppercase tracking-wider mb-1">
                Rationale
              </div>
              <div className="text-[12px] font-mono text-[#c0c0e0] leading-4">
                {strategy.rationale}
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1 rounded-lg bg-[#ffffff04] border border-[#1e1e32] px-3 py-2 text-center">
                <div className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-wider">Slices</div>
                <div className="text-xl font-mono font-bold text-[#00d4ff] mt-0.5">{strategy.n}</div>
              </div>
              <div className="flex-[3] rounded-lg bg-[#ffffff04] border border-[#1e1e32] px-3 py-2">
                <div className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-wider mb-1">Risk note</div>
                <div className="text-[11px] font-mono text-[#6a6a8a] leading-4">{strategy.riskNote}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Execution log */}
      <div className="px-5 py-4 border-b border-[#1e1e32] flex-1">
        <div className="text-[10px] uppercase tracking-widest text-[#4a4a6a] font-mono mb-3">
          Execution
        </div>

        {/* Fragment progress */}
        {fragments.length > 0 && (
          <div className="flex gap-1.5 mb-3">
            {fragments.map((f) => (
              <div
                key={f.index}
                className={`flex-1 h-1.5 rounded-full transition-all duration-500 ${
                  f.done
                    ? "bg-[#00ff88] shadow-[0_0_6px_#00ff88]"
                    : "bg-[#00d4ff44] animate-pulse"
                }`}
              />
            ))}
            {/* Remaining placeholder bars */}
            {strategy && Array.from({ length: strategy.n - fragments.length }).map((_, i) => (
              <div key={`ph-${i}`} className="flex-1 h-1.5 rounded-full bg-[#1e1e32]" />
            ))}
          </div>
        )}

        {/* Fragment cards */}
        {fragments.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {fragments.map((f) => (
              <div
                key={f.index}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 border text-[11px] font-mono transition-colors duration-300 ${
                  f.done
                    ? "border-[#00ff8833] bg-[#00ff8808] text-[#00ff88]"
                    : "border-[#00d4ff33] bg-[#00d4ff08] text-[#00d4ff] animate-pulse"
                }`}
              >
                <span className="shrink-0 font-bold">
                  {f.done ? "✓" : "◌"} Fragment {f.index + 1}/{f.total}
                </span>
                <span className="text-[#4a4a6a]">{f.amount} USDC</span>
                {f.done && f.txSig && (
                  <a
                    href={f.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-[#00d4ff] hover:underline shrink-0"
                    onClick={e => e.stopPropagation()}
                  >
                    {f.txSig.slice(0, 12)}… ↗
                  </a>
                )}
                {!f.done && (
                  <span className="ml-auto text-[#4a4a6a]">executing…</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pool address */}
        {pool && (
          <div className="text-[10px] font-mono text-[#4a4a6a] mb-2">
            Pool:{" "}
            <a
              href={`https://explorer.solana.com/address/${pool}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00d4ff] hover:underline"
            >
              {pool.slice(0, 18)}… ↗
            </a>
          </div>
        )}

        {/* Log stream */}
        <div
          ref={logRef}
          className="max-h-28 overflow-y-auto font-mono text-[11px] space-y-0.5 pr-1"
        >
          {logs.map((entry, i) => (
            <div
              key={i}
              className={`flex gap-2 leading-5 ${
                entry.level === "warn"    ? "text-yellow-400"  :
                entry.level === "success" ? "text-[#00ff88]"   :
                entry.level === "error"   ? "text-[#ff3b5c]"   :
                                            "text-[#4a4a6a]"
              }`}
            >
              <span className="shrink-0">
                {entry.level === "warn" ? "!" :
                 entry.level === "success" ? "✓" :
                 entry.level === "error" ? "✗" : "·"}
              </span>
              <span className="break-all">{entry.text}</span>
            </div>
          ))}
          {logs.length === 0 && phase === "idle" && (
            <div className="italic text-[#2a2a4a]">Waiting to run…</div>
          )}
        </div>

        {/* Error */}
        {phase === "error" && (
          <div className="mt-2 rounded-lg border border-[#ff3b5c44] bg-[#ff3b5c0a] px-3 py-2 text-[12px] font-mono text-[#ff3b5c]">
            ✗ {errorMsg}
          </div>
        )}

        {/* Done summary */}
        {phase === "done" && (
          <div className="mt-2 rounded-lg border border-[#00ff8844] bg-[#00ff8808] px-3 py-2.5">
            <div className="text-[12px] font-mono font-bold text-[#00ff88]">
              ✓ All {strategy?.n} fragments confirmed on devnet
            </div>
            <div className="text-[11px] font-mono text-[#4a4a6a] mt-0.5">
              Zero MEV extracted — order invisible until settlement
            </div>
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="px-5 pb-5 pt-3">
        {isRunning ? (
          <button
            onClick={stop}
            className="w-full py-3 rounded-lg border border-[#4a4a6a55] bg-[#1e1e32]
                       text-[#4a4a6a] text-sm font-mono font-semibold tracking-wider
                       hover:border-[#ff3b5c55] hover:text-[#ff3b5c] transition-all"
          >
            ◼  Stop Agent
          </button>
        ) : (
          <button
            onClick={run}
            className="w-full py-3 rounded-lg border border-[#00d4ff55] bg-[#00d4ff11]
                       text-[#00d4ff] text-sm font-mono font-semibold tracking-wider
                       hover:bg-[#00d4ff22] hover:border-[#00d4ff88] transition-all"
          >
            {phase === "done" ? "↺  Run Again" :
             phase === "error" ? "↺  Retry Agent" :
             "▶  Run AI Agent"}
          </button>
        )}
        <p className="text-center text-[10px] font-mono text-[#2a2a4a] mt-2">
          LLM picks the slice count · each fragment executes on Solana devnet
        </p>
      </div>
    </div>
  );
}
