import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ComplianceDisclosure } from "./api/compliance/disclosure";

function Diamond() {
  return (
    <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
      <rect x="4" y="4" width="20" height="20" rx="3" transform="rotate(45 14 14)" stroke="#f0b429" strokeWidth="1.5" opacity="0.7" />
      <rect x="7" y="7" width="14" height="14" rx="2" transform="rotate(45 14 14)" stroke="#f0b429" strokeWidth="1" opacity="0.4" />
      <rect x="11" y="11" width="6" height="6" rx="1" transform="rotate(45 14 14)" fill="#f0b429" />
    </svg>
  );
}

const SEVERITY_COLOR: Record<string, { text: string; bg: string; border: string }> = {
  HIGH:     { text: "#ff3b5c", bg: "#ff3b5c0f", border: "#ff3b5c44" },
  MEDIUM:   { text: "#f0b429", bg: "#f0b4290f", border: "#f0b42944" },
  LOW:      { text: "#00d4ff", bg: "#00d4ff0f", border: "#00d4ff33" },
  CRITICAL: { text: "#ff3b5c", bg: "#ff3b5c14", border: "#ff3b5c66" },
};

const JURISDICTION_META: Record<string, { label: string; flag: string }> = {
  uae_vara:  { label: "UAE / Dubai · VARA",  flag: "🇦🇪" },
  eu_mica:   { label: "EU · MiCA",            flag: "🇪🇺" },
  singapore: { label: "Singapore · MAS",      flag: "🇸🇬" },
  uk:        { label: "United Kingdom · FCA", flag: "🇬🇧" },
  usa:       { label: "USA · SEC / FinCEN",   flag: "🇺🇸" },
};

function SectionHeader({ label, title }: { label: string; title: string }) {
  return (
    <div className="mb-8">
      <div className="text-[10px] font-mono text-[#a5a5a5] uppercase tracking-[0.25em] mb-2">{label}</div>
      <h2 className="text-2xl sm:text-3xl font-black tracking-[-0.02em] text-[#f1f0f7]">{title}</h2>
    </div>
  );
}

function Pill({ ok }: { ok: boolean }) {
  return ok
    ? <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#00ff8844] bg-[#00ff8810] text-[#00ff88]">✓ YES</span>
    : <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#ff3b5c44] bg-[#ff3b5c10] text-[#ff3b5c]">✗ NO</span>;
}

