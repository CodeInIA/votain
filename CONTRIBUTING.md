# Votain — Developer Guide

Votain is an **end-to-end verifiable, anonymous, coercion-resistant voting dApp** on Polygon Amoy (testnet). Bachelor's thesis project (TFG).

## Read first

- `docs/PLAN.md` — full iterative plan (milestones, current state, operating rules)
- `docs/dev/state.md` — current milestone, pinned versions, technical debt
- `docs/dev/conventions.md` — binding development conventions
- `docs/dev/architecture.md` — on-chain / off-chain / frontend / tally diagram
- `docs/dev/glossary.md` — Semaphore, nullifier, SD-JWT, ERC-4337, Paillier, TEE, etc.

## Monorepo structure

```
votain/
├── contracts/        # Solidity 0.8.35 + Hardhat 3 + Semaphore V4
├── backend/          # Node.js Express — SD-JWT issuer + World ID v4
├── frontend/         # React 19 + Vite + Tailwind 4 + ZeroDev v5
├── scripts-tally/    # (to create) off-chain tally with paillier-bigint
├── docs/
│   ├── PLAN.md       # Iterative plan (source of truth for progress)
│   ├── dev/          # Developer documentation
│   └── progress/     # Playwright screenshots per milestone (H<n>/screens/<name>/)
└── memoria/          # LaTeX thesis (parallel track from H0)
```

## Quick commands

```bash
# Contracts
cd contracts && npx hardhat test
cd contracts && npx hardhat compile

# Backend
cd backend && npm run dev        # requires .env with ISSUER_PRIVATE_KEY

# Frontend
cd frontend && npm run dev       # http://localhost:5173
cd frontend && npm run build
cd frontend && npm test
```

## Development conventions

1. **NEVER git commit / git push / destructive operations** without explicit review. After each milestone, list changes before committing.
2. **Phase A (H1-H4)**: hardcoded data in `src/data/seed.ts`. NO technical mocks.
3. **Phase B (H5-H9)**: real integration against backend + Amoy contracts. No mocks.
4. **Always latest versions**: `npm-check-updates` on all 3 modules before each milestone.
5. **Always free tier**: no paid services, no "free with card required".
6. **Responsive required**: every new screen validated at mobile (375×667), tablet (768×1024), desktop (1440×900).
7. **After each milestone**: update `docs/dev/state.md`.
8. **All code comments and .md files must be in English**.
9. **Each milestone gets its own git branch**: create `hN/<slug>` before committing (e.g. `h0/bootstrap`, `h1/design-system`).

## Environment variables

- `backend/.env.example` — template with all issuer vars
- `frontend/.env.example` — template with all frontend vars

## External references

- Full PRD: `C:\Users\virus\OneDrive\UNI\4\TFG\copilot-instructions.md`
- UI design (24 screens): `C:\Users\virus\OneDrive\UNI\4\TFG\stich\stich.md`
