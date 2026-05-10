import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";

/* ── Animated counter ────────────────────────────────────────────────── */
function useCounter(target: number, duration = 2200, started = false) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!started) return;
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 4);
      setVal(Math.round(ease * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, started]);
  return val;
}

/* ── Lattice Diamond SVG ─────────────────────────────────────────────── */
function Diamond({ size = 28, gold = false }: { size?: number; gold?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <rect x="4" y="4" width="20" height="20" rx="3" transform="rotate(45 14 14)"
        stroke={gold ? "#f0b429" : "#00d4ff"} strokeWidth="1.5" opacity="0.7" />
      <rect x="7" y="7" width="14" height="14" rx="2" transform="rotate(45 14 14)"
        stroke={gold ? "#f0b429" : "#00d4ff"} strokeWidth="1" opacity="0.4" />
      <rect x="11" y="11" width="6" height="6" rx="1" transform="rotate(45 14 14)"
        fill={gold ? "#f0b429" : "#00d4ff"} />
    </svg>
  );
}

/* ── Scrambling hash display ─────────────────────────────────────────── */
function SealedHash() {
  const chars = "0123456789abcdef";
  const [hash, setHash] = useState("7a3f9b2e1c8d4f60");
  useEffect(() => {
    const iv = setInterval(() => {
      setHash(Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * 16)]).join(""));
    }, 90);
    return () => clearInterval(iv);
  }, []);
  return (
    <span className="font-mono text-[10px] text-[#f0b429] opacity-60 tracking-widest truncate max-w-[120px]">
      {hash}…
    </span>
  );
}