export default function CompliancePage() {
  const [data, setData]       = useState<ComplianceDisclosure | null>(null);
  const [copied, setCopied]   = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/compliance/disclosure")
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const curlCmd = `curl -s https://lattice.xyz/api/compliance/disclosure | jq .`;

  const copy = () => {
    navigator.clipboard.writeText(curlCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Head>
        <title>VARA Compliance & Risk Disclosure — Lattice</title>
        <meta name="description" content="Lattice VARA compliance package, risk disclosure, and machine-readable regulatory filing." />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </Head>

      <div className="min-h-screen bg-[#05050f] text-[#f1f0f7]">

        {/* Nav */}
        <nav className="sticky top-0 z-50 border-b border-[#1a1a2e] bg-[#05050fdd] backdrop-blur-xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <Diamond />
            <span className="font-mono font-bold text-[17px] tracking-[0.1em]">LATTICE</span>
          </Link>
          <div className="flex items-center gap-4">
            <a href="/api/compliance/disclosure" target="_blank" rel="noopener noreferrer"
               className="hidden sm:block text-[11px] font-mono text-[#a5a5a5] hover:text-[#00d4ff] transition-colors">
              Raw JSON API ↗
            </a>
            <Link href="/demo"
                  className="px-4 py-2 rounded-lg border border-[#00ff8840] bg-[#00ff8810] text-[#00ff88]
                             text-[12px] font-mono font-semibold hover:bg-[#00ff8820] transition-all">
              Live Demo →
            </Link>
          </div>
        </nav>

        {/* Hero */}
        <div className="border-b border-[#1a1a2e] bg-[#07070fcc]">
          <div className="max-w-5xl mx-auto px-6 py-14">
            <div className="flex items-center gap-2 mb-5">
              <span className="text-[10px] font-mono px-3 py-1 rounded-full border border-[#a78bfa33] bg-[#a78bfa0a] text-[#a78bfa] uppercase tracking-widest">
                VARA Compliance
              </span>
              <span className="text-[10px] font-mono px-3 py-1 rounded-full border border-[#1a1a2e] text-[#3a3a5a] uppercase tracking-widest">
                Live on Solana Devnet
              </span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-black tracking-[-0.03em] mb-4">
              VARA Compliance<br />
              <span className="text-[#a78bfa]">&amp; Risk Disclosure</span>
            </h1>
            <p className="text-[#6b6b8a] text-sm leading-relaxed max-w-xl mb-8">
              Machine-readable regulatory filing for Lattice — a non-custodial sealed-bid batch auction
              DEX on Solana. Prepared under VARA Rulebook V2.0 (January 2026).
            </p>

            {/* Key attributes */}
            <div className="flex flex-wrap gap-3">
              {[
                { label: "Non-custodial",       val: "PDA vaults only",         color: "#00ff88" },
                { label: "Front-running",        val: "Cryptographically impossible", color: "#00ff88" },
                { label: "Audit status",         val: "Pre-audit · devnet only", color: "#f0b429" },
                { label: "Program ID",           val: "AW8zeS7…F6iV",           color: "#00d4ff" },
              ].map(a => (
                <div key={a.label} className="rounded-lg border border-[#1a1a2e] bg-[#0c0c1a] px-4 py-2.5">
                  <div className="text-[9px] font-mono text-[#3a3a5a] uppercase tracking-wider">{a.label}</div>
                  <div className="text-[12px] font-mono font-semibold mt-0.5" style={{ color: a.color }}>{a.val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-14 space-y-20">

          {/* Machine-readable API */}
          <section>
            <SectionHeader label="Risk Disclosure API" title="Machine-readable endpoint" />
            <div className="rounded-2xl border border-[#00d4ff22] bg-[#0c0c1a] overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-[#1a1a2e] bg-[#05050f]">
                <div className="w-2.5 h-2.5 rounded-full bg-[#ff3b5c44]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#f0b42944]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#00ff8844]" />
                <span className="ml-3 text-[10px] font-mono text-[#a5a5a5]">terminal</span>
                <a href="/api/compliance/disclosure" target="_blank" rel="noopener noreferrer"
                   className="ml-auto text-[10px] font-mono text-[#00d4ff] hover:underline">
                  GET /api/compliance/disclosure ↗
                </a>
              </div>
              <div className="px-5 py-4 flex items-center gap-3">
                <code className="flex-1 text-[12px] font-mono text-[#00ff88] break-all">{curlCmd}</code>
                <button
                  onClick={copy}
                  className="shrink-0 text-[10px] font-mono px-3 py-1.5 rounded border border-[#1a1a2e]
                             text-[#a5a5a5] hover:border-[#00d4ff44] hover:text-[#00d4ff] transition-colors"
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <div className="px-5 pb-4 flex flex-wrap gap-3">
                <a href="/api/compliance/disclosure" target="_blank" rel="noopener noreferrer"
                   className="text-[11px] font-mono px-3 py-1.5 rounded border border-[#00d4ff33] bg-[#00d4ff0a]
                              text-[#00d4ff] hover:bg-[#00d4ff14] transition-colors">
                  Full disclosure JSON ↗
                </a>
                <a href="/api/compliance/disclosure?format=summary" target="_blank" rel="noopener noreferrer"
                   className="text-[11px] font-mono px-3 py-1.5 rounded border border-[#1a1a2e]
                              text-[#6b6b8a] hover:border-[#a78bfa44] hover:text-[#a78bfa] transition-colors">
                  Summary format ↗
                </a>
                <a href="/VARA_compliance.md" target="_blank" rel="noopener noreferrer"
                   className="text-[11px] font-mono px-3 py-1.5 rounded border border-[#1a1a2e]
                              text-[#6b6b8a] hover:border-[#f0b42944] hover:text-[#f0b429] transition-colors">
                  Full compliance doc (.md) ↗
                </a>
              </div>
            </div>
          </section>

          {/* Risk Factors */}
          <section>
            <SectionHeader label="Risk Assessment" title="Risk factors" />
            {loading ? (
              <div className="text-[12px] font-mono text-[#3a3a5a] animate-pulse">Loading from API…</div>
            ) : (
              <div className="space-y-3">
                {(data?.riskFactors ?? []).map(rf => {
                  const s = SEVERITY_COLOR[rf.severity] ?? SEVERITY_COLOR.LOW;
                  return (
                    <div key={rf.id}
                         className="rounded-xl border px-5 py-4"
                         style={{ borderColor: s.border, backgroundColor: s.bg }}>
                      <div className="flex items-start gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-[10px] font-mono font-bold tracking-[0.15em] px-2 py-0.5 rounded border"
                                  style={{ color: s.text, borderColor: s.border, backgroundColor: s.bg + "66" }}>
                              {rf.severity}
                            </span>
                            <span className="text-[11px] font-mono text-[#a5a5a5] tracking-wider">{rf.id}</span>
                          </div>
                          <p className="text-[13px] font-mono text-[#c0c0e0] leading-[1.6] mb-2">{rf.description}</p>
                          <div className="flex items-start gap-2">
                            <span className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-wider shrink-0 mt-0.5">Mitigation</span>
                            <p className="text-[12px] font-mono text-[#6b6b8a] leading-[1.55]">{rf.mitigation}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Regulatory Status */}
          <section>
            <SectionHeader label="Jurisdictions" title="Regulatory status by region" />
            <div className="rounded-2xl border border-[#1a1a2e] bg-[#0c0c1a] overflow-hidden">
              {Object.entries(data?.regulatoryStatus ?? {
                uae_vara:  "Protocol likely exempt (non-custodial); front-end operator may require VASP notification under VARA Rulebook V2.0",
                eu_mica:   "Monitoring — DeFi carve-out under MiCA Article 4(3); EC DeFi report expected",
                singapore: "Exempt under MAS PS Act if no Singapore users are actively solicited",
                uk:        "Non-custodial DEXs under FCA review — legal opinion recommended pre-launch",
                usa:       "HIGH RISK — US user access restricted pending SEC/CFTC regulatory clarity",
              }).map(([key, status], i, arr) => {
                const meta = JURISDICTION_META[key];
                const isHighRisk = status.includes("HIGH RISK");
                const isExempt   = status.toLowerCase().includes("exempt");
                const borderColor = isHighRisk ? "#ff3b5c22" : isExempt ? "#00ff8822" : "#1a1a2e";
                const statusColor = isHighRisk ? "#ff3b5c" : isExempt ? "#00ff88" : "#f0b429";
                return (
                  <div key={key}
                       className={`px-5 py-4 ${i < arr.length - 1 ? "border-b" : ""}`}
                       style={{ borderColor }}>
                    <div className="flex items-start gap-4">
                      <span className="text-xl shrink-0 mt-0.5">{meta?.flag ?? "🌐"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-mono font-bold text-[#f1f0f7] mb-1">{meta?.label ?? key}</div>
                        <p className="text-[12px] font-mono leading-[1.6]" style={{ color: statusColor }}>{status}</p>
                      </div>
                      <div className="shrink-0">
                        {isHighRisk
                          ? <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-[#ff3b5c44] bg-[#ff3b5c0a] text-[#ff3b5c] uppercase tracking-wider">High risk</span>
                          : isExempt
                          ? <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-[#00ff8844] bg-[#00ff880a] text-[#00ff88] uppercase tracking-wider">Exempt</span>
                          : <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-[#f0b42944] bg-[#f0b4290a] text-[#f0b429] uppercase tracking-wider">Review</span>
                        }
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* VARA Compliance Details */}
          <section>
            <SectionHeader label="VARA Rulebook V2.0" title="Classification &amp; compliance controls" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

              {/* Classification */}
              <div className="rounded-2xl border border-[#1a1a2e] bg-[#0c0c1a] p-6">
                <div className="text-[10px] font-mono text-[#a5a5a5] uppercase tracking-wider mb-4">Classification</div>
                <div className="space-y-3">
                  {[
                    { label: "Custody of user funds",      ok: false, val: "None — PDA vaults only" },
                    { label: "Counterparty risk",          ok: false, val: "None — trustless settlement" },
                    { label: "Front-running capability",   ok: false, val: "Cryptographically impossible" },
                    { label: "Information privilege",      ok: false, val: "None — sealed until clearing" },
                    { label: "Wash trading profitability", ok: false, val: "Zero — uniform price" },
                    { label: "Native token issuance",      ok: false, val: "No governance token" },
                    { label: "Fiat on/off ramp",           ok: false, val: "None — token-to-token only" },
                  ].map(r => (
                    <div key={r.label} className="flex items-start justify-between gap-3 py-1.5 border-b border-[#1a1a2e]">
                      <span className="text-[11px] font-mono text-[#6b6b8a]">{r.label}</span>
                      <div className="flex items-center gap-1.5 shrink-0 text-right">
                        <span className="text-[11px] font-mono text-[#00ff88]">{r.val}</span>
                        <span className="text-[#00ff88] text-xs">✓</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-lg border border-[#a78bfa33] bg-[#a78bfa0a] px-3 py-2">
                  <div className="text-[10px] font-mono text-[#a78bfa] font-bold mb-0.5">Classification pathway</div>
                  <div className="text-[11px] font-mono text-[#6b6b8a] leading-[1.5]">
                    Non-custodial smart contract protocol — DeFi carve-out under VARA Law No. 4/2022
                  </div>
                </div>
              </div>

              {/* Market Abuse Controls */}
              <div className="rounded-2xl border border-[#1a1a2e] bg-[#0c0c1a] p-6">
                <div className="text-[10px] font-mono text-[#a5a5a5] uppercase tracking-wider mb-4">Market abuse controls</div>
                <div className="space-y-2.5">
                  {(data?.varaCompliance.marketAbuseControls ?? [
                    "SHA-256 commit-reveal: order parameters sealed until after commit window closes",
                    "Walrasian uniform clearing price: all matched orders fill at identical p*",
                    "SlashUnrevealed: 0.001 SOL penalty for unrevealed orders (anti-spoofing)",
                    "Jito private relay: transactions bypass public mempool",
                    "Batch window: intra-block manipulation impossible",
                  ]).map((c, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="text-[#00ff88] mt-0.5 shrink-0 text-xs">✓</span>
                      <span className="text-[12px] font-mono text-[#c0c0e0] leading-[1.55]">{c}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5">
                  <div className="text-[10px] font-mono text-[#a5a5a5] uppercase tracking-wider mb-3">AML mitigations</div>
                  <div className="space-y-2.5">
                    {(data?.varaCompliance.amlMitigations ?? []).map((m, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <span className="text-[#00d4ff] mt-0.5 shrink-0 text-xs">→</span>
                        <span className="text-[12px] font-mono text-[#6b6b8a] leading-[1.55]">{m}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* AI Agent Disclosure */}
          <section>
            <SectionHeader label="Autonomous Agent" title="AI agent disclosure" />
            <div className="rounded-2xl border border-[#00d4ff22] bg-[#0c0c1a] p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                {[
                  { label: "Model",               val: data?.aiAgentDisclosure.model              ?? "Claude Haiku (claude-haiku-4-5)" },
                  { label: "Payment protocol",     val: data?.aiAgentDisclosure.paymentProtocol   ?? "x402 HTTP-native micropayment" },
                  { label: "Order fragmentation",  val: data?.aiAgentDisclosure.orderFragmentation ?? "TWAP with LLM-guided slice count" },
                ].map(f => (
                  <div key={f.label} className="rounded-lg border border-[#1a1a2e] bg-[#05050f] px-4 py-3">
                    <div className="text-[9px] font-mono text-[#3a3a5a] uppercase tracking-wider mb-1">{f.label}</div>
                    <div className="text-[12px] font-mono text-[#00d4ff] leading-[1.5]">{f.val}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-5 mt-5 flex-wrap">
                <div className="flex items-center gap-2">
                  <Pill ok={data?.aiAgentDisclosure.humanOversight ?? true} />
                  <span className="text-[11px] font-mono text-[#6b6b8a]">Human oversight</span>
                </div>
                <div className="flex items-center gap-2">
                  <Pill ok={data?.aiAgentDisclosure.auditTrail ?? true} />
                  <span className="text-[11px] font-mono text-[#6b6b8a]">On-chain audit trail</span>
                </div>
                <div className="flex items-center gap-2">
                  <Pill ok={data?.aiAgentDisclosure.enabled ?? true} />
                  <span className="text-[11px] font-mono text-[#6b6b8a]">Agent enabled</span>
                </div>
              </div>
            </div>
          </section>

          {/* Smart Contract Security */}
          <section>
            <SectionHeader label="Smart Contract" title="Security properties" />
            <div className="rounded-2xl border border-[#1a1a2e] bg-[#0c0c1a] overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-[#1a1a2e] bg-[#05050f]">
                <div className="w-2.5 h-2.5 rounded-full bg-[#ff3b5c44]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#f0b42944]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#00ff8844]" />
                <span className="ml-3 text-[10px] font-mono text-[#a5a5a5]">security.audit</span>
              </div>
              <div className="p-5 space-y-3">
                {[
                  { key: "language",    val: "Rust / Anchor 0.30.1",                                  color: "#a78bfa" },
                  { key: "network",     val: "Solana devnet · Program AW8zeS7…F6iV",                   color: "#00d4ff" },
                  { key: "reentrancy",  val: "Prevented — Solana single-threaded execution",           color: "#00ff88" },
                  { key: "overflow",    val: "Rust checked arithmetic + u64 BN math",                  color: "#00ff88" },
                  { key: "front-run",   val: "Impossible — commit-reveal cryptographic sealing",       color: "#00ff88" },
                  { key: "griefing",    val: "slashUnrevealed — 0.001 SOL penalty, order excluded",   color: "#00ff88" },
                  { key: "vault auth",  val: "Pool PDA controls vault — no admin key",                 color: "#00ff88" },
                  { key: "audit",       val: "Pre-audit (hackathon). Full audit required pre-mainnet", color: "#f0b429" },
                  { key: "upgrade",     val: "Deployer holds authority → recommend Squads multisig",  color: "#f0b429" },
                ].map(r => (
                  <div key={r.key} className="flex gap-3 items-start text-[11px] font-mono">
                    <span className="text-[#a5a5a5] shrink-0 w-20 text-right">{r.key}</span>
                    <span className="text-[#1a1a2e]">→</span>
                    <span style={{ color: r.color }}>{r.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Compliance Roadmap */}
          <section>
            <SectionHeader label="Pre-mainnet" title="Compliance roadmap" />
            <div className="space-y-2">
              {[
                { p: "1", action: "Smart contract audit",               who: "Ottersec / Sec3 / OShield",        when: "Pre-mainnet",   done: false },
                { p: "2", action: "Upgrade authority → Squads multisig + 7d timelock", who: "Protocol team", when: "Pre-mainnet",   done: false },
                { p: "3", action: "Front-end sanctions screening",       who: "Chainalysis / TRM Labs",           when: "Pre-launch",    done: false },
                { p: "4", action: "VARA VASP notification filing",       who: "UAE counsel",                      when: "Pre-launch",    done: false },
                { p: "5", action: "Privacy policy + Terms of Service",   who: "Legal counsel",                    when: "Pre-launch",    done: false },
                { p: "6", action: "Legal opinion on DeFi exemption",     who: "VARA-specialist counsel",           when: "Q3 2026",       done: false },
                { p: "7", action: "Ongoing transaction monitoring",      who: "TRM Labs",                         when: "Post-launch",   done: false },
              ].map(r => (
                <div key={r.p} className="flex items-center gap-4 rounded-xl border border-[#1a1a2e] bg-[#0c0c1a] px-5 py-3">
                  <span className="w-6 h-6 rounded-full bg-[#a78bfa15] border border-[#a78bfa33] flex items-center justify-center
                                   text-[10px] font-mono font-bold text-[#a78bfa] shrink-0">
                    {r.p}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-mono text-[#f1f0f7]">{r.action}</div>
                    <div className="text-[10px] font-mono text-[#3a3a5a] mt-0.5">{r.who}</div>
                  </div>
                  <span className="text-[10px] font-mono text-[#3a3a5a] shrink-0">{r.when}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Comparison to regulated markets */}
          <section>
            <SectionHeader label="Market precedent" title="Analogy to regulated auctions" />
            <div className="rounded-2xl border border-[#1a1a2e] bg-[#0c0c1a] overflow-hidden">
              <div className="grid grid-cols-4 gap-0 text-[11px] font-mono">
                {/* Header */}
                {["Mechanism", "Lattice", "NYSE Opening Auction", "Euronext Batch"].map((h, i) => (
                  <div key={h} className={`px-4 py-3 border-b border-[#1a1a2e] text-[10px] uppercase tracking-wider font-bold ${
                    i === 0 ? "text-[#3a3a5a]" : i === 1 ? "text-[#00ff88]" : "text-[#a5a5a5]"
                  } ${i < 3 ? "border-r border-[#1a1a2e]" : ""}`}>
                    {h}
                  </div>
                ))}
                {/* Rows */}
                {[
                  ["Order visibility pre-settlement", "None", "None", "None"],
                  ["Uniform clearing price",           "✓",    "✓",    "✓"],
                  ["MEV / front-running",              "$0",   "$0",   "$0"],
                  ["Regulatory approval",              "DeFi carve-out", "NYSE / SEC", "AMF / ESMA"],
                ].map((row, ri) => (
                  row.map((cell, ci) => (
                    <div key={`${ri}-${ci}`}
                         className={`px-4 py-3 ${ri < 3 ? "border-b border-[#1a1a2e]" : ""} ${ci < 3 ? "border-r border-[#1a1a2e]" : ""}`}
                         style={{ color: ci === 0 ? "#6b6b8a" : ci === 1 ? "#00ff88" : "#a5a5a5" }}>
                      {cell}
                    </div>
                  ))
                ))}
              </div>
            </div>
          </section>

          {/* Contact + disclaimer */}
          <section className="rounded-2xl border border-[#1a1a2e] bg-[#0c0c1a] p-6">
            <div className="flex items-start justify-between gap-6 flex-wrap mb-4">
              <div>
                <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-wider mb-1">Compliance contact</div>
                <div className="text-[13px] font-mono text-[#00d4ff]">
                  {data?.contactForCompliance ?? "compliance@lattice.xyz"}
                </div>
              </div>
              <div className="flex gap-3 flex-wrap">
                <a href="/api/compliance/disclosure" target="_blank" rel="noopener noreferrer"
                   className="text-[11px] font-mono px-4 py-2 rounded-lg border border-[#00d4ff33] bg-[#00d4ff0a]
                              text-[#00d4ff] hover:bg-[#00d4ff14] transition-colors">
                  Download JSON ↗
                </a>
                <a href="/VARA_compliance.md" target="_blank" rel="noopener noreferrer"
                   className="text-[11px] font-mono px-4 py-2 rounded-lg border border-[#1a1a2e]
                              text-[#6b6b8a] hover:border-[#f0b42944] hover:text-[#f0b429] transition-colors">
                  Download .md ↗
                </a>
              </div>
            </div>
            <p className="text-[11px] font-mono text-[#3a3a5a] leading-[1.7]">
              {data?.legalDisclaimer ??
                "This disclosure is for informational and regulatory review purposes. It does not constitute legal advice. Lattice is experimental software on Solana devnet. Obtain qualified legal counsel before any mainnet deployment."}
            </p>
          </section>

        </div>

        {/* Footer */}
        <div className="border-t border-[#1a1a2e] px-6 py-4 flex items-center justify-between text-[10px] font-mono text-[#3a3a5a] flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Diamond />
            <span>Lattice · Live on Solana Devnet</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/demo" className="hover:text-[#00ff88] transition-colors">Live Demo</Link>
            <a href="/api/compliance/disclosure" target="_blank" rel="noopener noreferrer" className="hover:text-[#00d4ff] transition-colors">Risk Disclosure API</a>
            <a href="https://explorer.solana.com/address/AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV?cluster=devnet"
               target="_blank" rel="noopener noreferrer" className="hover:text-[#a78bfa] transition-colors">Onchain ↗</a>
          </div>
        </div>
      </div>
    </>
  );
}
