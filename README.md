# Lattice — Anti-MEV Batch Auction DEX

> **Frontier Hackathon 2025 · DeFi Infrastructure Track**  
> Commit-reveal batch auctions on Solana. Front-running is mathematically impossible.

---

## The Problem

Every trade on a constant-product AMM leaks information to the public mempool. MEV bots see your order before it executes, front-run it, and pocket the difference. On Ethereum this costs users ~$1B/year. On Solana the attack is faster and cheaper.

**Demo:** a 10,000 USDC buy on a standard AMM loses 98 bps to a sandwich attack. The searcher extracts $99.74 in profit per trade.

## The Solution

Lattice runs a **commit-reveal batch auction** every N slots:

```
Phase 1 — Commit   Users submit SHA-256(order || salt). Tokens locked in PDA vault.
                   ↓  nothing is visible on-chain
Phase 2 — Reveal   Users reveal plaintext. Program verifies hashes.
                   ↓  all orders revealed simultaneously  
Phase 3 — Clear    Binary search finds Walrasian p* — the single price where
                   cumBuyVol(≥p*) = cumSellVol(≤p*). All matched orders fill
                   at the same uniform price. MEV = 0.
```

Front-running requires seeing an order before it executes. In Lattice, orders are cryptographically sealed until after the commit window closes. There is no information to exploit.

---

## Live Demo

```bash
git clone <repo>
cd lattice
./start-demo.sh          # starts relay (7402) + frontend (3000)
# open http://localhost:3000/demo
```

- **Left panel** — simulate a sandwich attack on a mock AMM. Watch the MEV meter hit 98 bps.  
- **Right panel** — submit a Lattice order through the x402 relay. Watch the 402 dance in the activity log. MEV = 0.

