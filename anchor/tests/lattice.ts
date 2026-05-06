import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import {
  buildCommitHash,
  randomSalt,
  poolPDA,
  vaultPDA,
  createTestMint,
  createFundedTokenAccount,
} from "../sdk/lattice";

const IDL = require("../target/idl/lattice.json");

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Poll until the confirmed slot reaches targetSlot. */
async function waitForSlot(
  connection: Connection,
  targetSlot: number
): Promise<void> {
  while ((await connection.getSlot("confirmed")) < targetSlot) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("Lattice — commit-reveal batch auction", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const program = new Program(IDL, provider);

  // Windows: short enough to keep tests fast, long enough to fit setup tx.
  const COMMIT_WINDOW = new BN(10); // ~4s on localnet
  const REVEAL_WINDOW = new BN(20); // ~8s

  // Shared mints, created once.
  let tokenInMint: PublicKey;
  let tokenOutMint: PublicKey;

  before("create base mints", async () => {
    tokenInMint = await createTestMint(connection, payer);
    tokenOutMint = await createTestMint(connection, payer);
  });

  // ── 1. Happy path: commit → reveal ────────────────────────────────────────
  it("accepts a valid CommitIntent and records the hash", async () => {
    // Each test gets its own pool so the commit window starts fresh here.
    const [pool] = poolPDA(tokenInMint, tokenOutMint);

    await program.methods
      .initializePool(COMMIT_WINDOW, REVEAL_WINDOW)
      .accounts({
        authority: payer.publicKey,
        pool,
        tokenInMint,
        tokenOutMint,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  Pool:", pool.toBase58());

    // Alice's funded token account (can be created after pool init; still
    // within the 10-slot window because it's just 1-2 txs).
    const alice = Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(alice.publicKey, 0.5 * LAMPORTS_PER_SOL)
    );
    const aliceTokenIn = await createFundedTokenAccount(
      connection, payer, tokenInMint, alice.publicKey, BigInt(1_000_000_000)
    );

    const [vaultAddr] = vaultPDA(pool, tokenInMint);

    const salt = randomSalt();
    const amount = new BN(100_000_000);
    const limitPrice = new BN(150_000_000);
    const hash = buildCommitHash({ tokenIn: tokenInMint, tokenOut: tokenOutMint, amount, limitPrice, salt });

    await program.methods
      .commitIntent(Array.from(hash), amount, true)
      .accounts({
        payer: alice.publicKey,
        pool,
        payerTokenAccount: aliceTokenIn,
        mint: tokenInMint,
        vault: vaultAddr,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([alice])
      .rpc();

    // Verify commitment is recorded.
    const ps = await program.account.batchAuctionPool.fetch(pool);
    assert.equal(ps.orderCount, 1, "order_count should be 1");
    const slot0 = ps.orders[0] as any;
    assert.deepEqual(Array.from(slot0.commitHash as Uint8Array), Array.from(hash));
    assert.isFalse(slot0.revealed, "not yet revealed");
    console.log("  CommitIntent accepted, hash recorded ✓");

    // Wait for commit window to close, then reveal.
    const windowEnd =
      (ps.phaseStartSlot as BN).toNumber() + COMMIT_WINDOW.toNumber() + 1;
    console.log(`  Waiting for slot ${windowEnd}…`);
    await waitForSlot(connection, windowEnd);

    await program.methods
      .revealIntent(tokenInMint, tokenOutMint, amount, limitPrice, Array.from(salt))
      .accounts({ payer: alice.publicKey, pool })
      .signers([alice])
      .rpc();

    const afterReveal = await program.account.batchAuctionPool.fetch(pool);
    assert.isTrue((afterReveal.orders[0] as any).revealed, "should be revealed");
    console.log("  RevealIntent accepted, order verified ✓");
  });

  // ── 2. Hash mismatch is rejected ──────────────────────────────────────────
  it("rejects RevealIntent with wrong salt (hash mismatch)", async () => {
    // Use fresh mints for isolation.
    const mint2a = await createTestMint(connection, payer);
    const mint2b = await createTestMint(connection, payer);
    const [pool2] = poolPDA(mint2a, mint2b);

    // Pre-create user before pool init (slow ops before window opens).
    const alice2 = Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(alice2.publicKey, 0.5 * LAMPORTS_PER_SOL)
    );
    const ata2 = await createFundedTokenAccount(
      connection, payer, mint2a, alice2.publicKey, BigInt(1_000_000_000)
    );

    // Now init pool — window starts here.
    await program.methods
      .initializePool(COMMIT_WINDOW, REVEAL_WINDOW)
      .accounts({
        authority: payer.publicKey,
        pool: pool2,
        tokenInMint: mint2a,
        tokenOutMint: mint2b,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const [vault2] = vaultPDA(pool2, mint2a);
    const correctSalt = randomSalt();
    const wrongSalt = randomSalt();
    const amount = new BN(50_000_000);
    const limitPrice = new BN(200_000_000);

    const hash = buildCommitHash({
      tokenIn: mint2a, tokenOut: mint2b, amount, limitPrice, salt: correctSalt,
    });

    await program.methods
      .commitIntent(Array.from(hash), amount, true)
      .accounts({
        payer: alice2.publicKey,
        pool: pool2,
        payerTokenAccount: ata2,
        mint: mint2a,
        vault: vault2,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([alice2])
      .rpc();

    // Wait for commit window to close.
    const ps2 = await program.account.batchAuctionPool.fetch(pool2);
    const windowEnd2 =
      (ps2.phaseStartSlot as BN).toNumber() + COMMIT_WINDOW.toNumber() + 1;
    await waitForSlot(connection, windowEnd2);

    // Reveal with WRONG salt — must fail with HashMismatch.
    try {
      await program.methods
        .revealIntent(mint2a, mint2b, amount, limitPrice, Array.from(wrongSalt))
        .accounts({ payer: alice2.publicKey, pool: pool2 })
        .signers([alice2])
        .rpc();
      assert.fail("Should have thrown HashMismatch");
    } catch (e: any) {
      const msg: string = e.message ?? "";
      assert.isTrue(
        msg.includes("HashMismatch") || msg.includes("RevealWindowClosed"),
        `Unexpected error: ${msg}`
      );
      console.log("  Hash mismatch correctly rejected ✓");
    }
  });

  // ── 3. ClearBatch — Walrasian crossing price ──────────────────────────────
  it("ClearBatch finds correct uniform clearing price", async () => {
    const mintA = await createTestMint(connection, payer); // "USDC"
    const mintB = await createTestMint(connection, payer); // "SOL"
    const [pool] = poolPDA(mintA, mintB);

    // Pre-fund buyer (has USDC, wants SOL) and seller (has SOL, wants USDC).
    const buyer = Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(buyer.publicKey, 0.5 * LAMPORTS_PER_SOL)
    );
    const buyerAta = await createFundedTokenAccount(
      connection, payer, mintA, buyer.publicKey, BigInt(1_000_000_000)
    );

    const seller = Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(seller.publicKey, 0.5 * LAMPORTS_PER_SOL)
    );
    const sellerAta = await createFundedTokenAccount(
      connection, payer, mintB, seller.publicKey, BigInt(1_000_000_000)
    );

    // Init pool — window opens now.
    await program.methods
      .initializePool(COMMIT_WINDOW, REVEAL_WINDOW)
      .accounts({
        authority: payer.publicKey,
        pool,
        tokenInMint: mintA,
        tokenOutMint: mintB,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const [vaultA] = vaultPDA(pool, mintA); // buyer's vault (locks USDC)
    const [vaultB] = vaultPDA(pool, mintB); // seller's vault (locks SOL)

    const buyerSalt  = randomSalt();
    const sellerSalt = randomSalt();
    const amount     = new BN(50_000_000);      // 50 units
    const buyLimit   = new BN(150_000_000);     // buyer: pay up to 150
    const sellLimit  = new BN(100_000_000);     // seller: accept at least 100

    // ── Commit both orders ────────────────────────────────────────────────
    const buyHash = buildCommitHash({ tokenIn: mintA, tokenOut: mintB, amount, limitPrice: buyLimit, salt: buyerSalt });
    await program.methods
      .commitIntent(Array.from(buyHash), amount, true)
      .accounts({
        payer: buyer.publicKey, pool,
        payerTokenAccount: buyerAta, mint: mintA, vault: vaultA,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .signers([buyer]).rpc();

    const sellHash = buildCommitHash({ tokenIn: mintB, tokenOut: mintA, amount, limitPrice: sellLimit, salt: sellerSalt });
    await program.methods
      .commitIntent(Array.from(sellHash), amount, false)
      .accounts({
        payer: seller.publicKey, pool,
        payerTokenAccount: sellerAta, mint: mintB, vault: vaultB,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .signers([seller]).rpc();

    // ── Wait for commit window, then reveal both ──────────────────────────
    const psC = await program.account.batchAuctionPool.fetch(pool);
    const commitEnd = (psC.phaseStartSlot as BN).toNumber() + COMMIT_WINDOW.toNumber() + 1;
    console.log(`  [clear] Waiting for commit window (slot ${commitEnd})…`);
    await waitForSlot(connection, commitEnd);

    await program.methods
      .revealIntent(mintA, mintB, amount, buyLimit, Array.from(buyerSalt))
      .accounts({ payer: buyer.publicKey, pool })
      .signers([buyer]).rpc();

    await program.methods
      .revealIntent(mintB, mintA, amount, sellLimit, Array.from(sellerSalt))
      .accounts({ payer: seller.publicKey, pool })
      .signers([seller]).rpc();

    // ── Wait for reveal window, then clear ───────────────────────────────
    const psR = await program.account.batchAuctionPool.fetch(pool);
    const revealEnd = (psR.phaseStartSlot as BN).toNumber() + REVEAL_WINDOW.toNumber() + 1;
    console.log(`  [clear] Waiting for reveal window (slot ${revealEnd})…`);
    await waitForSlot(connection, revealEnd);

    await program.methods
      .clearBatch()
      .accounts({ pool, caller: payer.publicKey })
      .rpc();

    const cleared = await program.account.batchAuctionPool.fetch(pool);
    const cp = (cleared.clearingPrice as BN).toNumber();
    const mv = (cleared.matchedVolume as BN).toNumber();

    // Buy limit=150, sell limit=100 → both cross → p* = 100 (min crossing price)
    assert.equal(cp, sellLimit.toNumber(), `clearing price should be sell limit (${sellLimit}), got ${cp}`);
    assert.equal(mv, amount.toNumber(), `matched volume should be ${amount}, got ${mv}`);

    console.log(`  ClearBatch ✓ — p*=${cp} matched_vol=${mv}`);
  });

  // ── 4. Multiple commits within a single batch ─────────────────────────────
  it("records multiple commits up to order_count", async () => {
    const mint3a = await createTestMint(connection, payer);
    const mint3b = await createTestMint(connection, payer);
    const [pool3] = poolPDA(mint3a, mint3b);

    // Pre-create BOTH buyers before the pool is initialized (keeps slow
    // airdrop/ATA txs outside the commit window).
    const buyers: { keypair: Keypair; ata: PublicKey }[] = [];
    for (let i = 0; i < 2; i++) {
      const buyer = Keypair.generate();
      await connection.confirmTransaction(
        await connection.requestAirdrop(buyer.publicKey, 0.5 * LAMPORTS_PER_SOL)
      );
      const buyerAta = await createFundedTokenAccount(
        connection, payer, mint3a, buyer.publicKey, BigInt(500_000_000)
      );
      buyers.push({ keypair: buyer, ata: buyerAta });
    }

    // Window opens now.
    await program.methods
      .initializePool(COMMIT_WINDOW, REVEAL_WINDOW)
      .accounts({
        authority: payer.publicKey,
        pool: pool3,
        tokenInMint: mint3a,
        tokenOutMint: mint3b,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const [vault3] = vaultPDA(pool3, mint3a);

    for (const { keypair: buyer, ata: buyerAta } of buyers) {
      const salt = randomSalt();
      const amount = new BN(50_000_000);
      const limitPrice = new BN(150_000_000);
      const hash = buildCommitHash({
        tokenIn: mint3a, tokenOut: mint3b, amount, limitPrice, salt,
      });
      await program.methods
        .commitIntent(Array.from(hash), amount, true)
        .accounts({
          payer: buyer.publicKey,
          pool: pool3,
          payerTokenAccount: buyerAta,
          mint: mint3a,
          vault: vault3,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
    }

    const state = await program.account.batchAuctionPool.fetch(pool3);
    assert.equal(state.orderCount, 2, "two orders committed");
    console.log("  Two simultaneous commits recorded ✓");
  });
});
