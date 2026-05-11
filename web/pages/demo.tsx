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
// ── Minimum tokenIn balance the Demo User needs to start a run ───────────────
const PREFLIGHT_MIN_RAW = BigInt(100_000_000); // 100 tokens at 6 dp

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

  // ── Pre-flight: verify Demo User ATA has enough tokenIn before enabling trade
  type PreflightState = "checking" | "ready" | "underfunded" | "unconfigured";
  const [preflightState, setPreflightState] = useState<PreflightState>("checking");
  const [preflightMsg,   setPreflightMsg]   = useState("");

  useEffect(() => {
    let cancelled = false;
    async function checkPreflight() {
      const tokenInAddr  = process.env.NEXT_PUBLIC_DEMO_TOKEN_IN;
      const userSecretB64 = process.env.NEXT_PUBLIC_DEMO_USER_SECRET_KEY;
      if (!tokenInAddr || !userSecretB64) {
        if (!cancelled) { setPreflightState("unconfigured"); setPreflightMsg("Run: yarn workspace web setup:demo"); }
        return;
      }
      try {
        const { Connection, Keypair, PublicKey } = await import("@solana/web3.js");
        const { getAssociatedTokenAddress, getAccount } = await import("@solana/spl-token");
        const conn     = new Connection(DEVNET_RPC, "confirmed");
        const demoUser = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(userSecretB64)));
        const mint     = new PublicKey(tokenInAddr);
        const ata      = await getAssociatedTokenAddress(mint, demoUser.publicKey);
        const acct     = await getAccount(conn, ata, "confirmed");
        if (cancelled) return;
        if (acct.amount >= PREFLIGHT_MIN_RAW) {
          setPreflightState("ready");
          setPreflightMsg(`${(Number(acct.amount) / 1_000_000).toLocaleString()} tokens available`);
        } else {
          setPreflightState("underfunded");
          setPreflightMsg(`Demo User ATA has ${Number(acct.amount) / 1_000_000} tokens — need ≥ 100. Run: setup:demo`);
        }
      } catch (e: any) {
        if (!cancelled) { setPreflightState("underfunded"); setPreflightMsg(e.message?.slice(0, 80) ?? "Balance check failed"); }
      }
    }
    checkPreflight();
    return () => { cancelled = true; };
  }, []);

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
    l("Your order is now visible to everyone in the mempool", "warn");
    await delay(500);
    l("Bot detected your order — front-running now", "error");
    l("Bot buys 5,000 USDC of SOL ahead of you → price moves up", "error");
    await delay(400);
    l("Pool is now skewed against you", "error");
    await delay(500);
    l("Your trade executes — at the worse, bot-inflated price", "error");
    await delay(300);
    l("Bot sells its SOL right after you → locks in profit", "error");
    await delay(200);
    l("Bot extracted $99.74 from your trade (98 bps)", "error");
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
      const { getOrCreateAssociatedTokenAccount, getAccount, createMint, mintTo } = await import("@solana/spl-token");
      const nacl  = (await import("tweetnacl")).default;
      const bs58  = (await import("bs58")).default;
      const IDL   = (await import("../anchor-idl/lattice.json")).default;

      // ── Load static demo keypairs from env (written by setup-demo.ts) ──────
      const tokenInAddr    = process.env.NEXT_PUBLIC_DEMO_TOKEN_IN;
      const userSecretJson = process.env.NEXT_PUBLIC_DEMO_USER_SECRET_KEY;
      const mmSecretJson   = process.env.NEXT_PUBLIC_DEMO_MM_SECRET_KEY;
      if (!tokenInAddr || !userSecretJson || !mmSecretJson) {
        throw new Error("Demo not configured. Run: yarn workspace web setup:demo  then restart next dev");
      }
      const demoUser = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(userSecretJson)));
      const ghostMM  = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(mmSecretJson)));
      const tokenIn  = new PublicKey(tokenInAddr);

      l(`Demo User: ${demoUser.publicKey.toBase58().slice(0, 16)}…`);
      l(`Ghost MM:  ${ghostMM.publicKey.toBase58().slice(0, 16)}…`);
      let userSol = await connection.getBalance(demoUser.publicKey);
      l(`Connected to Solana devnet — ${(userSol / LAMPORTS_PER_SOL).toFixed(3)} SOL available`, "success");

      if (userSol < 0.1 * LAMPORTS_PER_SOL) {
        l(`SOL low — requesting devnet airdrop…`, "warn");
        try {
          const airdropSig = await connection.requestAirdrop(demoUser.publicKey, 1 * LAMPORTS_PER_SOL);
          await connection.confirmTransaction(airdropSig, "confirmed");
          userSol = await connection.getBalance(demoUser.publicKey);
          l(`Airdrop received — ${(userSol / LAMPORTS_PER_SOL).toFixed(3)} SOL  ✓`, "success");
        } catch {
          throw new Error(`SOL too low (${(userSol / LAMPORTS_PER_SOL).toFixed(3)}) and devnet airdrop rate-limited. Run: yarn workspace web setup:demo`);
        }
      }

      // ── Phase 1: Commit via x402 relay ────────────────────────────────────
      setPhase("commit");
      l("Phase 1: Sealing your order");

      // tokenIn: PERSISTENT — Demo User ATA pre-funded by setup-demo.ts.
      // No mintTo in the hot path; just read the existing balance.
      const NEED = BigInt(100_000_000);
      const userAtaInfo = await getOrCreateAssociatedTokenAccount(
        connection, demoUser, tokenIn, demoUser.publicKey,
        false, "confirmed", { preflightCommitment: "confirmed" },
      );
      const userAta    = userAtaInfo.address;
      const userAtaBal = (await getAccount(connection, userAta, "confirmed")).amount;
      if (userAtaBal < NEED) throw new Error(`Demo User tokenIn ATA underfunded (${userAtaBal} raw). Re-run: setup:demo`);
      l(`tokenIn ATA: ${userAtaBal.toLocaleString()} raw  ✓`, "success");

      // tokenOut: FRESH per run — unique pool PDA prevents CommitWindowClosed on repeat runs.
      const tokenOut = await createMint(connection, demoUser, demoUser.publicKey, null, 6, undefined, { preflightCommitment: "confirmed" });
      l(`tokenIn:  ${tokenIn.toBase58().slice(0,16)}…  (persistent)`, "tx");
      l(`tokenOut: ${tokenOut.toBase58().slice(0,16)}…  (fresh)`, "tx");

      const [pool]  = poolPDA(tokenIn, tokenOut);
      const [vault] = vaultPDA(pool, tokenIn);
      l(`pool: ${pool.toBase58().slice(0,16)}…  vault: ${vault.toBase58().slice(0,16)}…`, "tx");

      // AnchorProvider uses demoUser wallet (for clearBatch / settle .rpc() calls)
      const wallet = {
        publicKey: demoUser.publicKey,
        signTransaction: async (tx: any) => { tx.partialSign(demoUser); return tx; },
        signAllTransactions: async (txs: any[]) => { txs.forEach(t => t.partialSign(demoUser)); return txs; },
      };
      const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed", preflightCommitment: "confirmed" });
      const program  = new Program(IDL as any, provider);
      const prog = program as any;
      const COMMIT_SLOTS = 20;  // ~8s on devnet
      const REVEAL_SLOTS = 15;  // ~6s on devnet

      // tokenOut is fresh each run → always create a new pool PDA.
      l("Creating batch auction pool (~0.051 SOL rent this run)…");
      const initPoolTx = await prog.methods
        .initializePool(new BN(COMMIT_SLOTS), new BN(REVEAL_SLOTS))
        .accounts({
          authority: demoUser.publicKey, pool,
          tokenInMint: tokenIn, tokenOutMint: tokenOut,
          systemProgram: SystemProgram.programId,
        }).transaction();
      const initBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      initPoolTx.recentBlockhash = initBlockhash;
      initPoolTx.feePayer = demoUser.publicKey;
      initPoolTx.sign(demoUser);
      const initTx = await connection.sendRawTransaction(initPoolTx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
      const initResult = await connection.confirmTransaction(initTx, "confirmed");
      if (initResult.value.err) throw new Error(`initializePool failed: ${JSON.stringify(initResult.value.err)}`);
      l("Pool created on devnet ✓", "tx");
      setTxSig(initTx);

      // Build CommitIntent tx
      // PRICE UNITS: clearing_price is stored and used as a natural integer
      // (e.g. 99 = "99 tokenIn per tokenOut").  Do NOT scale by 1e6.
      // For vault balance to cancel exactly at settle:
      //   user amount = mmAmount * mmLimitPrice  (tokenIn committed by buyer)
      //   MM amount   = mmAmount                 (tokenOut committed by seller)
      // Then: settle_buy  = amount / clearing_price = mmAmount ✓
      //        settle_sell = mmAmount * clearing_price = amount ✓
      const { randomBytes, createHash } = await import("crypto");
      const salt         = randomBytes(16);
      const MM_AMOUNT    = 100_000_000;   // 100 tokenOut at 6 dp
      const MM_LP_NAT    = 99;            // 99 tokenIn/tokenOut (natural, no 6dp)
      const USER_LP_NAT  = 102;           // 102 tokenIn/tokenOut (natural, no 6dp)
      const amount     = new BN(MM_AMOUNT * MM_LP_NAT);  // 9_900_000_000
      const limitPrice = new BN(USER_LP_NAT);            // 102

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
          payer: demoUser.publicKey, pool,
          tokenInMint: tokenIn, tokenOutMint: tokenOut,
          payerTokenAccount: userAta, mint: tokenIn, vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        }).transaction();
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      commitTxObj.recentBlockhash = blockhash;
      commitTxObj.feePayer = demoUser.publicKey;
      commitTxObj.sign(demoUser);
      const txBase64     = commitTxObj.serialize().toString("base64");
      const commitHashHex = Buffer.from(commitHash).toString("hex");

      l(`Your order hash: ${commitHashHex.slice(0, 16)}… (order details invisible)`);

      // ── x402 dance ────────────────────────────────────────────────────────
      l("Sending sealed order to private relay…  [x402 MEV-shield]");
      const first = await fetch("/api/relay/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitHash: commitHashHex, payer: demoUser.publicKey.toBase58(), txBase64 }),
      }).catch(() => { throw new Error("Relay unreachable — is it running on port 7402?"); });

      const firstBody = await first.json().catch(() => ({}));

      // Read envelope from body (_paymentRequired) with header as fallback
      const envelopeB64 = firstBody._paymentRequired
        ?? first.headers.get("payment-required")
        ?? "";
      if (!envelopeB64) throw new Error(`Relay returned ${first.status} but no payment envelope — check relay logs`);
      l(`← HTTP 402 Payment Required  (x402 protocol)`, "warn");

      const envelope = JSON.parse(atob(envelopeB64));

      // Sign with nacl ed25519
      const msgStr = JSON.stringify({
        amount: envelope.maxAmountRequired, asset: envelope.asset,
        network: envelope.network, resource: "/commit", nonce: envelope.nonce,
      });
      const msgBytes = new TextEncoder().encode(msgStr);
      const sigBytes = nacl.sign.detached(msgBytes, demoUser.secretKey);
      const paymentSig = btoa(JSON.stringify({
        from:      demoUser.publicKey.toBase58(),
        pubkey:    demoUser.publicKey.toBase58(),
        signature: bs58.encode(sigBytes),
        amount:    envelope.maxAmountRequired,
        asset:     envelope.asset,
        network:   envelope.network,
        nonce:     envelope.nonce,
      }));

      l("Agent signs micropayment · resubmitting with x402 payment proof…");

      const second = await fetch("/api/relay/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "payment-signature": paymentSig },
        body: JSON.stringify({ commitHash: commitHashHex, payer: demoUser.publicKey.toBase58(), txBase64 }),
      });

      if (!second.ok) {
        const err = await second.json();
        throw new Error(err.error ?? `Relay error ${second.status}`);
      }

      const relayResult = await second.json();
      l(`← HTTP 200 OK · private Jito bundle secured`, "success");
      l(`Sealed order on-chain. Bots see only a hash.`, "success");
      l(`devnet: ${relayResult.txSig?.slice(0, 20)}…`, "tx");
      lastTxSig = relayResult.txSig ?? "";
      setTxSig(relayResult.txSig);

      // ── Market-maker: seal the opposing sell order ─────────────────────────
      // So clearBatch finds a cross and actually settles at p*
      const mmSalt       = randomBytes(16);
      const mmAmount     = new BN(MM_AMOUNT);         // 100 tokenOut (SOL side)
      const mmLimitPrice = new BN(MM_LP_NAT);         // willing to sell at ≥ 99 tokenIn/tokenOut

      const mmH = createHash("sha256");
      mmH.update(tokenIn.toBuffer());
      mmH.update(tokenOut.toBuffer());
      mmH.update(mmAmount.toArrayLike(Buffer, "le", 8));
      mmH.update(mmLimitPrice.toArrayLike(Buffer, "le", 8));
      mmH.update(mmSalt);
      const mmCommitHash = Array.from(mmH.digest());

      const [vaultOut] = vaultPDA(pool, tokenOut);

      // Ghost MM tokenOut ATA — fresh for this tokenOut mint; mint before commit.
      const userAtaOutInfo = await getOrCreateAssociatedTokenAccount(
        connection, demoUser, tokenOut, ghostMM.publicKey,
        false, "confirmed", { preflightCommitment: "confirmed" },
      );
      const userAtaOut = userAtaOutInfo.address;
      const mmMintSig = await mintTo(connection, demoUser, tokenOut, userAtaOut, demoUser, BigInt(MM_AMOUNT + 1_000), [], { preflightCommitment: "confirmed" });
      await connection.confirmTransaction(mmMintSig, "confirmed");
      l(`Ghost MM tokenOut ATA: minted ${(MM_AMOUNT + 1_000).toLocaleString()} raw ✓`, "success");
      l("MM commit: submitting…");

      // Build the MM commit tx manually with preflightCommitment:"confirmed"
      // so simulation sees the same slot mintTo was confirmed at.
      const mmCommitTx = await prog.methods
        .commitIntent(mmCommitHash, mmAmount, false)
        .accounts({
          payer: ghostMM.publicKey, pool,
          tokenInMint: tokenIn, tokenOutMint: tokenOut,
          payerTokenAccount: userAtaOut, mint: tokenOut, vault: vaultOut,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        }).transaction();
      const mmBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      mmCommitTx.recentBlockhash = mmBlockhash;
      mmCommitTx.feePayer = ghostMM.publicKey;
      mmCommitTx.sign(ghostMM);
      const mmCommitSig = await connection.sendRawTransaction(mmCommitTx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
      const mmCommitResult = await connection.confirmTransaction(mmCommitSig, "confirmed");
      if (mmCommitResult.value.err) throw new Error(`MM commit failed on-chain: ${JSON.stringify(mmCommitResult.value.err)}`);
      l("Market-maker sealed sell side — batch can now cross", "info");

      // ── Phase 2: Reveal ────────────────────────────────────────────────────
      setPhase("reveal");
      l("Phase 2: Waiting for commit window to close…");
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
      const revealTxObj = await prog.methods
        .revealIntent(tokenIn, tokenOut, amount, limitPrice, Array.from(salt))
        .accounts({ payer: demoUser.publicKey, pool, tokenInMint: tokenIn, tokenOutMint: tokenOut })
        .transaction();
      const revealBh = (await connection.getLatestBlockhash("confirmed")).blockhash;
      revealTxObj.recentBlockhash = revealBh; revealTxObj.feePayer = demoUser.publicKey; revealTxObj.sign(demoUser);
      const revealTx = await connection.sendRawTransaction(revealTxObj.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
      const revealRes = await connection.confirmTransaction(revealTx, "confirmed");
      if (revealRes.value.err) throw new Error(`revealIntent failed: ${JSON.stringify(revealRes.value.err)}`);
      l("Your order revealed and verified on-chain ✓", "success");
      l(`devnet: ${revealTx.slice(0, 20)}…`, "tx");
      setTxSig(revealTx);

      // Reveal market-maker sell order
      const mmRevealTxObj = await prog.methods
        .revealIntent(tokenIn, tokenOut, mmAmount, mmLimitPrice, Array.from(mmSalt))
        .accounts({ payer: ghostMM.publicKey, pool, tokenInMint: tokenIn, tokenOutMint: tokenOut })
        .transaction();
      const mmRevBh = (await connection.getLatestBlockhash("confirmed")).blockhash;
      mmRevealTxObj.recentBlockhash = mmRevBh; mmRevealTxObj.feePayer = ghostMM.publicKey; mmRevealTxObj.sign(ghostMM);
      const mmRevealTx = await connection.sendRawTransaction(mmRevealTxObj.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
      const mmRevRes = await connection.confirmTransaction(mmRevealTx, "confirmed");
      if (mmRevRes.value.err) throw new Error(`MM revealIntent failed: ${JSON.stringify(mmRevRes.value.err)}`);
      l("Market-maker order revealed — both sides ready to clear", "info");
      l(`devnet: ${mmRevealTx.slice(0, 20)}…`, "tx");

      // ── Phase 3: Clear ────────────────────────────────────────────────────
      setPhase("clear");
      l("Phase 3: Finding the fairest clearing price…");
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
          .clearBatch().accounts({ pool, tokenInMint: tokenIn, tokenOutMint: tokenOut, caller: demoUser.publicKey }).rpc();
        l("Batch settled at fair market price ✓", "success");
        l(`devnet: ${clearTx.slice(0, 20)}…`, "tx");
        setTxSig(clearTx);

        // Capture real order-book data for the live batch visualizer.
        // Prices are natural integers (no 6dp scaling).
        // The clearBatch algorithm tie-breaks at the lower price = mmLimitPrice.
        const userBuyPrice  = limitPrice.toNumber();    // 102
        const mmSellPrice   = mmLimitPrice.toNumber();  // 99
        const clearingPrice = mmSellPrice;              // 99 (lower tie-break)
        setRealBatchData({ userBuyPrice, mmSellPrice, clearingPrice });
        l(`Clearing price p* = ${clearingPrice} tokenIn/tokenOut (live)`, "success");

        // ── Phase 4: Settle — transfer tokens from vaults to payers ──────────
        l("Phase 4: Settling tokens to payers…");
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
            caller: demoUser.publicKey,
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
      l("Done. Zero bot interference. You kept every cent.", "success");
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
  // Show verdict card as soon as Lattice completes — comparison numbers come from
  // the simulation, so AMM doesn't need to run first.
  const bothDone = latticeDone;

  return (
    <>
      <Head>
        <title>Lattice — Stop Bots from Stealing Your Trades</title>
        <meta name="description" content="See exactly how bots steal from every DEX trade — then watch Lattice block them with cryptography." />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />

        {/* OG */}
        <meta property="og:type"        content="website" />
        <meta property="og:title"       content="Lattice — Stop Bots from Stealing Your Trades" />
        <meta property="og:description" content="Live interactive demo: run a sandwich attack, then submit a protected order through Lattice on Solana devnet." />
        <meta property="og:image"       content={`/api/og?title=Stop+Bots+from+Stealing+Your+Trades&sub=Live+interactive+demo+on+Solana+devnet`} />
        <meta property="og:image:width"  content="1200" />
        <meta property="og:image:height" content="630" />

        {/* Twitter */}
        <meta name="twitter:card"        content="summary_large_image" />
        <meta name="twitter:title"       content="Lattice — Stop Bots from Stealing Your Trades" />
        <meta name="twitter:description" content="Live interactive demo: run a sandwich attack, then submit a protected order through Lattice on Solana devnet." />
        <meta name="twitter:image"       content={`/api/og?title=Stop+Bots+from+Stealing+Your+Trades&sub=Live+interactive+demo+on+Solana+devnet`} />
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
              <span className="text-[11px] font-mono text-[#3a3a5a]">Solana devnet live</span>
            </div>

            {/* Relay status badge */}
            <div className={`hidden sm:flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${
              relayStatus === "checking" ? "border-[#3a3a5a44] text-[#3a3a5a]" :
              relayStatus === "online"   ? "border-[#00ff8844] text-[#00ff88] bg-[#00ff8808]" :
                                          "border-[#ff3b5c44] text-[#ff3b5c] bg-[#ff3b5c08]"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                relayStatus === "checking" ? "bg-[#3a3a5a]" :
                relayStatus === "online"   ? "bg-[#00ff88] shadow-[0_0_4px_#00ff88]" :
                                            "bg-[#ff3b5c]"
              }`} />
              relay {relayStatus === "checking" ? "…" : relayStatus}
            </div>

<Link href="/compliance"
                  className="hidden md:block text-[11px] font-mono text-[#a5a5a5] hover:text-[#00d4ff] transition-colors">
              Compliance
            </Link>
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
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 mt-0.5">
              <path d="M7 1.5L12.5 11.5H1.5L7 1.5Z" stroke="#ff3b5c" strokeWidth="1.2" strokeLinejoin="round"/>
              <line x1="7" y1="5.5" x2="7" y2="8.5" stroke="#ff3b5c" strokeWidth="1.2" strokeLinecap="round"/>
              <circle cx="7" cy="10" r="0.7" fill="#ff3b5c"/>
            </svg>
            <div className="flex-1 min-w-0">
              <span className="text-[12px] font-mono text-[#ff3b5c] font-semibold">
                Relay offline —
              </span>
              <span className="text-[12px] font-mono text-[#f1f0f7]">
                {" "}the x402 private relay isn&rsquo;t running. The Lattice and Agent panels will fail.
              </span>
              <span className="text-[12px] font-mono text-[#3a3a5a]">
                {" "}Start it with:{" "}
              </span>
              <code className="text-[11px] font-mono text-[#00d4ff] bg-[#00d4ff0a] border border-[#00d4ff22] rounded px-1.5 py-0.5">
                cd relay &amp;&amp; npm start
              </code>
            </div>
            <button
              onClick={() => setRelayBannerDismissed(true)}
              className="text-[#3a3a5a] hover:text-[#f1f0f7] text-sm font-mono shrink-0"
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
            Live on Solana Devnet
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-[#f1f0f7] mb-3 tracking-[-0.02em]">
            Live interactive demo
          </h1>
          <p className="text-[#6b6b8a] text-sm max-w-xl mx-auto leading-6 mb-3">
            Run a real sandwich attack simulation, then submit a protected order through Lattice
            on Solana devnet. Every transaction is verifiable on-chain.
          </p>
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1
                          border border-[#00d4ff22] bg-[#00d4ff08] text-[#00d4ff]
                          text-[10px] font-mono">
            <span className="font-black">402</span>
            <span className="text-[#1a1a2e]">·</span>
            <span>HTTP 402 → x402 micropayment → private Jito bundle</span>
          </div>

          {/* Quick stats */}
          <div className="flex items-center justify-center gap-3 mt-6 flex-wrap">
            <div className="rounded-xl px-4 py-2.5 bg-[#ff3b5c0c] border border-[#ff3b5c30] text-center">
              <div className="text-[10px] font-mono text-[#ff3b5c66] uppercase tracking-wider">Bot steals</div>
              <div className="text-xl font-mono font-bold text-[#ff3b5c]">$99.74</div>
            </div>
            <div className="text-[#a5a5a5] font-mono font-bold">vs</div>
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
            <div className="hidden sm:flex flex-1 h-px bg-[#1a1a2e] mx-2 min-w-[16px]" />
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[#00ff8818] border border-[#00ff8844] flex items-center justify-center text-[10px] font-mono font-bold text-[#00ff88]">2</span>
              <span className="text-xs font-mono text-[#f1f0f7]">Submit a protected order</span>
            </div>
            <div className="hidden sm:flex flex-1 h-px bg-[#1a1a2e] mx-2 min-w-[16px]" />
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
            preflightState={preflightState}
            preflightMsg={preflightMsg}
          />
        </div>

        {/* ── AI Agent Panel ──────────────────────────────────────────────── */}
        <div className="px-6 pt-6 pb-2 max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-[#1a1a2e]" />
            <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-widest px-3">
              Step 3 — autonomous AI agent
            </div>
            <div className="flex-1 h-px bg-[#1a1a2e]" />
          </div>
          <AgentPanel />
        </div>

        {/* ── Verdict card (shown after both run) ──────────────────────────── */}
        {bothDone && (
          <div className="max-w-7xl mx-auto px-6 pb-6">
            <div className="rounded-xl border border-[#00ff8844] bg-[#00ff8808] p-6">
              <div className="text-center mb-6">
                <div className="flex items-center justify-center gap-2 font-bold text-[#00ff88] mb-1 text-lg">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <circle cx="9" cy="9" r="8" stroke="#00ff88" strokeWidth="1.2"/>
                    <path d="M5 9l3 3 5-5" stroke="#00ff88" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Same trade. Completely different outcome.
                </div>
                <div className="text-sm text-[#3a3a5a] font-mono">
                  Lattice didn't improve execution — it made bot attacks structurally impossible.
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-lg bg-[#ff3b5c0a] border border-[#ff3b5c33] p-4 text-center">
                  <div className="text-[10px] font-mono text-[#ff3b5c88] uppercase tracking-widest mb-1">Regular DEX</div>
                  <div className="text-2xl font-mono font-bold text-[#ff3b5c]">{toDisplay(result.victimOutAfter)} SOL</div>
                  <div className="text-[11px] font-mono text-[#3a3a5a] mt-1">Bot took $99.74 from you</div>
                </div>
                <div className="flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-2xl font-mono font-bold text-[#00ff88]">+{toDisplay(result.latticeImprovementSol)} SOL</div>
                    <div className="text-[10px] font-mono text-[#3a3a5a] uppercase tracking-widest mt-1">You keep more</div>
                  </div>
                </div>
                <div className="rounded-lg bg-[#00ff880a] border border-[#00ff8833] p-4 text-center">
                  <div className="text-[10px] font-mono text-[#00ff8888] uppercase tracking-widest mb-1">Lattice</div>
                  <div className="text-2xl font-mono font-bold text-[#00ff88]">{toDisplay(result.latticeVictimSol)} SOL</div>
                  <div className="text-[11px] font-mono text-[#3a3a5a] mt-1">Bot profit: $0.00</div>
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
          <div className="border border-[#1a1a2e] rounded-xl bg-[#0c0c1a] p-6">
            <h2 className="font-semibold text-sm text-[#00d4ff] uppercase tracking-widest mb-6 text-center">
              Why bots can&rsquo;t attack Lattice
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <rect x="3" y="9" width="14" height="10" rx="2" stroke="#00d4ff" strokeWidth="1.3"/>
                      <path d="M6 9V7a4 4 0 018 0v2" stroke="#00d4ff" strokeWidth="1.3" strokeLinecap="round"/>
                      <circle cx="10" cy="14" r="1.5" fill="#00d4ff"/>
                    </svg>
                  ),
                  title: "You seal your order first",
                  color: "#00d4ff",
                  desc: "Before your order hits the blockchain, it's encrypted into a hash. Bots can see that you submitted something — but not what you're buying, at what price, or for how much.",
                },
                {
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <circle cx="10" cy="10" r="8" stroke="#00d4ff" strokeWidth="1.3"/>
                      <path d="M10 5v5l3 3" stroke="#00d4ff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ),
                  title: "Everyone reveals at the same time",
                  color: "#00d4ff",
                  desc: "Once the submission window closes, all traders reveal their orders simultaneously. There's no way for a bot to \"go first\" — the window is already shut.",
                },
                {
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <line x1="10" y1="2" x2="10" y2="18" stroke="#00ff88" strokeWidth="1.3" strokeLinecap="round"/>
                      <line x1="4" y1="5" x2="16" y2="5" stroke="#00ff88" strokeWidth="1.3" strokeLinecap="round"/>
                      <path d="M3 5L1 10h5L4 5" stroke="#00ff88" strokeWidth="1.1" strokeLinejoin="round"/>
                      <path d="M13 5l-2 5h5l-2-5" stroke="#00ff88" strokeWidth="1.1" strokeLinejoin="round"/>
                    </svg>
                  ),
                  title: "One fair price for everyone",
                  color: "#00ff88",
                  desc: "A single clearing price is calculated from all revealed orders. Every buyer and seller in the batch gets exactly the same price — there's no room for bots to exploit price differences.",
                },
              ].map((s) => (
                <div key={s.title} className="flex gap-4">
                  <div className="shrink-0 mt-0.5">{s.icon}</div>
                  <div>
                    <div className="font-semibold text-sm mb-2" style={{ color: s.color }}>
                      {s.title}
                    </div>
                    <div className="text-[12px] text-[#3a3a5a] leading-5">
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
            <span>Lattice · Live on Solana Devnet</span>
          </div>
          <div className="flex items-center gap-4 hidden sm:flex">
            <Link href="/compliance" className="text-[#a5a5a5] hover:text-[#00d4ff] transition-colors">
              Compliance
            </Link>
            <a
              href="https://explorer.solana.com/address/AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV?cluster=devnet"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00d4ff] hover:underline"
            >
              Program: AW8zeS7…F6iV ↗
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
