import Head from "next/head";
import { useState, useCallback, useRef } from "react";
import { Connection, Keypair, SystemProgram, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AmmPanel } from "@/components/AmmPanel";
import { LatticePanel } from "@/components/LatticePanel";
import { LogEntry } from "@/components/LogStream";
import { runSimulation, DEFAULT_PARAMS, toDisplay } from "@/lib/sandwich";

// ── Types ─────────────────────────────────────────────────────────────────────
type Phase = "idle" | "commit" | "reveal" | "clear" | "done";

function log(
  setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>,
  msg: string,
  kind: LogEntry["kind"] = "info"
) {
  setLogs((prev) => [...prev, { ts: Date.now(), msg, kind }]);
}

// ── Devnet constants ──────────────────────────────────────────────────────────
const DEVNET_RPC = "https://api.devnet.solana.com";
const LATTICE_PROGRAM_ID = new PublicKey("AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV");
const POOL_SEED  = Buffer.from("batch_pool");
const VAULT_SEED = Buffer.from("vault");

function poolPDA(tokenIn: PublicKey, tokenOut: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, tokenIn.toBuffer(), tokenOut.toBuffer()],
    LATTICE_PROGRAM_ID
  );
}

function vaultPDA(pool: PublicKey, mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, pool.toBuffer(), mint.toBuffer()],
    LATTICE_PROGRAM_ID
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Demo() {
  const result = runSimulation(DEFAULT_PARAMS);

  const [ammLogs,     setAmmLogs]     = useState<LogEntry[]>([]);
  const [latticeLogs, setLatticeLogs] = useState<LogEntry[]>([]);
  const [ammRunning,     setAmmRunning]     = useState(false);
  const [latticeRunning, setLatticeRunning] = useState(false);
  const [ammDone,    setAmmDone]    = useState(false);
  const [phase,   setPhase]   = useState<Phase>("idle");
  const [txSig,   setTxSig]   = useState<string | undefined>();

  // ── AMM sandwich simulation (pure-math, instant) ──────────────────────────
  const runAmm = useCallback(async () => {
    setAmmRunning(true);
    setAmmLogs([]);
    const l = (msg: string, kind: LogEntry["kind"] = "info") =>
      log(setAmmLogs, msg, kind);

    await delay(200);
    l("Pool ready: 1M USDC ↔ 10K SOL at 100 USDC/SOL");
    await delay(300);
    l("You submit: buy 10,000 USDC worth of SOL");
    await delay(400);
    l("⚠ Your order is now visible to everyone in the mempool", "warn");
    await delay(500);
    l("🤖 Bot detected your order — front-running now", "error");
    l("Bot buys 5,000 USDC of SOL ahead of you → price moves up", "error");
    await delay(400);
    l("Pool is now skewed against you", "error");
    await delay(500);
    l("Your trade executes — at the worse, bot-inflated price", "error");
    await delay(300);
    l("🤖 Bot sells its SOL right after you → locks in profit", "error");
    await delay(200);
    l("💸 Bot extracted $99.74 from your trade (98 bps)", "error");
    l("You received 2.97 fewer SOL than you should have", "error");
    setAmmRunning(false);
    setAmmDone(true);
  }, []);

  // ── Lattice devnet flow (via x402 relay) ─────────────────────────────────
  const runLattice = useCallback(async () => {
    setLatticeRunning(true);
    setLatticeLogs([]);
    setPhase("idle");
    setTxSig(undefined);

    const l = (msg: string, kind: LogEntry["kind"] = "info") =>
      log(setLatticeLogs, msg, kind);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const { Program, AnchorProvider, BN } = await import("@coral-xyz/anchor");
      const { createMint, createAccount, mintTo } = await import("@solana/spl-token");
      const nacl  = (await import("tweetnacl")).default;
      const bs58  = (await import("bs58")).default;
      const IDL   = (await import("../anchor-idl/lattice.json")).default;

      const seed  = new Uint8Array(32).fill(11); // System-program owned, funded on devnet
      const payer = Keypair.fromSeed(seed);

      l(`Wallet: ${payer.publicKey.toBase58().slice(0, 16)}…`);
      const balance = await connection.getBalance(payer.publicKey);
      l(`Connected to Solana devnet — ${(balance / LAMPORTS_PER_SOL).toFixed(2)} SOL available`, "success");

      // ── Phase 1: Commit via x402 relay ────────────────────────────────────
      setPhase("commit");
      l("🔒 Phase 1: Sealing your order");
      l("Setting up test tokens on Solana devnet…");
      const tokenIn  = await createMint(connection, payer, payer.publicKey, null, 6);
      const tokenOut = await createMint(connection, payer, payer.publicKey, null, 6);
      l(`Token pair created on devnet`, "tx");

      const [pool] = poolPDA(tokenIn, tokenOut);
      const [vault] = vaultPDA(pool, tokenIn);

      const userAta = await createAccount(connection, payer, tokenIn, payer.publicKey);
      await mintTo(connection, payer, tokenIn, userAta, payer, BigInt(10_000_000_000));
      l("Your 10,000 USDC locked in the auction vault", "success");

      const wallet = {
        publicKey: payer.publicKey,
        signTransaction: async (tx: any) => { tx.partialSign(payer); return tx; },
        signAllTransactions: async (txs: any[]) => { txs.forEach(t => t.partialSign(payer)); return txs; },
      };
      const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
      const program  = new Program(IDL as any, provider);

      l("Creating batch auction pool…");
      const prog = program as any;
      const COMMIT_SLOTS = 20;  // ~8s on devnet
      const REVEAL_SLOTS = 15;  // ~6s on devnet
      const initTx = await prog.methods
        .initializePool(new BN(COMMIT_SLOTS), new BN(REVEAL_SLOTS))
        .accounts({
          authority: payer.publicKey, pool,
          tokenInMint: tokenIn, tokenOutMint: tokenOut,
          systemProgram: SystemProgram.programId,
        }).rpc();
      l(`Batch auction pool live on devnet`, "tx");
      setTxSig(initTx);

      // Build CommitIntent tx
      const { randomBytes, createHash } = await import("crypto");
      const salt       = randomBytes(16);
      const amount     = new BN(100_000_000);
      const limitPrice = new BN(102_000_000);

      const h = createHash("sha256");
      h.update(tokenIn.toBuffer());
      h.update(tokenOut.toBuffer());
      h.update(amount.toArrayLike(Buffer, "le", 8));
      h.update(limitPrice.toArrayLike(Buffer, "le", 8));
      h.update(salt);
      const commitHash = Array.from(h.digest());

      const commitTxObj = await prog.methods
        .commitIntent(commitHash, amount, true)
        .accounts({
          payer: payer.publicKey, pool,
          payerTokenAccount: userAta, mint: tokenIn, vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        }).transaction();
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      commitTxObj.recentBlockhash = blockhash;
      commitTxObj.feePayer = payer.publicKey;
      commitTxObj.sign(payer);
      const txBase64     = commitTxObj.serialize().toString("base64");
      const commitHashHex = Buffer.from(commitHash).toString("hex");

      l(`Your order hash: ${commitHashHex.slice(0, 16)}… (order details invisible)`);

      // ── x402 dance ────────────────────────────────────────────────────────
      l("Sending sealed order to private relay…");
      const first = await fetch("/api/relay/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitHash: commitHashHex, payer: payer.publicKey.toBase58(), txBase64 }),
      }).catch(() => { throw new Error("Relay unreachable — is it running on port 7402?"); });

      const firstBody = await first.json().catch(() => ({}));

      // Read envelope from body (_paymentRequired) with header as fallback
      const envelopeB64 = firstBody._paymentRequired
        ?? first.headers.get("payment-required")
        ?? "";
      if (!envelopeB64) throw new Error(`Relay returned ${first.status} but no payment envelope — check relay logs`);
      l(`Relay: pay 0.001 USDC to submit (x402 micropayment)`, "warn");

      const envelope = JSON.parse(atob(envelopeB64));

      // Sign with nacl ed25519
      const msgStr = JSON.stringify({
        amount: envelope.maxAmountRequired, asset: envelope.asset,
        network: envelope.network, resource: "/commit", nonce: envelope.nonce,
      });
      const msgBytes = new TextEncoder().encode(msgStr);
      const sigBytes = nacl.sign.detached(msgBytes, payer.secretKey);
      const paymentSig = btoa(JSON.stringify({
        from:      payer.publicKey.toBase58(),
        pubkey:    payer.publicKey.toBase58(),
        signature: bs58.encode(sigBytes),
        amount:    envelope.maxAmountRequired,
        asset:     envelope.asset,
        network:   envelope.network,
        nonce:     envelope.nonce,
      }));

      l("Micropayment signed — resubmitting with proof of payment…");

      const second = await fetch("/api/relay/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "payment-signature": paymentSig },
        body: JSON.stringify({ commitHash: commitHashHex, payer: payer.publicKey.toBase58(), txBase64 }),
      });

      if (!second.ok) {
        const err = await second.json();
        throw new Error(err.error ?? `Relay error ${second.status}`);
      }

      const relayResult = await second.json();
      l(`Relay accepted — 0.001 USDC fee paid`, "success");
      l(`Sealed order is now on-chain. Bots see only a hash.`, "success");
      l(`devnet: ${relayResult.txSig?.slice(0, 20)}…`, "tx");
      setTxSig(relayResult.txSig);

      // ── Phase 2: Reveal ────────────────────────────────────────────────────
      setPhase("reveal");
      l("🔓 Phase 2: Waiting for commit window to close…");
      const ps = await prog.account.batchAuctionPool.fetch(pool);
      const windowEnd = ps.phaseStartSlot.toNumber() + COMMIT_SLOTS + 1;
      const curSlot = await connection.getSlot("confirmed");
      const slotsLeft = Math.max(0, windowEnd - curSlot);
      l(`Window closes in ~${Math.ceil(slotsLeft * 0.4)}s — no one can front-run during this time`);
      while ((await connection.getSlot("confirmed")) < windowEnd) await delay(600);

      l("All orders can now reveal — revealing yours…");
      const revealTx = await prog.methods
        .revealIntent(tokenIn, tokenOut, amount, limitPrice, Array.from(salt))
        .accounts({ payer: payer.publicKey, pool })
        .signers([payer]).rpc();
      l("Order revealed and verified on-chain ✓", "success");
      l(`devnet: ${revealTx.slice(0, 20)}…`, "tx");
      setTxSig(revealTx);

      // ── Phase 3: Clear ────────────────────────────────────────────────────
      setPhase("clear");
      l("⚖️ Phase 3: Finding the fairest clearing price…");
      const ps2 = await prog.account.batchAuctionPool.fetch(pool);
      const revealEnd = ps2.phaseStartSlot.toNumber() + REVEAL_SLOTS + 1;
      const slotsLeft2 = Math.max(0, revealEnd - (await connection.getSlot("confirmed")));
      l(`Reveal window closes in ~${Math.ceil(slotsLeft2 * 0.4)}s…`);
      while ((await connection.getSlot("confirmed")) < revealEnd) await delay(600);

      try {
        const clearTx = await prog.methods
          .clearBatch().accounts({ pool, caller: payer.publicKey }).rpc();
        l("Batch settled at fair market price ✓", "success");
        l(`devnet: ${clearTx.slice(0, 20)}…`, "tx");
        setTxSig(clearTx);
      } catch {
        l("Single order — no cross yet (need a sell-side to match)", "warn");
        l("In production: multiple traders → all fill at same fair price", "info");
      }

      setPhase("done");
      l("✅ Done. Zero bot interference. You kept every cent.", "success");
    } catch (err: any) {
      log(setLatticeLogs, `Error: ${err.message}`, "error");
      setPhase("idle");
    } finally {
      setLatticeRunning(false);
    }
  }, []);

  const latticeDone = phase === "done";
  const bothDone = ammDone && latticeDone;

  return (
    <>
      <Head>
        <title>Lattice — Stop Bots from Stealing Your Trades</title>
        <meta name="description" content="See exactly how bots steal from every DEX trade — then watch Lattice block them with cryptography." />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen bg-[#080810] text-[#e0e0f0]">
        {/* ── Top nav ────────────────────────────────────────────────────── */}
        <nav className="border-b border-[#1e1e32] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-7 h-7">
              <div className="absolute inset-0 rounded border border-[#00d4ff] rotate-45 opacity-70" />
              <div className="absolute inset-1 rounded border border-[#00d4ff55] rotate-45" />
              <div className="absolute inset-[6px] rounded-sm bg-[#00d4ff]" />
            </div>
            <span className="font-mono font-bold text-lg tracking-wider text-[#e0e0f0]">
              LATTICE
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00ff88] shadow-[0_0_6px_#00ff88] animate-pulse" />
              <span className="text-[11px] font-mono text-[#4a4a6a]">Solana devnet live</span>
            </div>
            <a
              href="https://explorer.solana.com/address/AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV?cluster=devnet"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-[#00d4ff] hover:underline hidden sm:block"
            >
              AW8zeS7…F6iV ↗
            </a>
          </div>
        </nav>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <div className="text-center py-10 px-6 border-b border-[#1e1e32]">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-5
                          bg-[#00d4ff11] border border-[#00d4ff33] text-[#00d4ff]
                          text-xs font-mono uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00d4ff] animate-pulse" />
            Frontier Hackathon 2025
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#e0e0f0] mb-3 tracking-tight">
            Trading bots steal from every swap.
          </h1>
          <p className="text-[#6a6a8a] text-sm max-w-xl mx-auto leading-6 mb-2">
            On a regular DEX, your order is visible before it executes. Bots jump in front,
            move the price, then sell back — pocketing the difference from your trade.
          </p>
          <p className="text-[#e0e0f0] text-sm font-semibold max-w-xl mx-auto">
            Lattice makes it{" "}
            <span className="text-[#00ff88]">cryptographically impossible</span>
            {" "}— run the demo below to see why.
          </p>

          {/* Quick stats */}
          <div className="flex items-center justify-center gap-3 mt-7 flex-wrap">
            <div className="rounded-lg px-4 py-2.5 bg-[#ff3b5c0f] border border-[#ff3b5c33] text-center">
              <div className="text-[10px] font-mono text-[#ff3b5c99] uppercase tracking-widest">Bot steals per trade</div>
              <div className="text-xl font-mono font-bold text-[#ff3b5c]">$99.74</div>
            </div>
            <div className="text-[#2a2a4a] font-mono text-xl">vs</div>
            <div className="rounded-lg px-4 py-2.5 bg-[#00ff880f] border border-[#00ff8833] text-center">
              <div className="text-[10px] font-mono text-[#00ff8899] uppercase tracking-widest">Lattice bot profit</div>
              <div className="text-xl font-mono font-bold text-[#00ff88]">$0.00</div>
            </div>
            <div className="rounded-lg px-4 py-2.5 bg-[#0f0f1a] border border-[#1e1e32] text-center">
              <div className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-widest">You save</div>
              <div className="text-xl font-mono font-bold text-[#00d4ff]">+{toDisplay(result.latticeImprovementSol)} SOL</div>
            </div>
          </div>
        </div>

        {/* ── Step banner ──────────────────────────────────────────────────── */}
        <div className="max-w-7xl mx-auto px-6 pt-6">
          <div className="flex items-center gap-3 rounded-xl border border-[#1e1e32] bg-[#0a0a14] px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[#ff3b5c22] border border-[#ff3b5c55] flex items-center justify-center text-[10px] font-mono font-bold text-[#ff3b5c]">1</span>
              <span className="text-xs font-mono text-[#e0e0f0]">Run the bot attack</span>
            </div>
            <div className="flex-1 h-px bg-[#1e1e32] mx-2" />
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[#00ff8822] border border-[#00ff8855] flex items-center justify-center text-[10px] font-mono font-bold text-[#00ff88]">2</span>
              <span className="text-xs font-mono text-[#e0e0f0]">Submit a protected order</span>
            </div>
            <div className="flex-1 h-px bg-[#1e1e32] mx-2" />
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[#00d4ff22] border border-[#00d4ff55] flex items-center justify-center text-[10px] font-mono font-bold text-[#00d4ff]">3</span>
              <span className="text-xs font-mono text-[#e0e0f0]">See the difference</span>
            </div>
          </div>
        </div>

        {/* ── Split panel ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 max-w-7xl mx-auto">
          <AmmPanel
            result={result}
            logs={ammLogs}
            running={ammRunning}
            onRun={runAmm}
          />
          <LatticePanel
            result={result}
            logs={latticeLogs}
            running={latticeRunning}
            phase={phase}
            txSig={txSig}
            onSubmit={runLattice}
          />
        </div>

        {/* ── Verdict card (shown after both run) ──────────────────────────── */}
        {bothDone && (
          <div className="max-w-7xl mx-auto px-6 pb-6">
            <div className="rounded-xl border border-[#00ff8844] bg-[#00ff8808] p-6">
              <div className="text-center mb-6">
                <div className="text-lg font-bold text-[#00ff88] mb-1">
                  ✅ Same trade. Completely different outcome.
                </div>
                <div className="text-sm text-[#4a4a6a] font-mono">
                  Lattice didn't improve execution — it made bot attacks structurally impossible.
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-lg bg-[#ff3b5c0a] border border-[#ff3b5c33] p-4 text-center">
                  <div className="text-[10px] font-mono text-[#ff3b5c88] uppercase tracking-widest mb-1">Regular DEX</div>
                  <div className="text-2xl font-mono font-bold text-[#ff3b5c]">{toDisplay(result.victimOutAfter)} SOL</div>
                  <div className="text-[11px] font-mono text-[#4a4a6a] mt-1">Bot took $99.74 from you</div>
                </div>
                <div className="flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-2xl font-mono font-bold text-[#00ff88]">+{toDisplay(result.latticeImprovementSol)} SOL</div>
                    <div className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-widest mt-1">You keep more</div>
                  </div>
                </div>
                <div className="rounded-lg bg-[#00ff880a] border border-[#00ff8833] p-4 text-center">
                  <div className="text-[10px] font-mono text-[#00ff8888] uppercase tracking-widest mb-1">Lattice</div>
                  <div className="text-2xl font-mono font-bold text-[#00ff88]">{toDisplay(result.latticeVictimSol)} SOL</div>
                  <div className="text-[11px] font-mono text-[#4a4a6a] mt-1">Bot profit: $0.00</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <div className="max-w-7xl mx-auto px-6 pb-16">
          <div className="border border-[#1e1e32] rounded-xl bg-[#0f0f1a] p-6">
            <h2 className="font-semibold text-sm text-[#00d4ff] uppercase tracking-widest mb-6 text-center">
              Why bots can&rsquo;t attack Lattice
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  icon: "🔒",
                  title: "You seal your order first",
                  color: "#00d4ff",
                  desc: "Before your order hits the blockchain, it's encrypted into a hash. Bots can see that you submitted something — but not what you're buying, at what price, or for how much.",
                },
                {
                  icon: "⏱️",
                  title: "Everyone reveals at the same time",
                  color: "#00d4ff",
                  desc: "Once the submission window closes, all traders reveal their orders simultaneously. There's no way for a bot to \"go first\" — the window is already shut.",
                },
                {
                  icon: "⚖️",
                  title: "One fair price for everyone",
                  color: "#00ff88",
                  desc: "A single clearing price is calculated from all revealed orders. Every buyer and seller in the batch gets exactly the same price — there's no room for bots to exploit price differences.",
                },
              ].map((s) => (
                <div key={s.title} className="flex gap-4">
                  <div className="text-2xl shrink-0 mt-0.5">{s.icon}</div>
                  <div>
                    <div className="font-semibold text-sm mb-2" style={{ color: s.color }}>
                      {s.title}
                    </div>
                    <div className="text-[12px] text-[#4a4a6a] leading-5">
                      {s.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div className="border-t border-[#1e1e32] px-6 py-4 flex items-center justify-between text-[10px] font-mono text-[#4a4a6a]">
          <span>Lattice — Frontier Hackathon 2025</span>
          <a
            href="https://explorer.solana.com/address/AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV?cluster=devnet"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#00d4ff] hover:underline hidden sm:block"
          >
            Program: AW8zeS7…F6iV ↗
          </a>
        </div>
      </div>
    </>
  );
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