Program deployed on devnet: [`AW8zeS7…F6iV`](https://explorer.solana.com/address/AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV?cluster=devnet)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Lattice Stack                        │
│                                                          │
│  web/          Next.js 14 demo UI (SandwichLab)          │
│  relay/        Express x402 payment relay (port 7402)    │
│  agent/        Autonomous liquidity agent (LLM-powered) │
│  sdk/          TypeScript client SDK                     │
│  anchor/       Rust/Anchor on-chain program              │
│  compliance/   VARA regulatory compliance package        │
└─────────────────────────────────────────────────────────┘
```

### On-Chain Program (`anchor/`)

Written in Rust with Anchor 0.30.1. Four instructions:

| Instruction | Description |
|------------|-------------|
| `initializePool` | Create a batch auction pool PDA for a token pair |
| `commitIntent` | Submit sealed order hash + lock tokens in vault |
| `revealIntent` | Reveal plaintext; program verifies SHA-256 |
| `clearBatch` | Binary search for Walrasian p*; settle matched orders |

```bash
cd anchor
anchor test          # 4/4 tests on localnet
anchor deploy        # deploys to configured cluster
```

### x402 Relay (`relay/`)

Express server that payment-gates CommitIntent submission. Implements the [x402 protocol](https://x402.org):

1. `POST /commit` with no payment → `402 Payment Required` + signed envelope  
2. Agent signs envelope with ed25519 keypair  
3. `POST /commit` + `PAYMENT-SIGNATURE` → relay verifies nacl signature, submits tx to devnet  

```bash
cd relay && yarn dev      # http://localhost:7402
curl localhost:7402/discovery
```

### Autonomous Agent (`agent/`)

Powered by an LLM (OpenRouter or any compatible model). Given a parent order:

1. Asks LLM to reason about optimal TWAP fragmentation (N slices, risk notes)
2. Splits order into N equal fragments
3. For each fragment: builds Anchor `CommitIntent` tx → x402 dance with relay → devnet confirmed

```bash
cd agent
# Set OPENROUTER_API_KEY or ANTHROPIC_API_KEY in .env
yarn start
```

### SDK (`sdk/`)

TypeScript client for integrating Lattice into your app:

```typescript
import { LatticeClient, poolPDA, vaultPDA } from '@lattice/sdk';

const client = new LatticeClient(connection, wallet);

// Init a pool
const [pool] = poolPDA(tokenIn, tokenOut);
await client.initPool(tokenIn, tokenOut, 300n, 60n);

// Commit a sealed order
const [vault] = vaultPDA(pool, tokenIn);
const { txSig, commitHash, salt } = await client.commit(
  pool, tokenIn, vault, userAta,
  1_000_000n,    // amount (6 dec)
  102_000_000n,  // limit price
  true           // isBuy
);

// After commit window: reveal
await client.reveal(pool, tokenIn, tokenOut, 1_000_000n, 102_000_000n, salt);

// After reveal window: clear
await client.clearBatch(pool);
```

---

## Results

| Metric | AMM (x·y=k) | Lattice |
|--------|-------------|---------|
| MEV extracted | **98 bps** | **0 bps** |
| Searcher profit | **$99.74** | **$0** |
| Victim receives | 98.03 SOL | **101.01 SOL** |
| Price improvement | — | **+2 SOL (+2%)** |
| Front-running possible | Yes | **Mathematically impossible** |

---

## Comparison to Existing Solutions

| Protocol | Mechanism | MEV Protection | Uniform Price |
|----------|-----------|---------------|--------------|
| Uniswap v3 | CFMM | ❌ None | ❌ |
| CoW Protocol | Batch + solvers | ✅ Partial | ✅ |
| dYdX v4 | Order book | ⚠️ Partial | ❌ |
| **Lattice** | Commit-reveal batch | ✅ **Cryptographic** | ✅ |

Lattice's guarantee is stronger than CoW: the commit phase makes order details *cryptographically unavailable* — not just difficult to exploit, but impossible.

---

## Regulatory Compliance

See [`compliance/VARA_compliance.md`](compliance/VARA_compliance.md) for a full VARA (UAE Virtual Assets Regulatory Authority) compliance analysis.

**Key finding:** Lattice's uniform clearing price mechanism is structurally analogous to NYSE and Euronext opening auctions — well-precedented in regulated markets. As a non-custodial smart contract protocol with no controlling legal person, it likely qualifies for a DeFi carve-out under VARA and MiCA.

---

## Quickstart

### Prerequisites
- Rust + `solana-cli` 1.18+
- Anchor CLI 0.30.1
- Node.js 20+ / Yarn
- Funded Solana devnet wallet

### Run tests
```bash
cd anchor
anchor test
```

### Deploy to devnet
```bash
cd anchor
anchor deploy --provider.cluster devnet
```

### Start the demo
```bash
./start-demo.sh
```

### Run the agent
```bash
cd agent
cp .env.example .env   # add OPENROUTER_API_KEY
yarn start
```

---

## Project Structure

```
lattice/
├── anchor/           Rust on-chain program (Anchor 0.30.1)
│   ├── programs/lattice/src/
│   │   ├── commit_intent.rs
│   │   ├── reveal_intent.rs
│   │   ├── clear_batch.rs
│   │   └── state.rs
│   └── tests/lattice.ts
├── relay/            x402 payment relay (Express)
│   └── src/
│       ├── server.ts
│       └── x402.ts
├── agent/            Autonomous agent (LLM + TWAP)
│   └── src/
│       ├── brain.ts
│       ├── latticeClient.ts
│       ├── pay.ts
│       └── fragmenter.ts
├── sdk/              TypeScript client SDK
│   └── src/index.ts
├── web/              Next.js 14 demo frontend
│   ├── pages/demo.tsx
│   └── components/
├── compliance/       VARA regulatory package
│   └── VARA_compliance.md
├── keys/             Demo keypairs (devnet only)
└── start-demo.sh     One-command demo startup
```

---

## License

MIT

---

*Built for the Frontier Hackathon 2025. Program on Solana devnet: `AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV`*
