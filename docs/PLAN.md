# Votain TFG — Iterative Completion Plan

> **This is the canonical copy of the plan** for any future AI agent to continue without prior context.

## Context

**Votain** is an end-to-end verifiable, anonymous, coercion-resistant voting dApp on Polygon Amoy. The architecture combines:

- **Smart contracts** Solidity (Semaphore V4, ERC-2771/ERC-4337) in `contracts/`
- **Backend issuer** Node.js emitting Verifiable Credentials (SD-JWT) after validating World ID, in `backend/`. Will be deployed on **decentralized TEE** (Phala Network) at the end.
- **Frontend** React + Vite with **ZeroDev (Account Abstraction + Passkeys)**, homomorphic Paillier, and `@semaphore-protocol/*` in `frontend/`. Will be published on **IPFS with CI/CD (Fleek)**.
- **Tally script** off-chain to filter votes by nullifier and decrypt results.

### Confirmed stack decisions

| Piece | Decision | Replaces | Reason |
|-------|----------|----------|--------|
| Account Abstraction | **ZeroDev SDK v5** (free tier) | Biconomy v4 | Biconomy v4 had very outdated deps; ZeroDev v5 actively maintained, Passkeys support, ethers v6 aligned |
| Frontend deploy | **Fleek (IPFS) free tier with GitHub CD** | Vercel | Keeps "Hosted on IPFS" badge from `stich.md`, immutable verifiable CID |
| Backend issuer deploy | **Phala Network free tier (decentralized TEE) + MPC future work** | Centralized VPS | Issuer signs VCs — TEE with on-chain attestation upholds the TFG's trust principles |
| IPFS tally pinning | **Pinata free tier (1 GB)** | — | Sufficient for JSON audit trail |
| LaTeX thesis | **Overleaf free or local** | — | University template to confirm |
| Everything else (World ID Portal, Polygon Amoy, GitHub Actions, Hardhat, Vitest, Playwright, Zotero) | Free / open source | | |

**Cross-cutting constraint**: NOTHING with recurring cost. If a service claims free tier but requires a card, evaluate alternative first.

### Verified state as of 2026-05-23

| Area | Done | Missing |
|------|------|---------|
| **Contracts** | 4 contracts + `MockVerifier` + 5 tests + `deploy.ts` | Official Semaphore verifier, lock-down `sponsorVote`, screen functions (cancel, closeEarly, publishResults), Amoy deploy, PolygonScan verification, coverage ≥80% |
| **Backend** | `verify-human`, `rp-signature`, `/me`, `/logout`, SD-JWT EdDSA, httpOnly cookies | Selective VC attributes, Status List 2021, tests, rate limiting, Phala TEE deploy |
| **Frontend** | `Landing`, `Onboarding` (5 steps + World ID QR), 13-language i18n, layout, 2 base UI components | The **24 remaining screens** from `stich.md`, complete design system, ZeroDev + Passkeys, crypto hooks, real integrations |
| **Tally** | Nothing | `scripts-tally/tally-votes.ts` |
| **Thesis** | `tfg.tex` placeholder | Full ETSII structure |
| **Defense** | Nothing | Slides + demo video + rehearsals |

### Mandatory responsive + essential MCPs

The dApp **must look and work well on both PC and mobile**. This is an acceptance requirement for each screen, not a nice-to-have.

| MCP | Usage | Milestone needed |
|-----|-------|-----------------|
| **Playwright MCP** | Screenshots at mobile (375×667), tablet (768×1024), desktop (1440×900) | H1-H4 + H7-H8 |
| **Stitch MCP / stich.md** | Consult original designs before implementing each screen. Fallback: read `stich.md` from `C:\Users\virus\OneDrive\UNI\4\TFG\stich\stich.md` | All Phase A (H1-H4) |
| **Chrome DevTools MCP** | Inspect layouts, overflow, WCAG contrast | H1-H4 |
| **Filesystem MCP** | Read assets from `OneDrive/UNI/4/TFG/stich/` | H1-H4 |

**Mandatory procedure for each new screen**:
1. Read `stich.md` → understand layout, states, copy, palette.
2. Implement.
3. Playwright MCP → screenshots at 3 viewports → save to `docs/progress/H<n>/screens/<name>/`.
4. Review: overflow / buttons <44px / insufficient contrast → iterate.

### User decisions on process

