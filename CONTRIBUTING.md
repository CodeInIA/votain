# Votain. Developer Guide

Votain is an **end-to-end verifiable, anonymous, coercion-resistant voting dApp** on Polygon Amoy (testnet). Bachelor's thesis project (TFG).

## Read first

- `docs/PLAN.md`. Full iterative plan (milestones, current state, operating rules).
- `docs/dev/state.md`. Current milestone, pinned versions, technical debt.
- `docs/dev/conventions.md`. Binding development conventions.
- `docs/dev/architecture.md`. On-chain / off-chain / frontend / tally diagram.
- `docs/dev/glossary.md`. Semaphore, nullifier, SD-JWT, ElGamal, Groth16, TEE, etc.

## Monorepo structure

```
votain/
├── contracts/        # Solidity 0.8.37 + Hardhat 3
├── backend/          # Node.js Express SD-JWT issuer + World ID v4
├── frontend/         # React 19 + Vite + Tailwind 4 + ethers v6
├── circuits/         # ballot + tally circuits, trusted setup, generated verifiers
├── scripts-tally/    # off-chain tally, proof and --verify (auditor CLI)
├── docs/
│   ├── PLAN.md       # iterative plan (source of truth for progress)
│   ├── dev/          # developer documentation
│   └── screenshots/  # Playwright captures used by the root README
└── memoria/          # LaTeX thesis (parallel track from H0)
```

## Quick commands

```bash
# Contracts
cd contracts && npx hardhat test
cd contracts && npx hardhat compile

# Backend (requires .env with ISSUER_PRIVATE_KEY)
cd backend && npm run dev

# Frontend
cd frontend && npm run dev       # http://localhost:5173
cd frontend && npm run build
cd frontend && npm test
```

## Development conventions

1. **NEVER `git commit` / `git push` / destructive operations** without explicit review. After each milestone, list changes before committing.
2. **Real data, loud fallback**: screens read the chain and the backend. `src/data/seed.ts` is the demo fallback used only when no contract addresses are configured, and a banner says so on screen while it is. NO technical mocks.
3. **A screen that needs a new endpoint or contract function gets it in the same pass**, not a TODO in another module.
4. **Always latest versions**. Run `npm-check-updates` on all 3 modules before each milestone.
5. **Always free tier**. No paid services, no "free with card required".
6. **Responsive required**. Every new screen validated at mobile, tablet and desktop. Beware of testing only at 390px: it is a narrow iPhone, and a 6.8" Android is 412 to 448 CSS pixels wide, which is where several layouts differ.
7. **After each milestone**: update `docs/dev/state.md`.
8. **All code comments and `.md` files must be in English**.
9. **No em dashes or hyphen-as-clause-separator in documentation**. Use periods, commas or colons. Hyphens stay only in compound words (e.g. "end-to-end"), technical identifiers (e.g. "ERC-4337"), version numbers, file paths and command flags.
10. **Work on `dev`. Merges into `main` are the author's to make.** `main` is the deployment branch: a push there runs `checks` and, when the backend changed, publishes an image and can move `api.votain.app` between its two hosts. Committing to `main` therefore deploys. Milestone work may still use its own `hN/<slug>` branch off `dev` (e.g. `h0/bootstrap`).

## Environment variables

- `backend/.env.example`. Template with all issuer vars.
- `frontend/.env.example`. Template with all frontend vars.

## External references

- Full PRD: `C:\Users\virus\OneDrive\UNI\4\TFG\copilot-instructions.md`
- UI design (24 screens): `C:\Users\virus\OneDrive\UNI\4\TFG\stich\stich.md`
