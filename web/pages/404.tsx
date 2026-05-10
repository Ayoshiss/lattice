import Head from "next/head";
import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <Head>
        <title>404 — Lattice</title>
      </Head>
      <div className="min-h-screen bg-[#05050f] text-[#f1f0f7] flex flex-col items-center justify-center px-6">

        {/* Ambient glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full pointer-events-none"
             style={{ background: "radial-gradient(circle, #f0b42910 0%, transparent 70%)" }} />

        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 mb-16 hover:opacity-80 transition-opacity">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <rect x="4" y="4" width="24" height="24" rx="3" transform="rotate(45 16 16)"
              stroke="#f0b429" strokeWidth="2" opacity="0.7"/>
            <rect x="8" y="8" width="16" height="16" rx="2" transform="rotate(45 16 16)"
              stroke="#f0b429" strokeWidth="1.2" opacity="0.4"/>
            <rect x="12" y="12" width="8" height="8" rx="1.5" transform="rotate(45 16 16)"
              fill="#f0b429"/>
          </svg>
          <span className="font-mono font-bold text-[17px] tracking-[0.1em]">LATTICE</span>
        </Link>

        {/* 404 display */}
        <div className="text-center">
          <div className="font-mono text-[120px] font-black leading-none tracking-[-0.04em]
                          bg-gradient-to-b from-[#f1f0f7] to-[#a5a5a5] bg-clip-text text-transparent
                          select-none">
            404
          </div>
          <div className="font-mono text-[#f0b429] text-sm uppercase tracking-[0.25em] mt-2 mb-6">
            Order not found
          </div>
          <p className="text-[#3a3a5a] font-mono text-sm max-w-sm mx-auto leading-6 mb-10">
            This page doesn&apos;t exist — unlike the bots trying to front-run your trades.
          </p>

          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/"
              className="px-6 py-3 rounded-xl border border-[#f0b42944] bg-[#f0b4290c]
                         text-[#f0b429] font-mono text-sm font-bold tracking-wider
                         hover:border-[#f0b42988] hover:bg-[#f0b42918] transition-all duration-200"
            >
              ← Home
            </Link>
            <Link
              href="/demo"
              className="px-6 py-3 rounded-xl border border-[#00ff8844] bg-[#00ff880c]
                         text-[#00ff88] font-mono text-sm font-bold tracking-wider
                         hover:border-[#00ff8888] hover:bg-[#00ff8818] transition-all duration-200"
            >
              ▶ Live Demo
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