- **Order**: visual design of all 24 screens first (hardcoded data), then real integration.
- **Everything free tier**.
- **Latest versions always**. Dependency audit before each milestone.
- **Agent NEVER does `git commit`**. User reviews diffs and commits.
- **Goal**: July 2026 (extraordinary), September 2026 if needed.
- **Scope**: complete per `copilot-instructions.md` (PRD) and `stich.md` (24 screens).

### Important distinction: "hardcoded data" vs "mocks"

- **Phase A**: hardcoded data in `src/data/seed.ts` or inline. NO technical mocks (fake Promise.resolve, fake interfaces).
- **Phase B**: real integration. No mocks. If a screen needs a new endpoint/function, add it in the same milestone.

---

## Philosophy: iterative and validatable

Each milestone produces a concrete artifact that the user validates before advancing.

**Validation**: live demo → screenshots in `docs/progress/H<n>/` → textual confirmation "validated H<n>".

**After each milestone**: update `docs/dev/state.md` + list changes for commit.

---

## Milestones

### Milestone 0 — Bootstrap, dependency upgrade, AI docs ✅ COMPLETED 2026-05-23

- [x] Dependency audit and upgrade (contracts, backend, frontend)
- [x] Biconomy → ZeroDev migration in frontend/package.json
- [x] Root CLAUDE.md + 3 sub-CLAUDE.md
- [x] docs/PLAN.md + docs/dev/{architecture,glossary,conventions,state}.md
- [x] .env.example in backend/ and frontend/
- [ ] Confirm LaTeX thesis template — PENDING user response
- [ ] Verify free tier access: ZeroDev, Fleek, Pinata, Phala, World ID
- [ ] MCPs: Playwright MCP verified at 3 viewports

---

## PHASE A — Visual design of all 24 screens (H1-H4)

> Screens use hardcoded data. Navigation works. Blockchain/backend actions → toast "integration pending".

### Milestone 1 — Design system and base components (3-5 days)

**Goal**: building blocks aligned with `stich.md` (Liquid Glass iOS 26, dark mode, cold accent palette).

- [ ] Design tokens: `tailwind.config.ts`, `index.css` (colors, typography, radii, blur, mesh background)
- [ ] UI components in `src/components/ui/`: Button (review variants), Card, Badge (8 states + Verified blockchain + IPFS + Tie + Role), Modal/Dialog, Input/Textarea/Select, RadioCard (min 48px), Checkbox/Switch, Skeleton, Spinner/ProgressDots/Stepper, Toast, Countdown (timezone-aware), BarChart (horizontal), Avatar/IdentityCommitment, Dropdown/LanguageSelector, EligibilityChecklistRow, GasBalanceWidget, BlockchainBadge/IPFSBadge
- [ ] Layout components: Header (role indicator), Footer, BottomTabNav (mobile), TopNav (desktop)
- [ ] Fix Onboarding tests (i18n setup in vitest)
- [ ] `/dev/components` showcase page (DEV only)

**Validation**: `/dev/components` shows all components in their variants. Mobile + desktop responsive. Lighthouse a11y ≥90.

---

### Milestone 2 — Public + Voter screens (Screens 1-3, 4-13, 23, 24) (6-9 days)

- [ ] `src/data/seed.ts` — 6 elections (all phases), candidates, fake voters
- [ ] Screen 1: Discovery (card grid, filters, search, empty states)
- [ ] Screen 2: Public Preview (details, countdown, read-only candidates, auth overlay CTA)
- [ ] Screen 3: Public Results (bar chart, glowing winner, tie state, export JSON)
- [ ] Screen 23: How It Works (4 step cards)
- [ ] Screen 4: Onboarding step 0 (language + IP auto-detect)
- [ ] Screen 5: World ID Verification (functional — already implemented in backend)
- [ ] Screen 6: Re-verification UI states
- [ ] Screen 7: Voter Election List (phase-aware CTAs, countdown red <1h)
- [ ] Screen 8: Election Detail Enrollment (hardcoded eligibility checklist)
- [ ] Screen 9: Election Detail Active (candidate selector, blank vote)
- [ ] Screen 10: ZK Proof Generation (3-step overlay, simulated setTimeout)
- [ ] Screen 11: Vote Confirmation (animated checkmark, hardcoded reference)
- [ ] Screen 12: Change Vote (selector + modal)
- [ ] Screen 13: Voter History (seed data)
- [ ] Screen 24: Verify Receipt (input + seed data)

**Validation**: full public+voter flow on mobile and desktop, coherent with `stich.md`. Video in `docs/progress/H2/`.

---

### Milestone 3 — Organizer screens (Screens 14-20) (5-7 days)

