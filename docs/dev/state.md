# Votain. Current Project State

**Last updated**: 2026-07-15
**Completed milestone**: Phase A (H1–H4 + UX polish pass). All 24 screens implemented visually.
**Next milestone**: H5. Production contracts on Amoy + frontend client.

> Detailed milestone-by-milestone log lives in `docs/ai/state.md`. This file tracks module status,
> dependency versions and environment.

---

## Module status

### contracts/. STABLE (H0 complete)

| Dep | Version | Notes |
|-----|---------|-------|
| hardhat | 3.x | Latest. Migrated to HH3 config format (`defineConfig`, `plugins`) |
| `@nomicfoundation/hardhat-toolbox-mocha-ethers` | * | HH3 toolbox (replaces `hardhat-toolbox@hh2`) |
| chai | 6.x | ESM-only. Compatible with HH3 |
| `@openzeppelin/contracts` | 5.6.1 | OK |
| `@semaphore-protocol/contracts` | 4.14.2 | OK |
| ethers | 6.16.0 | OK |
| dotenv | 17.4.2 | Updated |
| typescript | 6.0.3 | Updated |
| Solidity | 0.8.35 | Latest stable |
| TypeScript target | ESNext | Bumped from ES2023 |

**Tests**: 5/5 passing ✅ (HH3 + chai v6).

**Technical debt pending (H5)**:

- Replace `MockVerifier` with official Semaphore V4 verifier.
- Add missing functions: `cancelElection`, `closeEnrollmentEarly`, `closeVotingEarly`, `publishResults`, `markVoided`.
- Add `VotingType` enum (`SIMPLE_PLURALITY`, `ABSOLUTE_MAJORITY`, `SUPERMAJORITY_TWO_THIRDS`, `WITNESS_THRESHOLD`) + `thresholdValue` field on `ElectionV4`, with per-type winner determination in `publishResults`.
- Coverage >= 80% with `solidity-coverage`.
- Deploy and verify on PolygonScan Amoy.
- Lock down `ElectionPaymaster.sponsorVote`.

**Note on Hardhat 3**: Migration completed in H0. Config is now `hardhat.config.ts` using `defineConfig` + `hardhat-toolbox-mocha-ethers`. The old `hardhat.config.cts` was deleted.

---

### backend/. STABLE (H0 complete)

| Dep | Version | Notes |
|-----|---------|-------|
| express | 5.2.x | OK |
| `@sd-jwt/core` | 0.19.0 | OK |
| `@worldcoin/idkit-core` | 4.1.6 | Updated from 4.1.2 |
| tsx | 4.22.3 | Updated from 4.21.0 |
| typescript | 6.0.3 | OK |
| `@types/node` | 25.9.1 | Updated |

**Status**: starts OK (requires `.env` with `ISSUER_PRIVATE_KEY`) ✅.

**Technical debt pending (H6)**:

- Integrate World ID Credentials via IDKit as the primary selective-disclosure source (passport NFC). Backend issuer keeps the demo fallback for users without a supported document.
- Normalise SD-JWT VC schema (`country`, `ageOver18`, `region`) across World ID Credentials and the demo issuer so the eligibility check is source-agnostic.
- Status List 2021 (`/credentials/status/:listId`).
- SD-JWT presentation endpoint (`@sd-jwt/present`).
- Tests: World ID v4 verification, replay rejection, SD-JWT round-trip.
- Rate limiting with `express-rate-limit`.

---

### frontend/. STABLE (Phase A complete)

| Dep | Version | Notes |
|-----|---------|-------|
| react | 19.2.6 | Updated |
| vite | 8.0.14 | Updated |
| tailwindcss | 4.3.0 | Updated |
| typescript | 6.0.3 | OK |
| `@zerodev/sdk` | 5.5.10 | Replaces `@biconomy/account` |
| `@zerodev/passkey-validator` | 5.6.0 | OK |
| `@zerodev/ecdsa-validator` | 5.4.9 | OK |
| `@radix-ui/react-select` | 2.3.3 | **NEW** (Phase A polish). Headless primitive for LanguageSelector |
| ethers | 6.16.0 | OK |
| `@semaphore-protocol/*` | 4.14.2 | OK |
| framer-motion | 12.40.0 | Updated |
| i18next | 26.2.0 | Updated |
| lucide-react | 1.16.0 | Updated |

**Build**: ✅ clean, no sourcemaps.
**Tests**: 9/9 unit tests passing (Vitest, jsdom). Playwright E2E scaffold in `e2e/` (excluded from Vitest).

**Technical debt pending**:

- H5. `src/lib/zerodev.ts`, `src/hooks/usePasskeys.ts`, `src/lib/contracts.ts`, `src/lib/paillier.ts`, `src/lib/semaphore.ts`.
- H5+. Code-splitting lazy-load for Semaphore WASM and Paillier.
- H4 leftover. IP-based language auto-detect (ipapi.co) not wired yet.

**Implemented screens**: all 24 from `stich.md` with hardcoded data from `src/data/seed.ts`
(6 elections covering all 6 phases and all 4 voting types). Persistent voter/organizer auth via
`src/contexts/AuthContext.tsx` (localStorage, Phase A only — replaced by real sessions in Phase B).
Auth-aware navigation (TopNav/BottomTabNav), theme-consistent scrollbars, full i18n (13 locales).

---

## License

The project is released under **AGPL-3.0** (was MIT until H0 cleanup). All `package.json` files declare `"license": "AGPL-3.0-only"`. Root `LICENSE` file contains the canonical GNU text. Strategy: dual-license, commercial licenses available for entities that cannot comply with AGPL.

---

## Environment

| Tool | Status |
|------|--------|
| Node.js | v24.14.0 |
| npm | 10.x |
| SSL (university network) | Use `NODE_OPTIONS="--use-system-ca"` for npm and npx |
| Playwright MCP | ✅ Active. `node` + full path to `@playwright/mcp` `cli.js`, `--headless`. Chromium installed in `ms-playwright/` |
| Stitch MCP | ✅ Active (HTTP transport, `stitch.googleapis.com/mcp`) |

---

## Open questions for the user

- [ ] **LaTeX template**. Is there an official ETSII/URJC template to use? Or Overleaf with a generic template? (Blocks H12.1.)
- [ ] **Free tier access**. Accounts already created for ZeroDev, Fleek, Pinata, Phala, World ID Developer Portal?

---

## Completed milestones log

| Milestone | Date | Description |
|-----------|------|-------------|
| H0 | 2026-05-23 | Bootstrap, dep upgrade, dev docs, Biconomy to ZeroDev, Hardhat 3 migration, Solidity 0.8.35, TypeScript ESNext, AGPL-3.0 relicense |
| H1 | 2026-05-25 | Design system: ~20 UI components + layout (TopNav, BottomTabNav, Footer, PageLayout), `/dev/components` showcase |
| H2 | 2026-05-25 | Public + voter screens (1–13, 23, 24) with `seed.ts` hardcoded data |
| H3 | 2026-05-25 | Organizer screens (14–20) |
| H4 | 2026-05-26 | TransactionPendingModal, full i18n (13 locales), reduced-motion, E2E scaffold |
| Phase A polish | 2026-07-15 | AuthContext (voter+organizer), auth-driven navigation, viewport layout (sticky header/pinned footer), Radix Select for LanguageSelector, themed scrollbars, i18n fixes, MemberList Select, tests green |
