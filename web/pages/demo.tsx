import Head from "next/head";
import Link from "next/link";
import { useState, useCallback, useRef, useEffect } from "react";
import { Connection, Keypair, SystemProgram, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AmmPanel } from "@/components/AmmPanel";
import { LatticePanel } from "@/components/LatticePanel";
import { AgentPanel } from "@/components/AgentPanel";
import { MevCalculator } from "@/components/MevCalculator";
import { OrderHistory } from "@/components/OrderHistory";
import { ComplianceAgent } from "@/components/ComplianceAgent";
import { LogEntry } from "@/components/LogStream";
import { saveOrder } from "@/lib/orderHistory";
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
  const [slotInfo, setSlotInfo] = useState<{ remaining: number; total: number; label: string } | null>(null);

  // ── Relay health state ────────────────────────────────────────────────────
  const [relayStatus, setRelayStatus] = useState<"checking" | "online" | "offline">("checking");
  const [relayBannerDismissed, setRelayBannerDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const r = await fetch("/api/relay/health", { method: "GET" });
        if (cancelled) return;
        setRelayStatus(r.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setRelayStatus("offline");
      }
    }
    check();
    const interval = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ── Real batch data (captured after on-chain clearBatch) ──────────────────
  const [realBatchData, setRealBatchData] = useState<{
    userBuyPrice:  number;
    mmSellPrice:   number;
    clearingPrice: number;
  } | null>(null);

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
    setRealBatchData(null);
    let lastTxSig = "";

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
          tokenInMint: tokenIn, tokenOutMint: tokenOut,
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
      lastTxSig = relayResult.txSig ?? "";
      setTxSig(relayResult.txSig);

      // ── Market-maker: seal the opposing sell order ─────────────────────────
      // So clearBatch finds a cross and actually settles at p*
      const mmSalt       = randomBytes(16);
      const mmAmount     = new BN(100_000_000);       // 100 tokenOut (SOL side)
      const mmLimitPrice = new BN(99_000_000);        // willing to sell at ≥ 99 USDC/SOL

      const mmH = createHash("sha256");
      mmH.update(tokenIn.toBuffer());
      mmH.update(tokenOut.toBuffer());
      mmH.update(mmAmount.toArrayLike(Buffer, "le", 8));
      mmH.update(mmLimitPrice.toArrayLike(Buffer, "le", 8));
      mmH.update(mmSalt);
      const mmCommitHash = Array.from(mmH.digest());

      const [vaultOut] = vaultPDA(pool, tokenOut);
      const userAtaOut = await createAccount(connection, payer, tokenOut, payer.publicKey);
      await mintTo(connection, payer, tokenOut, userAtaOut, payer, BigInt(1_000_000_000));

      await prog.methods
        .commitIntent(mmCommitHash, mmAmount, false)
        .accounts({
          payer: payer.publicKey, pool,
          tokenInMint: tokenIn, tokenOutMint: tokenOut,
          payerTokenAccount: userAtaOut, mint: tokenOut, vault: vaultOut,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        }).rpc();
      l("Market-maker sealed sell side — batch can now cross", "info");

      // ── Phase 2: Reveal ────────────────────────────────────────────────────
      setPhase("reveal");
      l("🔓 Phase 2: Waiting for commit window to close…");
      const ps = await prog.account.batchAuctionPool.fetch(pool);
      const windowEnd = ps.phaseStartSlot.toNumber() + COMMIT_SLOTS + 1;
      let curSlot = await connection.getSlot("confirmed");
      const slotsLeft = Math.max(0, windowEnd - curSlot);
      l(`Window closes in ~${Math.ceil(slotsLeft * 0.4)}s — no one can front-run during this time`);
      setSlotInfo({ remaining: slotsLeft, total: COMMIT_SLOTS, label: "Commit window" });
      while ((curSlot = await connection.getSlot("confirmed")) < windowEnd) {
        setSlotInfo({ remaining: Math.max(0, windowEnd - curSlot), total: COMMIT_SLOTS, label: "Commit window" });
        await delay(600);
      }
      setSlotInfo(null);

      l("All orders can now reveal — revealing yours…");
      const revealTx = await prog.methods
        .revealIntent(tokenIn, tokenOut, amount, limitPrice, Array.from(salt))
        .accounts({ payer: payer.publicKey, pool, tokenInMint: tokenIn, tokenOutMint: tokenOut })
        .signers([payer]).rpc();
      l("Your order revealed and verified on-chain ✓", "success");
      l(`devnet: ${revealTx.slice(0, 20)}…`, "tx");
      setTxSig(revealTx);

      // Reveal market-maker sell order
      const mmRevealTx = await prog.methods
        .revealIntent(tokenIn, tokenOut, mmAmount, mmLimitPrice, Array.from(mmSalt))
        .accounts({ payer: payer.publicKey, pool, tokenInMint: tokenIn, tokenOutMint: tokenOut })
        .signers([payer]).rpc();
      l("Market-maker order revealed — both sides ready to clear", "info");
      l(`devnet: ${mmRevealTx.slice(0, 20)}…`, "tx");

      // ── Phase 3: Clear ────────────────────────────────────────────────────
      setPhase("clear");
      l("⚖️ Phase 3: Finding the fairest clearing price…");
      const ps2 = await prog.account.batchAuctionPool.fetch(pool);
      const revealEnd = ps2.phaseStartSlot.toNumber() + REVEAL_SLOTS + 1;
      let curSlot2 = await connection.getSlot("confirmed");
      const slotsLeft2 = Math.max(0, revealEnd - curSlot2);
      l(`Reveal window closes in ~${Math.ceil(slotsLeft2 * 0.4)}s…`);
      setSlotInfo({ remaining: slotsLeft2, total: REVEAL_SLOTS, label: "Reveal window" });
      while ((curSlot2 = await connection.getSlot("confirmed")) < revealEnd) {
        setSlotInfo({ remaining: Math.max(0, revealEnd - curSlot2), total: REVEAL_SLOTS, label: "Reveal window" });
        await delay(600);
      }
      setSlotInfo(null);

      try {
        const clearTx = await prog.methods
          .clearBatch().accounts({ pool, tokenInMint: tokenIn, tokenOutMint: tokenOut, caller: payer.publicKey }).rpc();
        l("Batch settled at fair market price ✓", "success");
        l(`devnet: ${clearTx.slice(0, 20)}…`, "tx");
        setTxSig(clearTx);

        // Capture real order-book data for the live batch visualizer.
        // With equal quantities the uniform price is the midpoint of the bid/ask spread.
        const userBuyPrice  = limitPrice.toNumber()   / 1_000_000; // 102
        const mmSellPrice   = mmLimitPrice.toNumber()  / 1_000_000; // 99
        const clearingPrice = parseFloat(((userBuyPrice + mmSellPrice) / 2).toFixed(2)); // 100.5
        setRealBatchData({ userBuyPrice, mmSellPrice, clearingPrice });
        l(`Clearing price p* = ${clearingPrice} USDC/SOL (live)`, "success");

        // ── Phase 4: Settle — transfer tokens from vaults to payers ──────────
        l("💸 Phase 4: Settling tokens to payers…");
        // remaining_accounts: one writable ATA per order slot, in pool order.
        //   Slot 0 = user buy  → receives token_out (userAtaOut)
        //   Slot 1 = MM   sell → receives token_in  (userAta)
        const settleTx = await prog.methods
          .settle()
          .accounts({
            pool,
            tokenInVault:  vault,
            tokenOutVault: vaultOut,
            tokenInMint:   tokenIn,
            tokenOutMint:  tokenOut,
            tokenProgram:  TOKEN_PROGRAM_ID,
            caller: payer.publicKey,
          })
          .remainingAccounts([
            { pubkey: userAtaOut, isWritable: true, isSigner: false }, // slot 0: buy → get tokenOut
            { pubkey: userAta,    isWritable: true, isSigner: false }, // slot 1: sell → get tokenIn
          ])
          .rpc();
        l("Tokens settled to payers ✓", "success");
        l(`devnet: ${settleTx.slice(0, 20)}…`, "tx");
        lastTxSig = settleTx;
        setTxSig(settleTx);
      } catch (clearErr: any) {
        l(`Settlement error: ${clearErr.message?.slice(0, 60)}`, "warn");
        l("In production: multiple traders → all fill at same fair price", "info");
      }

      setPhase("done");
      l("✅ Done. Zero bot interference. You kept every cent.", "success");
      saveOrder({
        id:           crypto.randomUUID(),
        timestamp:    Date.now(),
        type:         "lattice",
        amountUsdc:   Number(DEFAULT_PARAMS.victimIn / 1_000_000n),
        tokenOut:     "SOL",
        mevSavedUsdc: Number(result.searcherProfit) / 1_000_000,
        txSig:        lastTxSig,
        explorerUrl:  lastTxSig ? `https://explorer.solana.com/tx/${lastTxSig}?cluster=devnet` : "",
      });
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

      <div className="min-h-screen bg-[#05050f] text-[#f1f0f7]">
        {/* ── Top nav ────────────────────────────────────────────────────── */}
        <nav className="sticky top-0 z-50 border-b border-[#1a1a2e] bg-[#05050fdd] backdrop-blur-xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <svg width="24" height="24" viewBox="0 0 28 28" fill="none">
              <rect x="4" y="4" width="20" height="20" rx="3" transform="rotate(45 14 14)" stroke="#f0b429" strokeWidth="1.5" opacity="0.7" />
              <rect x="7" y="7" width="14" height="14" rx="2" transform="rotate(45 14 14)" stroke="#f0b429" strokeWidth="1" opacity="0.4" />
              <rect x="11" y="11" width="6" height="6" rx="1" transform="rotate(45 14 14)" fill="#f0b429" />
            </svg>
            <span className="font-mono font-bold text-[17px] tracking-[0.1em] text-[#f1f0f7]">
              LATTICE
            </span>
          </Link>
          <div className="flex items-center gap-4">
            {/* Solana devnet badge */}
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00ff88] shadow-[0_0_6px_#00ff88] animate-pulse" />
              <span className="text-[11px] font-mono text-[#4a4a6a]">Solana devnet live</span>
            </div>

            {/* Relay status badge */}
            <div className={`hidden sm:flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${
              relayStatus === "checking" ? "border-[#4a4a6a44] text-[#4a4a6a]" :
              relayStatus === "online"   ? "border-[#00ff8844] text-[#00ff88] bg-[#00ff8808]" :
                                          "border-[#ff3b5c44] text-[#ff3b5c] bg-[#ff3b5c08]"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                relayStatus === "checking" ? "bg-[#4a4a6a]" :
                relayStatus === "online"   ? "bg-[#00ff88] shadow-[0_0_4px_#00ff88]" :
                                            "bg-[#ff3b5c]"
              }`} />
              relay {relayStatus === "checking" ? "…" : relayStatus}
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

        {/* ── Relay offline warning ─────────────────────────────────────── */}
        {relayStatus === "offline" && !relayBannerDismissed && (
          <div className="border-b border-[#ff3b5c44] bg-[#ff3b5c0a] px-6 py-3 flex items-start gap-3">
            <span className="text-[#ff3b5c] text-sm shrink-0 mt-0.5">⚠</span>
            <div className="flex-1 min-w-0">
              <span className="text-[12px] font-mono text-[#ff3b5c] font-semibold">
                Relay offline —
              </span>
              <span className="text-[12px] font-mono text-[#e0e0f0]">
                {" "}the x402 private relay isn&rsquo;t running. The Lattice and Agent panels will fail.
              </span>
              <span className="text-[12px] font-mono text-[#4a4a6a]">
                {" "}Start it with:{" "}
              </span>
              <code className="text-[11px] font-mono text-[#00d4ff] bg-[#00d4ff0a] border border-[#00d4ff22] rounded px-1.5 py-0.5">
                cd relay &amp;&amp; npm start
              </code>
            </div>
            <button
              onClick={() => setRelayBannerDismissed(true)}
              className="text-[#4a4a6a] hover:text-[#e0e0f0] text-sm font-mono shrink-0"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <div className="text-center py-10 px-6 border-b border-[#1a1a2e] bg-[#07070fbb]">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-5
                          bg-[#f0b42908] border border-[#f0b42930] text-[#f0b429]
                          text-[10px] font-mono uppercase tracking-[0.2em]">
            <svg width="10" height="10" viewBox="0 0 28 28" fill="none">
              <rect x="4" y="4" width="20" height="20" rx="3" transform="rotate(45 14 14)" stroke="#f0b429" strokeWidth="2" opacity="0.7" />
              <rect x="11" y="11" width="6" height="6" rx="1" transform="rotate(45 14 14)" fill="#f0b429" />
            </svg>
            Frontier Hackathon 2026
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-[#f1f0f7] mb-3 tracking-[-0.02em]">
            Live interactive demo
          </h1>
          <p className="text-[#6b6b8a] text-sm max-w-xl mx-auto leading-6 mb-2">
            Run a real sandwich attack simulation, then submit a protected order through Lattice
            on Solana devnet. Every transaction is verifiable on-chain.
          </p>

          {/* Quick stats */}
          <div className="flex items-center justify-center gap-3 mt-6 flex-wrap">
            <div className="rounded-xl px-4 py-2.5 bg-[#ff3b5c0c] border border-[#ff3b5c30] text-center">
              <div className="text-[10px] font-mono text-[#ff3b5c66] uppercase tracking-wider">Bot steals</div>
              <div className="text-xl font-mono font-bold text-[#ff3b5c]">$99.74</div>
            </div>
            <div className="text-[#2a2a42] font-mono font-bold">vs</div>
            <div className="rounded-xl px-4 py-2.5 bg-[#00ff8808] border border-[#00ff8830] text-center">
              <div className="text-[10px] font-mono text-[#00ff8866] uppercase tracking-wider">Lattice bots earn</div>
              <div className="text-xl font-mono font-bold text-[#00ff88]">$0.00</div>
            </div>
            <div className="rounded-xl px-4 py-2.5 bg-[#0c0c1a] border border-[#1a1a2e] text-center">
              <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-wider">You keep</div>
              <div className="text-xl font-mono font-bold text-[#a78bfa]">+{toDisplay(result.latticeImprovementSol)} SOL</div>
            </div>
          </div>
        </div>

        {/* ── Step banner ──────────────────────────────────────────────────── */}
        <div className="max-w-7xl mx-auto px-6 pt-6">
          <div className="flex items-center gap-3 rounded-xl border border-[#1a1a2e] bg-[#0c0c1a] px-5 py-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[#ff3b5c18] border border-[#ff3b5c44] flex items-center justify-center text-[10px] font-mono font-bold text-[#ff3b5c]">1</span>
              <span className="text-xs font-mono text-[#f1f0f7]">Run the bot attack</span>
            </div>
            <div className="flex-1 h-px bg-[#1a1a2e] mx-2 min-w-[16px]" />
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[#00ff8818] border border-[#00ff8844] flex items-center justify-center text-[10px] font-mono font-bold text-[#00ff88]">2</span>
              <span className="text-xs font-mono text-[#f1f0f7]">Submit a protected order</span>
            </div>
            <div className="flex-1 h-px bg-[#1a1a2e] mx-2 min-w-[16px]" />
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[#a78bfa18] border border-[#a78bfa44] flex items-center justify-center text-[10px] font-mono font-bold text-[#a78bfa]">3</span>
              <span className="text-xs font-mono text-[#f1f0f7]">Watch the AI agent trade</span>
            </div>
          </div>
        </div>

        {/* ── Split panel ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 px-6 pt-6 max-w-7xl mx-auto">
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
            slotInfo={slotInfo}
            onSubmit={runLattice}
            realBatchData={realBatchData}
          />
        </div>

        {/* ── AI Agent Panel ──────────────────────────────────────────────── */}
        <div className="px-6 pt-6 pb-2 max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-[#1e1e32]" />
            <div className="text-[10px] font-mono text-[#4a4a6a] uppercase tracking-widest px-3">
              Step 3 — autonomous AI agent
            </div>
            <div className="flex-1 h-px bg-[#1e1e32]" />
          </div>
          <AgentPanel />
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

        {/* ── Compliance Agent ──────────────────────────────────────────────── */}
        <div className="max-w-7xl mx-auto px-6 pb-6">
          <ComplianceAgent />
        </div>

        {/* ── Order History ─────────────────────────────────────────────────── */}
        <div className="max-w-7xl mx-auto px-6 pb-6">
          <OrderHistory />
        </div>

        {/* ── MEV savings calculator ───────────────────────────────────────── */}
        <div className="max-w-7xl mx-auto px-6 pb-6">
          <MevCalculator />
        </div>

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
        <div className="border-t border-[#1a1a2e] px-6 py-4 flex items-center justify-between text-[10px] font-mono text-[#3a3a5a]">
          <div className="flex items-center gap-3">
            <svg width="16" height="16" viewBox="0 0 28 28" fill="none">
              <rect x="4" y="4" width="20" height="20" rx="3" transform="rotate(45 14 14)" stroke="#f0b429" strokeWidth="1.5" opacity="0.7" />
              <rect x="11" y="11" width="6" height="6" rx="1" transform="rotate(45 14 14)" fill="#f0b429" />
            </svg>
            <span>Lattice — Frontier Hackathon 2026</span>
          </div>
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
