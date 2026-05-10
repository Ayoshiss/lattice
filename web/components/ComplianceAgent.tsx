import { useState, useRef, useCallback, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
}

const SUGGESTED = [
  "Is Lattice legal to operate in the UAE?",
  "Does Lattice need a VARA licence?",
  "How does Lattice handle AML requirements?",
  "What are the risks for a US-based user?",
  "How does Lattice compare to regulated exchanges?",
];

export function ComplianceAgent() {
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [blink, setBlink]         = useState(true);
  const chatRef                   = useRef<HTMLDivElement>(null);
  const abortRef                  = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = setInterval(() => setBlink(b => !b), 530);
    return () => clearInterval(t);
  }, []);

  // Scroll within the chat container only — never touch the page scroll position.
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    // Only auto-scroll when already near the bottom (within 80px), so manual
    // scroll-up to re-read isn't interrupted during streaming.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const ask = useCallback(async (question: string) => {
    if (!question.trim() || loading) return;

    setMessages(prev => [...prev, { role: "user", text: question }]);
    setInput("");
    setLoading(true);

    // Add streaming assistant placeholder
    setMessages(prev => [...prev, { role: "assistant", text: "", streaming: true }]);

    abortRef.current = new AbortController();

    try {
      const resp = await fetch("/api/compliance/ask", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ question }),
        signal:  abortRef.current.signal,
      });

      if (!resp.body) throw new Error("No response body");

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: any;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          if (evt.type === "chunk") {
            setMessages(prev => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = { ...last, text: last.text + evt.text };
              }
              return next;
            });
          }
          if (evt.type === "done" || evt.type === "error") {
            setMessages(prev => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  text: evt.type === "error" ? `Error: ${evt.message}` : last.text,
                  streaming: false,
                };
              }
              return next;
            });
          }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, text: `Error: ${e.message}`, streaming: false };
          }
          return next;
        });
      }
    } finally {
      setLoading(false);
    }
  }, [loading]);

  return (
    <div className="rounded-2xl border border-[#00d4ff22] bg-[#0c0c1a] overflow-hidden
                    shadow-[0_0_0_1px_#00d4ff11,0_0_40px_#00d4ff08]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#00d4ff1a] bg-gradient-to-r from-[#00d4ff08] to-transparent">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
          <line x1="8" y1="1" x2="8" y2="15" stroke="#00d4ff" strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="3" y1="4" x2="13" y2="4" stroke="#00d4ff" strokeWidth="1.2" strokeLinecap="round"/>
          <path d="M2 4L1 7.5h4L3.5 4" stroke="#00d4ff" strokeWidth="1" strokeLinejoin="round"/>
          <path d="M10 4l-1.5 3.5h4L11 4" stroke="#00d4ff" strokeWidth="1" strokeLinejoin="round"/>
          <line x1="4" y1="14" x2="12" y2="14" stroke="#00d4ff44" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        <div>
          <div className="font-mono text-sm font-bold text-[#00d4ff] tracking-[0.08em]">
            Compliance Agent
          </div>
          <div className="text-[10px] font-mono text-[#3a3a5a] mt-0.5">
            Answers grounded in Lattice VARA compliance analysis · not legal advice
          </div>
        </div>
        <a
          href="/VARA_compliance.md"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-[10px] font-mono text-[#00d4ff] hover:underline shrink-0"
        >
          View full doc ↗
        </a>
      </div>

      {/* Chat window */}
      <div ref={chatRef} className="h-72 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-mono text-[#3a3a5a] mb-3">
              Ask anything about Lattice&apos;s regulatory status, AML approach, or VARA classification:
            </div>
            {SUGGESTED.map(q => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="block w-full text-left text-[11px] font-mono px-3 py-2 rounded-lg
                           border border-[#1a1a2e] text-[#6a6a8a]
                           hover:border-[#00d4ff33] hover:text-[#00d4ff] transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[12px] font-mono leading-5 ${
              m.role === "user"
                ? "bg-[#00d4ff18] border border-[#00d4ff33] text-[#f1f0f7]"
                : "bg-[#ffffff04] border border-[#1a1a2e] text-[#c0c0e0]"
            }`}>
              {m.text}
              {m.streaming && (
                <span style={{ opacity: blink ? 1 : 0 }} className="transition-opacity duration-100 text-[#00d4ff]">▌</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="px-5 py-3 border-t border-[#1a1a2e] flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !loading) ask(input); }}
          placeholder="Ask a compliance question…"
          disabled={loading}
          className="flex-1 bg-[#0a0a14] border border-[#1a1a2e] rounded-lg px-3 py-2
                     text-[12px] font-mono text-[#f1f0f7] placeholder-[#2a2a4a]
                     focus:outline-none focus:border-[#00d4ff55] disabled:opacity-50"
        />
        <button
          onClick={() => ask(input)}
          disabled={loading || !input.trim()}
          className="px-4 py-2 rounded-lg border border-[#00d4ff55] bg-[#00d4ff11]
                     text-[#00d4ff] text-[11px] font-mono font-semibold
                     hover:bg-[#00d4ff22] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {loading ? "…" : "Ask"}
        </button>
      </div>

      <div className="px-5 pb-3 text-[10px] font-mono text-[#2a2a4a]">
        This is not legal advice.
      </div>
    </div>
  );
}
