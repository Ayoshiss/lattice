import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import { runSimulation, DEFAULT_PARAMS, toDisplay } from "@/lib/sandwich";

export default function Home() {
  const result = runSimulation(DEFAULT_PARAMS);
  const [visible, setVisible] = useState(false);
  useEffect(() => { setTimeout(() => setVisible(true), 80); }, []);

  return (
    <>
      <Head>
        <title>Lattice — MEV-Proof Batch Auction DEX on Solana</title>
        <meta
          name="description"
          content="Lattice uses commit-reveal batch auctions to make front-running cryptographically impossible. See it live on Solana devnet."
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen bg-[#080810] text-[#e0e0f0] flex flex-col">

        {/* ── Nav ─────────────────────────────────────────────────────────── */}
        <nav className="border-b border-[#1e1e32] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Lattice diamond logo */}
            <div className="relative w-7 h-7 shrink-0">
              <div className="absolute inset-0 rounded border border-[#00d4ff] rotate-45 opacity-70" />
              <div className="absolute inset-1 rounded border border-[#00d4ff55] rotate-45" />
              <div className="absolute inset-[6px] rounded-sm bg-[#00d4ff]" />
            </div>
            <span className="font-mono font-bold text-lg tracking-wider text-[#e0e0f0]">
              LATTICE
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-[#4a4a6a]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] shadow-[0_0_6px_#00ff88] animate-pulse" />
              Solana devnet
            </span>
            <a
              href="https://explorer.solana.com/address/AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV?cluster=devnet"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-[#00d4ff] hover:underline hidden md:block"
            >
              Program ↗
            </a>
            <Link
              href="/demo"
              className="text-xs font-mono px-3 py-1.5 rounded-lg border border-[#00ff8855]
                         bg-[#00ff8811] text-[#00ff88] hover:bg-[#00ff8822] transition-colors"
            >
              Launch Demo →
            </Link>
          </div>
        </nav>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section
          className={`flex-1 flex flex-col items-center justify-center text-center px-6 py-20
                      transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
        >
          {/* Pill */}
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-8
                          bg-[#00d4ff11] border border-[#00d4ff33] text-[#00d4ff]
                          text-xs font-mono uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00d4ff] animate-pulse" />
            Frontier Hackathon 2026 · NeosLegal VARA Prize
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-5 leading-tight max-w-3xl">
            Trading bots steal
            <br />
            <span className="text-[#ff3b5c]">from every swap.</span>
          </h1>

          <p className="text-[#6a6a8a] text-base max-w-2xl mx-auto leading-7 mb-4">
            On every standard DEX, your order is visible in the mempool before it settles.
            Bots see it, jump ahead, push the price against you, then sell back — pocketing
            the difference at your expense. On a $10,000 trade that&rsquo;s{" "}
            <span className="text-[#ff3b5c] font-semibold">$99.74 stolen from you</span>.
          </p>

          <p className="text-[#e0e0f0] text-base font-semibold max-w-xl mx-auto mb-10">
            Lattice makes this{" "}
            <span className="text-[#00ff88]">cryptographically impossible</span> — not by
            monitoring bots, but by structurally removing the opportunity.
          </p>

          {/* Stats row */}
          <div className="flex flex-wrap items-center justify-center gap-4 mb-12">
            <div className="rounded-xl px-6 py-4 bg-[#ff3b5c0f] border border-[#ff3b5c33] text-center min-w-[140px]">
              <div className="text-[10px] font-mono text-[#ff3b5c99] uppercase tracking-widest mb-1">
                Bot steals per $10k trade
              </div>
              <div className="text-3xl font-mono font-bold text-[#ff3b5c]">$99.74</div>
              <div className="text-[10px] font-mono text-[#ff3b5c66] mt-1">on a regular DEX</div>
            </div>

            <div className="text-[#2a2a4a] font-mono text-2xl font-bold hidden sm:block">→</div>

            <div className="rounded-xl px-6 py-4 bg-[#00ff880f] border border-[#00ff8833] text-center min-w-[140px]">
              <div className="text-[10px] font-mono text-[#00ff8899] uppercase tracking-widest mb-1">
                Bot profit on Lattice
              </div>
              <div className="text-3xl font-mono font-bold text-[#00ff88]">$0.00</div>
              <div className="text-[10px] font-mono text-[#00ff8866] mt-1">structurally impossible</div>
            </div>

            <div className="rounded-xl px-6 py-4 bg-[#0f0f1a] border border-[#1e1e32] text-center min-w-[140px]">
              <div className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-widest mb-1">
                You save
              </div>
              <div className="text-3xl font-mono font-bold text-[#00d4ff]">
                +{toDisplay(result.latticeImprovementSol)} SOL
              </div>
              <div className="text-[10px] font-mono text-[#4a4a6a] mt-1">same trade</div>
            </div>
          </div>

          {/* CTA */}
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl
                       border-2 border-[#00ff8866] bg-[#00ff8818]
                       text-[#00ff88] text-base font-mono font-bold tracking-wider
                       hover:bg-[#00ff8830] hover:border-[#00ff88aa] transition-all
                       shadow-[0_0_40px_#00ff8822]"
          >
            Launch Demo
            <span className="text-lg">→</span>
          </Link>
          <p className="text-[11px] font-mono text-[#2a2a4a] mt-3">
            Live on Solana devnet · no wallet required
          </p>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto w-full px-6 pb-16">
          <h2 className="text-center text-sm font-mono uppercase tracking-widest text-[#4a4a6a] mb-8">
            How Lattice blocks bots
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                step: "01",
                icon: "🔒",
                title: "Seal your order",
                color: "#00d4ff",
                borderColor: "#00d4ff33",
                bgColor: "#00d4ff08",
                desc: "Before anything hits the blockchain, your order is hashed with SHA-256. Bots can see you submitted something — but not what, at what price, or for how much.",
              },
              {
                step: "02",
                icon: "⏱️",
                title: "Everyone reveals at once",
                color: "#00d4ff",
                borderColor: "#00d4ff33",
                bgColor: "#00d4ff08",
                desc: "Once the commit window closes, all traders reveal their orders simultaneously. There's no way for a bot to \"go first\" — the window is already shut.",
              },
              {
                step: "03",
                icon: "⚖️",
                title: "One fair price for all",
                color: "#00ff88",
                borderColor: "#00ff8833",
                bgColor: "#00ff8808",
                desc: "The Walrasian clearing algorithm finds the single price where all supply meets all demand. Every buyer and seller in the batch fills at exactly the same price.",
              },
            ].map((s) => (
              <div
                key={s.step}
                className="rounded-xl p-5 border"
                style={{ borderColor: s.borderColor, backgroundColor: s.bgColor }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{s.icon}</span>
                  <span
                    className="text-[10px] font-mono uppercase tracking-widest font-bold"
                    style={{ color: s.color }}
                  >
                    Step {s.step}
                  </span>
                </div>
                <h3
                  className="font-semibold text-sm mb-2"
                  style={{ color: s.color }}
                >
                  {s.title}
                </h3>
                <p className="text-[12px] text-[#4a4a6a] leading-5">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Tech specs ───────────────────────────────────────────────────── */}
        <section className="border-t border-[#1e1e32] bg-[#0a0a14]">
          <div className="max-w-5xl mx-auto px-6 py-12">
            <h2 className="text-center text-sm font-mono uppercase tracking-widest text-[#4a4a6a] mb-8">
              What&rsquo;s under the hood
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              {[
                { label: "Blockchain", value: "Solana" },
                { label: "Protocol", value: "DFBA" },
                { label: "Order sealing", value: "SHA-256" },
                { label: "Mempool bypass", value: "Jito Bundles" },
                { label: "Clearing", value: "Walrasian" },
                { label: "AI agent", value: "TWAP / Claude" },
                { label: "Relay gate", value: "x402 HTTP" },
                { label: "Regulation", value: "VARA 2026" },
              ].map((t) => (
                <div key={t.label} className="rounded-lg border border-[#1e1e32] px-3 py-3">
                  <div className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-widest mb-1">
                    {t.label}
                  </div>
                  <div className="text-[13px] font-mono font-bold text-[#e0e0f0]">{t.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────────────────── */}
        <section className="border-t border-[#1e1e32] py-16 text-center px-6">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4 max-w-xl mx-auto">
            See the difference yourself
          </h2>
          <p className="text-[#6a6a8a] text-sm mb-8 max-w-md mx-auto leading-6">
            The demo runs a real sandwich attack simulation and a live Lattice batch
            auction on Solana devnet — side by side.
          </p>
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl
                       border-2 border-[#00ff8866] bg-[#00ff8818]
                       text-[#00ff88] text-base font-mono font-bold tracking-wider
                       hover:bg-[#00ff8830] hover:border-[#00ff88aa] transition-all"
          >
            Run the Demo
            <span className="text-lg">→</span>
          </Link>
        </section>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <footer className="border-t border-[#1e1e32] px-6 py-4 flex items-center justify-between text-[10px] font-mono text-[#4a4a6a]">
          <span>Lattice · Frontier Hackathon 2026 · NeosLegal VARA Prize</span>
          <div className="flex items-center gap-4">
            <a
              href="https://explorer.solana.com/address/AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV?cluster=devnet"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00d4ff] hover:underline hidden sm:block"
            >
              AW8zeS7…F6iV ↗
            </a>
          </div>
        </footer>
      </div>
    </>
  );
}
