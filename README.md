# Votain

> End-to-end verifiable, anonymous, coercion-resistant voting dApp on Polygon Amoy.

Votain is a Bachelor's thesis project (TFG) demonstrating how modern cryptographic primitives (Zero-Knowledge Proofs, Verifiable Credentials, Homomorphic Encryption and meta-transaction relaying) can be combined into a voting system where every voter can verify their ballot is counted, no one can be coerced, and no central authority can tamper with results.

## Why Votain

| Property | How it is achieved |
|----------|--------------------|
| **End-to-end verifiable** | Every vote is a Paillier ciphertext stored on-chain; the tally is published with an IPFS audit trail anyone can re-execute |
| **Anonymous** | Semaphore V4 zero-knowledge proofs hide voter identity inside the eligible-voters group |
| **Coercion resistant** | Per-nullifier nonce lets a coerced voter silently override a prior ballot. Only the highest-nonce vote counts |
| **Sybil resistant** | World ID v4 proof of personhood, bound to a per-election scope |
| **Gasless for voters** | Ballots are relayed through `ElectionPaymaster`, reimbursed from the organizer's own gas tank; voters never hold tokens |
| **Unlinkable on chain** | Every voter's call arrives from the same relay contract, so the sender address cannot tie an enrollment to a ballot |
| **Decentralized deployment** | Frontend on IPFS (Fleek), issuer in Intel TDX TEE (Phala), contracts on Polygon Amoy |

## Architecture overview

```
User (passkey + World ID)
    ├── React 19 + Vite + Tailwind 4             ◄──── IPFS (Fleek)
    │
    ├── SD-JWT issuance ── Backend (Node + Express)  ◄──── Phala TEE
    │                      Verifies World ID, issues VC
    │
    └── relayed tx ─────── Polygon Amoy
                           ElectionFactory · ElectionV4
                           ElectionPaymaster · PlatformRegistry
                           Semaphore V4 Verifier
                                                  │
                                                  ▼
                           Tally (Paillier homomorphic sum): in-app in the
                           browser, or the off-chain CLI (auditor path)
                           → Result JSON pinned on IPFS (Pinata, CLI)
                           → publishResults(cid, tally) on-chain
```

Full diagram in [`docs/dev/architecture.md`](docs/dev/architecture.md).

## Monorepo layout

```
votain/
├── contracts/         # Solidity 0.8.36 + Hardhat 3 + Semaphore V4
├── backend/           # Node.js Express SD-JWT issuer (target: Phala TEE)
├── frontend/          # React 19 + Vite (target: IPFS / Fleek)
├── scripts-tally/     # off-chain Paillier tally + IPFS publication (auditor CLI)
├── docs/
│   ├── PLAN.md        # iterative milestone plan (source of truth)
│   ├── dev/           # developer documentation
│   │   ├── architecture.md
│   │   ├── conventions.md
│   │   ├── glossary.md
│   │   └── state.md   # current milestone, versions, technical debt
│   └── progress/      # per-milestone screenshots and demos
└── memoria/           # LaTeX thesis (parallel track)
```

## Tech stack

**Contracts**: Solidity 0.8.36, Hardhat 3, ethers v6, OpenZeppelin 5, [`@semaphore-protocol/contracts`](https://semaphore.pse.dev/) 4.x, ERC-2771 context.

**Backend**: Node.js 24, Express 5, [`@sd-jwt/core`](https://github.com/openwallet-foundation-labs/sd-jwt-js) (EdDSA / Ed25519), [`@worldcoin/idkit-core`](https://docs.world.org/) v4, tsx.

**Frontend**: React 19, Vite (Rolldown), Tailwind CSS 4, [`@semaphore-protocol/{identity,group,proof}`](https://semaphore.pse.dev/), [`paillier-bigint`](https://github.com/juanelas/paillier-bigint), [`@worldcoin/idkit`](https://docs.world.org/), i18next (13 languages), framer-motion.

Pinned versions live in [`docs/dev/state.md`](docs/dev/state.md).

## Quick start

```bash
# Contracts (5/5 tests passing on Hardhat 3)
cd contracts
npm install
npx hardhat test
npx hardhat compile

# Backend (requires .env with ISSUER_PRIVATE_KEY, see backend/.env.example)
cd backend
npm install
npm run dev                          # http://localhost:3000

# Frontend
cd frontend
npm install
npm run dev                          # http://localhost:5173
npm run build
```

> **Windows / corporate network**: prepend `NODE_OPTIONS="--use-system-ca"` to any `npm install` or `npm-check-updates` command to avoid SSL chain errors.

## Project status

Currently in **Phase A, visual design**. See [`docs/PLAN.md`](docs/PLAN.md) for the full iterative plan.

| Milestone | Description | Status |
|-----------|-------------|--------|
| H0 | Bootstrap, dependency upgrade, dev docs | ✅ |
| H1 | Design system and base components | 🟡 in progress |
| H2 to H4 | 24 screens (visual, hardcoded data) | ⏳ |
| H5 | Production contracts + chain client | ⏳ |
| H6 | Backend issuer feature complete | ⏳ |
| H7, H8 | Real voter and organizer integration | ⏳ |
| H9 | Tally + IPFS results | ⏳ |
| H10 | Frontend on IPFS (Fleek) | ⏳ |
| H11 | Backend on Phala TEE | ⏳ |
| H12, H13 | Thesis and defense | ⏳ |

## Documentation

- [`CONTRIBUTING.md`](CONTRIBUTING.md). Developer guide, monorepo conventions.
- [`docs/PLAN.md`](docs/PLAN.md). Milestone plan and operating rules.
- [`docs/dev/architecture.md`](docs/dev/architecture.md). Full system architecture.
- [`docs/dev/conventions.md`](docs/dev/conventions.md). Coding conventions, color tokens, i18n keys.
- [`docs/dev/glossary.md`](docs/dev/glossary.md). Semaphore, nullifier, SD-JWT, relaying, Paillier, TEE.
- [`docs/dev/state.md`](docs/dev/state.md). Current state, pinned versions, technical debt.
- Per-module guides: [`contracts/DEVELOPMENT.md`](contracts/DEVELOPMENT.md), [`backend/DEVELOPMENT.md`](backend/DEVELOPMENT.md), [`frontend/DEVELOPMENT.md`](frontend/DEVELOPMENT.md).

## License

Votain is released under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [`LICENSE`](LICENSE) for the full text.

This means you are free to use, modify and redistribute Votain, but if you run a modified version as a network-accessible service you must publish your source. **Commercial licenses without AGPL obligations are available**. Contact the author.

## Author

Sergio Barrios Paz. Bachelor's thesis (TFG), Universidad Rey Juan Carlos (ETSII), 2026.
