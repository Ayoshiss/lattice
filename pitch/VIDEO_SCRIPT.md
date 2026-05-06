# Lattice — Demo Video Script
**Target length: 3 minutes**  
**Format: Screen recording + voiceover**

---

## Setup before recording
- `./start-demo.sh` — confirm both services green
- Browser open at `http://localhost:3000/demo`, zoomed to 110%
- Terminal open in `lattice/agent/` in second half
- Devnet explorer ready: `https://explorer.solana.com/?cluster=devnet`

---

## [0:00 – 0:20] Hook

> *Show the hero section of the demo page*

"Every time you trade on a DEX, a bot is watching. It sees your order in the mempool, jumps in front of you, moves the price, and sells back to you at a profit. This is called a sandwich attack — and it costs DeFi users over a billion dollars a year."

> *Point to the red chips: 98 bps, $99.74*

"This is real. On a standard AMM, a single 10,000 USDC trade loses 98 basis points to MEV. The searcher pockets $99.74 — every single trade."

---

## [0:20 – 0:55] AMM sandwich demo

> *Click "▶ Simulate Sandwich Attack" on the left panel*

"Watch what happens on a constant-product AMM."

> *As logs stream in, narrate:*

"The victim submits a buy order. It hits the public mempool. A searcher detects it instantly — front-runs with 5,000 USDC, skewing the pool. The victim executes at a worse price. The searcher back-runs, extracting $99.74 in profit. The MEV meter hits 98 basis points."

> *Point to the red MEV bar filling up*

"This isn't a bug — it's a fundamental property of transparent order books combined with atomic composability. The information is public before it's final."

---

## [0:55 – 1:45] Lattice demo

> *Click "▶ Submit Lattice Order" on the right panel*

"Now watch Lattice."

> *As logs stream, narrate each step:*

"Phase 1 — Commit. The agent hashes the order: SHA-256 of token pair, amount, limit price, and a random salt. The hash goes on-chain. The tokens are locked in a program-controlled vault. At this point, *no one* — not the relayer, not validators, not MEV bots — can see what price or size was submitted."

> *Show the 402 dance lines in the log*

"Notice this: the order isn't broadcast directly. It goes through an x402 relay. The agent hits the relay — gets a 402 Payment Required response — signs a 0.001 USDC micropayment with its ed25519 keypair — and the relay submits the sealed transaction to devnet."

> *Show the tx link appearing*

"Confirmed on-chain. The hash is public. The order details are not."

> *Phase transitions to Reveal*

"Phase 2 — Reveal. After the commit window closes, the agent reveals the plaintext. The program verifies it matches the hash. Any unrevealed order forfeits its collateral — so everyone is incentivised to reveal."

> *Phase transitions to Clear*

"Phase 3 — Clear. Binary search over all revealed limit prices finds the Walrasian equilibrium price p* — the single price where total buy volume crosses total sell volume. Every matched order settles at the same price. The MEV meter: zero."

---

## [1:45 – 2:20] Agent + LLM brain

> *Switch to terminal, run `yarn start` in agent/*

"The agent is autonomous. It uses an LLM to reason about how to fragment a large order."

> *Show the LLM output appearing*

"Given a 1,000 USDC buy order over 30 seconds, the LLM reasons: fragment into N slices via TWAP to minimise market impact. Each fragment goes through its own x402 payment dance. Each one lands on devnet as a separate sealed commit."

> *Show three tx links appearing*

"Three fragments. Three devnet confirmations. Zero MEV on any of them."

---

## [2:20 – 2:50] Why it works

> *Switch back to browser, scroll to "How Lattice Eliminates MEV" section*

"Why does this work? Front-running requires seeing an order before it executes. In Lattice, orders are SHA-256 hashed before submission. The preimage — the actual order — is revealed only after the commit window closes, when it's too late to front-run."

"The uniform clearing price is the other half. Even if a bot could guess your order, submitting its own order doesn't help — everyone fills at the same price. There's no intra-batch arbitrage possible. Mathematically."

---

## [2:50 – 3:00] Close

> *Show the program address in the footer*

"Lattice is live on Solana devnet. Program ID AW8zeS7 — verifiable on Explorer. The agent, relay, and frontend are all open source."

"Built for Frontier Hackathon 2025. This is what MEV-free trading looks like."

---

## Recording tips
- Use QuickTime (Mac) → File → New Screen Recording, mic on
- Record at 1280×800, no dock visible
- Do a dry run first — the devnet txs take 10–15s each, account for pauses
- Keep cursor movements slow and deliberate
- If a tx fails, restart the demo — `./start-demo.sh` takes 15s
