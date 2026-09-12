# Votain. Developer Guide

Votain is an **end-to-end verifiable, anonymous, coercion-resistant voting dApp** on Polygon Amoy (testnet). Bachelor's thesis project (TFG).

## Read first

- `docs/PLAN.md`. Full iterative plan (milestones, current state, operating rules).
- `docs/dev/state.md`. Current milestone, pinned versions, technical debt.
- `docs/dev/conventions.md`. Binding development conventions.
- `docs/dev/architecture.md`. On-chain / off-chain / frontend / tally diagram.
- `docs/dev/glossary.md`. Semaphore, nullifier, SD-JWT, ERC-4337, Paillier, TEE, etc.

## Monorepo structure

```
votain/
├── contracts/        # Solidity 0.8.37 + Hardhat 3 + Semaphore V4
├── backend/          # Node.js Express SD-JWT issuer + World ID v4
├── frontend/         # React 19 + Vite + Tailwind 4 + ethers v6
├── scripts-tally/    # off-chain tally with paillier-bigint (to create)
├── docs/
│   ├── PLAN.md       # iterative plan (source of truth for progress)
│   ├── dev/          # developer documentation
│   └── progress/     # Playwright screenshots per milestone (H<n>/screens/<name>/)
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
2. **Phase A (H1 to H4)**: hardcoded data in `src/data/seed.ts`. NO technical mocks.
3. **Phase B (H5 to H9)**: real integration against backend and Amoy contracts. No mocks.
4. **Always latest versions**. Run `npm-check-updates` on all 3 modules before each milestone.
5. **Always free tier**. No paid services, no "free with card required".
6. **Responsive required**. Every new screen validated at mobile (375×667), tablet (768×1024), desktop (1440×900).
7. **After each milestone**: update `docs/dev/state.md`.
8. **All code comments and `.md` files must be in English**.
9. **No em dashes or hyphen-as-clause-separator in documentation**. Use periods, commas or colons. Hyphens stay only in compound words (e.g. "end-to-end"), technical identifiers (e.g. "ERC-4337"), version numbers, file paths and command flags.
10. **Each milestone gets its own git branch**. Create `hN/<slug>` before committing (e.g. `h0/bootstrap`, `h1/design-system`).

## Environment variables

- `backend/.env.example`. Template with all issuer vars.
- `frontend/.env.example`. Template with all frontend vars.

## External references

- Full PRD: `C:\Users\virus\OneDrive\UNI\4\TFG\copilot-instructions.md`
- UI design (24 screens): `C:\Users\virus\OneDrive\UNI\4\TFG\stich\stich.md`