/* ── Bot Attack Diagram ──────────────────────────────────────────────── */
function AttackDiagram() {
  return (
    <div className="space-y-2">
      {[
        { label: "Your tx broadcast to mempool", sub: "PUBLICLY VISIBLE",   color: "#6b6b8a", dot: "#6b6b8a" },
        { label: "Bot detects your order",        sub: "MONITORING MEMPOOL", color: "#f0b429", dot: "#f0b429", bot: true },
        { label: "Bot inserts itself ahead",       sub: "FRONT-RUN",          color: "#ff3b5c", dot: "#ff3b5c", attack: true },
        { label: "You fill at a worse price",      sub: "−$99.74 EXTRACTED",  color: "#ff3b5c", dot: "#ff3b5c" },
      ].map((row, i) => (
        <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${
          row.attack ? "border-[#ff3b5c44] bg-[#ff3b5c0c]" : "border-[#1a1a2e] bg-[#ffffff02]"
        }`}>
          <div className="relative shrink-0">
            <div className="w-2 h-2 rounded-full" style={{ background: row.dot }} />
            {row.attack && <div className="absolute inset-0 w-2 h-2 rounded-full animate-ping" style={{ background: row.dot, opacity: 0.5 }} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-mono font-semibold leading-tight" style={{ color: row.color }}>{row.label}</div>
            <div className="text-[9px] font-mono text-[#a5a5a5] tracking-wider mt-0.5">{row.sub}</div>
          </div>
          {row.bot    && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#f0b42912] border border-[#f0b42933] text-[#f0b429] shrink-0">BOT</span>}
          {row.attack && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#ff3b5c12] border border-[#ff3b5c33] text-[#ff3b5c] shrink-0">ATTACK</span>}
        </div>
      ))}
      <div className="rounded-lg border border-[#ff3b5c44] bg-[#ff3b5c0a] px-4 py-3 flex items-center justify-between mt-3">
        <div>
          <div className="text-[10px] font-mono text-[#ff3b5c66] uppercase tracking-wider">Bot extracted</div>
          <div className="text-xl font-mono font-bold text-[#ff3b5c] mt-0.5">$99.74</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-wider">You received</div>
          <div className="text-xl font-mono font-bold text-[#ff3b5c] mt-0.5">99.23 SOL</div>
          <div className="text-[9px] font-mono text-[#3a3a5a]">should&apos;ve been 100.22 SOL</div>
        </div>
      </div>
    </div>
  );
}

/* ── Lattice Defense Diagram ─────────────────────────────────────────── */
function DefenseDiagram() {
  return (
    <div className="space-y-2">
      {[
        { label: "Order sealed as SHA-256 hash", sub: "CRYPTOGRAPHICALLY HIDDEN", color: "#f0b429", seal: true },
        { label: "Commit window closes",          sub: "BOTS SEE NOTHING",         color: "#a78bfa", shield: true },
        { label: "All orders reveal at once",     sub: "SIMULTANEOUS REVEAL",      color: "#00d4ff", dot: "#00d4ff" },
        { label: "p* = 100.5 USDC/SOL",           sub: "UNIFORM CLEARING PRICE",   color: "#00ff88", dot: "#00ff88" },
      ].map((row, i) => (
        <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${
          row.seal   ? "border-[#f0b42933] bg-[#f0b42908]" :
          row.shield ? "border-[#a78bfa22] bg-[#a78bfa08]" :
          "border-[#1a1a2e] bg-[#ffffff02]"
        }`}>
          <div className="w-2 h-2 rounded-full shrink-0"
               style={{ background: row.seal ? "#f0b429" : row.shield ? "#a78bfa" : (row.dot ?? "#6b6b8a") }} />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-mono font-semibold leading-tight" style={{ color: row.color }}>{row.label}</div>
            <div className="text-[9px] font-mono text-[#a5a5a5] tracking-wider mt-0.5">{row.sub}</div>
          </div>
          {row.seal   && <SealedHash />}
          {row.shield && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#a78bfa12] border border-[#a78bfa33] text-[#a78bfa] shrink-0">BLOCKED</span>}
        </div>
      ))}
      <div className="rounded-lg border border-[#00ff8844] bg-[#00ff8808] px-4 py-3 flex items-center justify-between mt-3">
        <div>
          <div className="text-[10px] font-mono text-[#00ff8866] uppercase tracking-wider">Bot extracted</div>
          <div className="text-xl font-mono font-bold text-[#00ff88] mt-0.5">$0.00</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-wider">You received</div>
          <div className="text-xl font-mono font-bold text-[#00ff88] mt-0.5">100.22 SOL</div>
          <div className="text-[9px] font-mono text-[#3a3a5a]">exactly what you deserved</div>
        </div>
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */
export default function Home() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setTimeout(() => setMounted(true), 80); }, []);
  const mev = useCounter(5_400_000_000, 2600, mounted);
  const fmt = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${n.toLocaleString()}`;

  return (
    <>
      <Head>
        <title>Lattice — Front-running is now impossible</title>
        <meta name="description" content="Lattice seals every order with SHA-256 cryptography. Bots can't front-run what they can't see." />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />

        {/* OG */}
        <meta property="og:type"        content="website" />
        <meta property="og:title"       content="Lattice — Front-running is now impossible" />
        <meta property="og:description" content="Sealed-bid batch auction DEX on Solana. Bots can't front-run what they can't see." />
        <meta property="og:image"       content="/api/og" />
        <meta property="og:image:width"  content="1200" />
        <meta property="og:image:height" content="630" />

        {/* Twitter */}
        <meta name="twitter:card"        content="summary_large_image" />
        <meta name="twitter:title"       content="Lattice — Front-running is now impossible" />
        <meta name="twitter:description" content="Sealed-bid batch auction DEX on Solana. Bots can't front-run what they can't see." />
        <meta name="twitter:image"       content="/api/og" />
      </Head>

      {/* ── Ambient background ──────────────────────────────────────── */}
      <div className="fixed inset-0 overflow-hidden" style={{ zIndex: 0 }}>
        <div className="absolute inset-0 bg-[#05050f]" />
        <div className="absolute inset-0 circuit-grid" />
        <div className="absolute animate-drift" style={{
          top: "-20%", left: "-12%", width: "58vw", height: "55vh",
          background: "radial-gradient(circle, rgba(255,59,92,0.11) 0%, transparent 68%)",
          filter: "blur(50px)",
        }} />
        <div className="absolute animate-drift-slow" style={{
          bottom: "-20%", right: "-12%", width: "55vw", height: "55vh",
          background: "radial-gradient(circle, rgba(0,212,255,0.07) 0%, transparent 65%)",
          filter: "blur(50px)", animationDelay: "-11s",
        }} />
        <div className="absolute animate-drift-slow" style={{
          top: "25%", left: "38%", width: "28vw", height: "28vh",
          background: "radial-gradient(circle, rgba(240,180,41,0.05) 0%, transparent 65%)",
          filter: "blur(60px)", animationDelay: "-5s",
        }} />
      </div>

      <div className="relative text-[#f1f0f7]" style={{ zIndex: 1 }}>

        {/* ── Nav ─────────────────────────────────────────────────── */}
        <nav className="sticky top-0 z-50 border-b border-[#1a1a2e] bg-[#05050fdd] backdrop-blur-xl
                        px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Diamond size={24} gold />
            <span className="font-mono font-bold text-[17px] tracking-[0.1em]">LATTICE</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-breathe-green" />
              <span className="text-[11px] font-mono text-[#3a3a5a]">Solana devnet live</span>
            </div>
            <a href="https://explorer.solana.com/address/AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV?cluster=devnet"
               target="_blank" rel="noopener noreferrer"
               className="hidden md:block text-[11px] font-mono text-[#a5a5a5] hover:text-[#00d4ff] transition-colors">
              AW8zeS7…F6iV ↗
            </a>
            <Link href="/demo" className="btn-shimmer inline-flex items-center gap-2 px-4 py-2 rounded-lg
                         border border-[#00ff8840] bg-[#00ff8810] text-[#00ff88]
                         text-[12px] font-mono font-semibold tracking-wider
                         hover:border-[#00ff8880] hover:bg-[#00ff8820] transition-all">
              Run a Live Trade →
            </Link>
          </div>
        </nav>

        {/* ── Hero ────────────────────────────────────────────────── */}
        <section className="min-h-[90vh] flex flex-col items-center justify-center text-center px-6 py-24">
          <div className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-8
                          border border-[#f0b42930] bg-[#f0b42908] text-[#f0b429]
                          text-[10px] font-mono uppercase tracking-[0.2em]
                          transition-all duration-500 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}>
            <Diamond size={11} gold />
            Frontier Hackathon 2026 &nbsp;·&nbsp; Live on Solana Devnet
          </div>

          <h1 className={`text-5xl sm:text-6xl md:text-7xl font-black tracking-[-0.03em] leading-[1.02] mb-6
                          transition-all duration-600 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
              style={{ transitionDelay: "80ms" }}>
            <span className="block text-[#f1f0f7]">Bots steal from</span>
            <span className="block">
              <span className="glitch text-gradient-red" data-text="every swap.">every swap.</span>
            </span>
          </h1>

          <p className={`text-base sm:text-lg text-[#6b6b8a] max-w-lg leading-relaxed mb-10 font-light
                         transition-all duration-600 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
             style={{ transitionDelay: "160ms" }}>
            Lattice seals orders with{" "}
            <span className="text-[#a78bfa] font-medium">SHA-256 cryptography</span>{" "}
            before they touch the blockchain.
            Bots can&rsquo;t front-run what they can&rsquo;t see.
          </p>

          <div className={`flex items-center gap-4 flex-wrap justify-center mb-16
                           transition-all duration-600 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
               style={{ transitionDelay: "240ms" }}>
            <Link href="/demo" className="btn-shimmer inline-flex items-center gap-2.5 px-7 py-3.5 rounded-xl
                       border border-[#00ff8850] bg-[#00ff8812] text-[#00ff88]
                       text-sm font-mono font-bold tracking-wider shadow-green
                       hover:border-[#00ff88a0] hover:bg-[#00ff8822] transition-all duration-200">
              ▶ Run a Live Trade on Solana
            </Link>
            <a href="https://explorer.solana.com/address/AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV?cluster=devnet"
               target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl border border-[#a5a5a5]
                          text-sm font-mono text-[#6b6b8a] hover:border-[#3a3a52] hover:text-[#a78bfa] transition-all">
              View on Explorer ↗
            </a>
          </div>

          {/* Live MEV counter */}
          <div className={`transition-all duration-600 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
               style={{ transitionDelay: "320ms" }}>
            <div className="text-[10px] font-mono text-[#a5a5a5] uppercase tracking-[0.25em] mb-3">
              MEV extracted from DEX traders in 2024
            </div>
            <div className="text-4xl sm:text-5xl font-black font-mono text-gradient-red tabular-nums">
              {fmt(mev)}
            </div>
            <div className="text-[11px] font-mono text-[#a5a5a5] mt-2">
              Source: Flashbots, EigenPhi &nbsp;·&nbsp; Lattice bot profit:{" "}
              <span className="text-[#00ff88] font-semibold">$0.00</span>
            </div>
          </div>
        </section>

        {/* ── Stats bar ───────────────────────────────────────────── */}
        <div className="border-y border-[#1a1a2e] bg-[#07070fbb] backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { val: "$99.74", label: "stolen per $10K swap\n(regular DEX)",     color: "#ff3b5c" },
              { val: "$0.00",  label: "bot profit on Lattice\n(mathematical)",   color: "#00ff88" },
              { val: "64",     label: "sealed order slots\nper batch",            color: "#f0b429" },
              { val: "100%",   label: "on-chain · devnet live\nfully auditable", color: "#a78bfa" },
            ].map((s, i) => (
              <div key={i}>
                <div className="text-2xl sm:text-3xl font-black font-mono" style={{ color: s.color }}>{s.val}</div>
                <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-wider mt-2 leading-[1.8] whitespace-pre-line">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Battle ──────────────────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center mb-14">
            <div className="text-[10px] font-mono text-[#a5a5a5] uppercase tracking-[0.25em] mb-4">The same $10,000 trade</div>
            <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.02em]">Two completely different outcomes</h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="relative rounded-2xl overflow-hidden border border-[#ff3b5c30] bg-[#0c0c1a]">
              <div className="absolute inset-0 bg-gradient-to-br from-[#ff3b5c07] to-transparent pointer-events-none" />
              <div className="relative p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#ff3b5c] animate-ping" />
                  <div>
                    <div className="text-xs font-mono font-bold text-[#ff3b5c] tracking-wider">REGULAR DEX</div>
                    <div className="text-[10px] font-mono text-[#3a3a5a]">Uniswap · Raydium · any AMM</div>
                  </div>
                  <span className="ml-auto text-[9px] font-mono px-2 py-1 rounded border border-[#ff3b5c30] text-[#ff3b5c] bg-[#ff3b5c0c] uppercase tracking-wider shrink-0">VULNERABLE</span>
                </div>
                <AttackDiagram />
              </div>
            </div>
            <div className="relative rounded-2xl overflow-hidden border border-[#00ff8830] bg-[#0c0c1a]">
              <div className="absolute inset-0 bg-gradient-to-bl from-[#00ff8806] to-transparent pointer-events-none" />
              <div className="relative p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#00ff88] animate-breathe-green" />
                  <div>
                    <div className="text-xs font-mono font-bold text-[#00ff88] tracking-wider">LATTICE PROTOCOL</div>
                    <div className="text-[10px] font-mono text-[#3a3a5a]">Dual-Flow Batch Auction · Solana devnet</div>
                  </div>
                  <span className="ml-auto text-[9px] font-mono px-2 py-1 rounded border border-[#00ff8830] text-[#00ff88] bg-[#00ff8808] uppercase tracking-wider shrink-0">PROTECTED</span>
                </div>
                <DefenseDiagram />
              </div>
            </div>
          </div>
        </section>

        {/* ── How it works ────────────────────────────────────────── */}
        <section className="border-y border-[#1a1a2e] bg-[#07070fbb] backdrop-blur-sm py-20 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-14">
              <div className="text-[10px] font-mono text-[#a5a5a5] uppercase tracking-[0.25em] mb-4">Protocol mechanics</div>
              <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.02em]">How Lattice makes it impossible</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {[
                {
                  step: "01", title: "Seal", color: "#f0b429", border: "#f0b42920", bg: "#f0b42908",
                  icon: (
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                      <rect x="3" y="7" width="20" height="15" rx="3" stroke="#f0b429" strokeWidth="1.5" />
                      <path d="M8 7V6a5 5 0 0110 0v1" stroke="#f0b429" strokeWidth="1.5" strokeLinecap="round" />
                      <circle cx="13" cy="15" r="2" fill="#f0b429" />
                      <path d="M13 17v2" stroke="#f0b429" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ),
                  desc: "Submit a SHA-256 hash of your order. Price, amount, direction — all hidden. Not even validators know your intent.",
                  code: "sha256(in+out+amount+price+salt)",
                },
                {
                  step: "02", title: "Wait", color: "#a78bfa", border: "#a78bfa20", bg: "#a78bfa08",
                  icon: (
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                      <circle cx="13" cy="13" r="9" stroke="#a78bfa" strokeWidth="1.5" />
                      <circle cx="13" cy="13" r="4" stroke="#a78bfa" strokeWidth="1" opacity="0.5" />
                      <path d="M13 4v4M13 18v4M4 13h4M18 13h4" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ),
                  desc: "The commit window closes after N slots. No new orders enter. Bots have nothing to react to — zero attack surface.",
                  code: "~20 slots commit · ~15 slots reveal",
                },
                {
                  step: "03", title: "Clear", color: "#00ff88", border: "#00ff8820", bg: "#00ff8808",
                  icon: (
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                      <path d="M13 3l1.8 5.5h5.8l-4.7 3.4 1.8 5.5L13 14l-4.7 3.4 1.8-5.5L5.4 8.5h5.8z"
                            stroke="#00ff88" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                  ),
                  desc: "All traders reveal simultaneously. The Walrasian algorithm finds one fair price where supply meets demand. Every order fills at identical p*.",
                  code: "p* = argmax_p min(cumBuy(≥p), cumSell(≤p))",
                },
              ].map((s) => (
                <div key={s.step} className="glass rounded-2xl p-6 border hover:scale-[1.02] hover:shadow-lg transition-all duration-300 cursor-default"
                     style={{ borderColor: s.border, background: s.bg }}>
                  <div className="flex items-start justify-between mb-5">
                    {s.icon}
                    <span className="text-[10px] font-mono text-[#a5a5a5] font-bold tracking-wider">{s.step}</span>
                  </div>
                  <div className="text-lg font-bold mb-2 tracking-tight" style={{ color: s.color }}>{s.title}</div>
                  <p className="text-[12px] text-[#6b6b8a] leading-[1.7] mb-4">{s.desc}</p>
                  <div className="rounded-lg bg-[#05050f] border border-[#1a1a2e] px-3 py-2">
                    <code className="text-[10px] font-mono break-all" style={{ color: s.color, opacity: 0.65 }}>{s.code}</code>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Tech proof ──────────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 py-20">
          <div className="text-center mb-14">
            <div className="text-[10px] font-mono text-[#a5a5a5] uppercase tracking-[0.25em] mb-4">Technical spec</div>
            <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.02em]">Built for production</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="rounded-2xl border border-[#1a1a2e] bg-[#0c0c1a] overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a2e] bg-[#05050f]">
                <div className="w-2.5 h-2.5 rounded-full bg-[#ff3b5c44]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#f0b42944]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#00ff8844]" />
                <span className="ml-3 text-[10px] font-mono text-[#a5a5a5]">program.log</span>
              </div>
              <div className="p-5 space-y-3">
                {[
                  ["network",  "Solana devnet",                                   "#00d4ff"],
                  ["program",  "AW8zeS7…F6iV",                                    "#f0b429"],
                  ["language", "Rust + Anchor 0.30.1",                            "#a78bfa"],
                  ["state",    "#[zero_copy] · 64-slot book · 7296 bytes",        "#f1f0f7"],
                  ["clearing", "Walrasian uniform price (Dual-Flow Batch)",       "#00ff88"],
                  ["relay",    "x402 HTTP micropayment · Jito private bundles",   "#00d4ff"],
                  ["mev",      "structurally impossible (commit-reveal)",         "#00ff88"],
                  ["audit",    "Pre-audit — required before mainnet",             "#ff3b5c"],
                ].map(([k, v, c]) => (
                  <div key={k} className="flex gap-3 items-start text-[11px] font-mono">
                    <span className="text-[#a5a5a5] shrink-0 w-16 text-right">{k}</span>
                    <span className="text-[#1a1a2e]">→</span>
                    <span style={{ color: c }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-[#1a1a2e] bg-[#0c0c1a] p-6">
              <div className="text-[10px] font-mono text-[#a5a5a5] uppercase tracking-[0.2em] mb-1">VARA 2026 · NeosLegal Prize</div>
              <div className="text-sm font-bold text-[#f1f0f7] mb-5">Non-custodial DeFi carve-out</div>
              <div className="space-y-3">
                {[
                  { label: "Custody of user funds",       val: "None — PDA vaults only",            ok: true  },
                  { label: "Front-running capability",    val: "Cryptographically impossible",       ok: true  },
                  { label: "Information privilege",       val: "None — sealed until clearing",       ok: true  },
                  { label: "Wash trading profitability",  val: "Zero — uniform price",               ok: true  },
                  { label: "Smart contract audit",        val: "Pre-audit (hackathon prototype)",    ok: false },
                  { label: "Upgrade authority",           val: "Recommend multisig + 7d timelock",  ok: false },
                ].map((r) => (
                  <div key={r.label} className="flex items-start justify-between gap-3 py-2 border-b border-[#1a1a2e]">
                    <span className="text-[11px] font-mono text-[#6b6b8a]">{r.label}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] font-mono text-right" style={{ color: r.ok ? "#00ff88" : "#f0b429" }}>{r.val}</span>
                      <span>{r.ok ? "✓" : "⚠"}</span>
                    </div>
                  </div>
                ))}
              </div>
              <a href="/VARA_compliance.md" target="_blank"
                 className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#a78bfa] hover:underline mt-4">
                Full VARA compliance doc →
              </a>
            </div>
          </div>
        </section>

        {/* ── Final CTA ───────────────────────────────────────────── */}
        <section className="border-t border-[#1a1a2e] py-24 px-6 text-center relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none"
               style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(0,255,136,0.05) 0%, transparent 55%)" }} />
          <div className="relative max-w-xl mx-auto">
            <div className="text-[10px] font-mono text-[#a5a5a5] uppercase tracking-[0.25em] mb-6">
              It&rsquo;s live. Right now. On Solana devnet.
            </div>
            <h2 className="text-4xl sm:text-5xl font-black tracking-[-0.03em] mb-6 leading-[1.05]">
              Stop paying bots.<br />
              <span className="text-gradient-green">Trade with Lattice.</span>
            </h2>
            <p className="text-[#6b6b8a] mb-10 text-sm leading-relaxed max-w-md mx-auto">
              Watch a real batch auction run in 60 seconds —
              sealed orders, live slot countdown, Walrasian clearing, verifiable on Solana Explorer.
            </p>
            <Link href="/demo" className="btn-shimmer inline-flex items-center gap-3 px-10 py-4 rounded-xl
                       border border-[#00ff8850] bg-[#00ff8812] text-[#00ff88]
                       text-base font-mono font-bold tracking-wider shadow-green
                       hover:border-[#00ff88a0] hover:bg-[#00ff8825] transition-all duration-200">
              ▶ Run a Live Trade on Solana devnet
            </Link>
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <footer className="border-t border-[#1a1a2e] px-6 py-5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Diamond size={17} gold />
            <span className="text-[11px] font-mono text-[#a5a5a5]">Lattice · Frontier Hackathon 2026</span>
          </div>
          <div className="flex items-center gap-5">
            {[
              ["/VARA_compliance.md", "VARA Compliance"],
              ["/api/compliance/disclosure", "Risk Disclosure API"],
              ["https://explorer.solana.com/address/AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV?cluster=devnet", "Onchain ↗"],
            ].map(([href, label]) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                 className="text-[11px] font-mono text-[#a5a5a5] hover:text-[#6b6b8a] transition-colors">
                {label}
              </a>
            ))}
          </div>
        </footer>
      </div>
    </>
  );
}