- [ ] Screen 14: Passkey + Wallet Setup (step UI, WRONG NETWORK state)
- [ ] Screen 15: Organizer Dashboard (glass cards, hardcoded metrics)
- [ ] Screen 16: Create Election (4-step wizard, timeline, dynamic candidates)
- [ ] Screen 17: Election Detail Organizer (phase-gated controls, passkey confirm modals)
- [ ] Screen 18: Gas Management (color-coded balance, deposit form)
- [ ] Screen 19: Registered Members (truncated identity commitments, search)
- [ ] Screen 20: Organizer Profile (edit display name, passkeys list)

**Validation**: full organizer flow. Actions trigger correct modals but respond with toast "integration pending". Mobile + desktop responsive.

---

### Milestone 4 — Shared screens + full i18n + visual polish (Screens 21, 22) (3-4 days)

- [ ] Screen 21: Error & Empty States (14 variants)
- [ ] Screen 22: Transaction Pending Modal (pending/success/failed simulated)
- [ ] i18n audit: all strings from H2-H3 translated to 13 JSON files
- [ ] IP-based language auto-detect (ipapi.co free, 1k req/day)
- [ ] Visual polish: 24 screens coherent
- [ ] Framer Motion animations + motion-reduce respect
- [ ] WCAG 2.1 AA (Lighthouse / axe)
- [ ] Lighthouse ≥85 performance, code-splitting lazy WASM/Paillier
- [ ] E2E tests with Playwright: smoke test all 24 screens
- [ ] Clean up TODOs, console.logs

**Validation**: full dApp ✅. Major checkpoint → move to real integration.

> 🛑 **Major checkpoint — Phase A complete**: dApp has all 24 screens with final design, functional navigation, and i18n. Next phase: real integration.

---

## PHASE B — Real integration (H5-H9)

### Milestone 5 — Production contracts + frontend client (4-6 days)

Part A — Contracts: official Semaphore verifier, new functions, coverage ≥80%, Amoy deploy + PolygonScan verify
Part B — Frontend: `src/lib/contracts.ts`, `src/lib/zerodev.ts`, `src/hooks/usePasskeys.ts`, `src/lib/semaphore.ts`, `src/lib/paillier.ts`

### Milestone 6 — Complete backend issuer (3-4 days)

Selective disclosure, Status List 2021, SD-JWT presentation, tests, rate limiting

### Milestone 7 — Voter flow real integration (5-7 days)

World ID + Enrollment + real ZK Proof + Vote + History

### Milestone 8 — Organizer flow real integration (5-7 days)

Real WebAuthn Passkey + Create Election tx + phase-gated controls

### Milestone 9 — Tally script + IPFS results (3-4 days)

`tally-votes.ts`, Pinata, `publishResults`, Privacy Quorum

---

## PHASE C — Decentralized deployments (H10-H11)

### Milestone 10 — Frontend on IPFS + Fleek CD (1-2 days)
### Milestone 11 — Backend on Phala TEE (4-6 days)

---

## PHASE D — Thesis + Defense (H12-H13)

### Milestone 12 — LaTeX thesis (~80-120 pp.) — parallel from H0
- H12.1 (parallel H0-H2): template + chapters 1-2
- H12.2 (parallel H3-H5): chapters 3-4
- H12.3 (parallel H6-H8): chapter 5 + start 6
- H12.4 (parallel H9-H11): chapters 6-7
- H12.5 (post H11): chapters 8-10 + appendices

### Milestone 13 — Defense (4-5 days, final week)

Slides Beamer/Slidev 15-20 slides, demo video, timed rehearsals

---

## Agent operating rules (BINDING)

1. **NEVER `git commit` / `git push`**. Only list changes for the user to commit.
2. **Phase A**: hardcoded data. NO technical mocks.
3. **Phase B**: real integration. No mocks.
4. **Always latest versions**: `npm-check-updates` before each milestone.
5. **Always free tier**: evaluate alternative before using any paid service.
6. **After each milestone**: update `docs/dev/state.md`.
7. **Each new screen in Phase A**: Playwright at 3 viewports. Screenshots in `docs/progress/H<n>/screens/<name>/`.
8. **All code comments and .md files must be in English**. No Spanish (or other language) in source code or AI docs.
9. **Each milestone gets its own git branch**. Before committing any work for milestone N, create branch `hN/<slug>` from the current state (e.g., `h0/bootstrap`, `h1/design-system`, `h2/voter-screens`). The user creates the branch and commits; the agent only lists the changes.
