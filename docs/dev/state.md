# Votain. Current Project State

**Last updated**: 2026-08-16 (relay architecture, identity vault, session-signature fix)
**Completed milestone**: Phase B (H5–H9), real integration code complete. Contracts, backend
issuer, voter + organizer flows and tally all wired and green.
**Since Phase B** (this pass): 8-phase lifecycle (`UPCOMING`/`PENDING_VOTE` added to the contract
`phase()`), **in-app tally** with a Paillier key **derived from the organizer's passkey PRF**
(nothing stored at rest; CLI kept as the auditor path), organizer display-name persistence,
custom dark `DatePicker`, phase-aware voter/organizer/public screens, and shared phase helpers.
Tests: contracts 67/67, backend 21/21, frontend 17/17; eslint clean, prod build OK.
**Next milestone**: Live Amoy deployment (pending funding the deployer key),
then Phase C (H10 IPFS/Fleek, H11 Phala TEE).

> Detailed milestone-by-milestone log lives in `docs/ai/state.md`. This file tracks module status,
> dependency versions and environment.

---

## Module status

### contracts/. STABLE (deps refreshed 2026-07-15)

| Dep | Version | Notes |
|-----|---------|-------|
| hardhat | 3.9.1 | HH3 config format (`defineConfig`, `plugins`) |
| `@nomicfoundation/hardhat-toolbox-mocha-ethers` | 3.0.7 | HH3 toolbox (replaces `hardhat-toolbox@hh2`) |
| `@openzeppelin/contracts` | 5.6.1 | OK |
| `@semaphore-protocol/contracts` | 4.14.3 | OK |
| dotenv | 17.4.2 | OK |
| typescript | 7.0.2 | Native (Go) compiler: works with HH3 toolchain |
| `@types/node` | 26.1.1 | OK |
| Solidity | 0.8.36 | Latest stable |
| TypeScript target | ESNext | |

**Tests**: 67/67 passing, including an E2E suite that checks real Groth16 proofs against the official Semaphore verifier.

**Technical debt pending (H5)**:

- Replace `MockVerifier` with official Semaphore V4 verifier.
- Add missing functions: `cancelElection`, `closeEnrollmentEarly`, `closeVotingEarly`, `publishResults`, `markVoided`.
- Add `VotingType` enum (`SIMPLE_PLURALITY`, `ABSOLUTE_MAJORITY`, `SUPERMAJORITY_TWO_THIRDS`, `WITNESS_THRESHOLD`) + `thresholdValue` field on `ElectionV4`, with per-type winner determination in `publishResults`.
- Coverage >= 80% with `solidity-coverage`.
- Deploy and verify on PolygonScan Amoy.
- Lock down `ElectionPaymaster.sponsorVote`.

**Note on Hardhat 3**: Migration completed in H0. Config is now `hardhat.config.ts` using `defineConfig` + `hardhat-toolbox-mocha-ethers`. The old `hardhat.config.cts` was deleted.

---

### backend/. STABLE (deps refreshed 2026-07-15)

| Dep | Version | Notes |
|-----|---------|-------|
| express | 5.2.1 | OK |
| `@sd-jwt/core` | 0.20.0 | **Migrated to OpenWallet Foundation.** No longer ships `@sd-jwt/types` (removed as dep); `SDJWTConfig`/`JwtPayload` are now imported from `@sd-jwt/core` directly. `issue()` round-trip smoke-tested ✅ |
| `@worldcoin/idkit-core` | 4.2.1 | OK |
| tsx | 4.23.1 | OK |
| typescript | 7.0.2 | Native compiler, tsc clean |
| `@types/node` | 26.1.1 | Narrowed `crypto.createPublicKey` overloads: `keys.ts` now derives the public key from the private key PEM export |

**Status**: starts OK (requires `.env` with `ISSUER_PRIVATE_KEY`) ✅.

**Technical debt pending (H6)**:

- Integrate World ID Credentials via IDKit as the primary selective-disclosure source (passport NFC). Backend issuer keeps the demo fallback for users without a supported document.
- Normalise SD-JWT VC schema (`country`, `ageOver18`, `region`) across World ID Credentials and the demo issuer so the eligibility check is source-agnostic.
- Status List 2021 (`/credentials/status/:listId`).
- SD-JWT presentation endpoint (`@sd-jwt/present`).
- Tests: World ID v4 verification, replay rejection, SD-JWT round-trip.
- Rate limiting with `express-rate-limit`.

---

### frontend/. STABLE (Phase B, chain-connected)

| Dep | Version | Notes |
|-----|---------|-------|
| react / react-dom | 19.3.0 | OK |
| vite | 8.3.0 | OK |
| tailwindcss | 4.3.3 | OK |
| typescript | 7.0.2 | The native compiler, in all four packages. Cost: no ESLint, `typescript-eslint` throws on TS >= 7. See `frontend/DEVELOPMENT.md`, `No linter` |
| `@radix-ui/react-select` | 2.3.3 | Headless primitive for LanguageSelector |
| country-flag-emoji-polyfill | 0.1.8 | Flag emoji font for Windows/Chromium |
| ethers | 6.17.0 | OK |
| `@semaphore-protocol/*` | 4.14.3 | OK |
| `@worldcoin/idkit` / `idkit-core` | 4.2.3 / 4.2.4 | OK, hook typechecks |
| `@sd-jwt/core` | 0.20.1 | OWF migration (see backend note) |
| `@sd-jwt/present` | 0.19.0 | **No stable 0.20 yet**: revisit when wiring presentation in H6/H7 |
| framer-motion | 13.2.0 | OK |
| i18next / react-i18next | 26.4.2 / 17.0.13 | OK |
| react-router-dom | 7.18.3 | OK |
| lucide-react | 1.45.0 | OK |
| recharts | 3.10.1 | OK |
| vitest / jsdom | 5.0.0 / 30.0.1 | OK |
| `@testing-library/jest-dom` | 7.0.1 | Matchers and their types come from the `/vitest` subpath since v7 |
| hardhat | 3.16.0 | contracts |
| `@selfxyz/core` / `common` | 1.2.0-beta.2 / 0.0.10 | Newest published. Its `latest` tag points at an older release, so `npm outdated` reports a downgrade |
| `@types/node` | 26.5.1 | Same: the `latest` tag lags at 22.x |

**Build**: ✅ clean, no sourcemaps.
**Tests**: 17/17 unit tests passing (Vitest, jsdom), covering identity-vault sealing and the Paillier ballot encoding. Playwright E2E scaffold in `e2e/` (excluded from Vitest).

**Technical debt pending**:

- H5. Done: `src/lib/{contracts,paillier,semaphore,relay,identityVault,logs}.ts`.
- H5+. Code-splitting lazy-load for Semaphore WASM and Paillier.
- H4 leftover. IP-based language auto-detect (ipapi.co) not wired yet.

**Implemented screens**: all 24 from `stich.md` with hardcoded data from `src/data/seed.ts`
(6 elections covering all 6 phases and all 4 voting types). Persistent voter/organizer auth via
`src/contexts/AuthContext.tsx` (localStorage, Phase A only, replaced by real sessions in Phase B).
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
- [ ] **Free tier access**. Accounts already created for Fleek, Pinata, Phala, World ID Developer Portal? (ZeroDev no longer needed.)

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
| Deps refresh | 2026-07-15 | All 3 modules to latest: Hardhat 3.9.1, TS 7.0.2 (contracts+backend), sd-jwt 0.20 (OWF migration, types re-exported from core), IDKit 4.2, ethers 6.17, Vite 8.1.4. Frontend TS pinned at 6.0.3 (typescript-eslint constraint). All tests green |
| Relay + vault | 2026-08 | ERC-4337 dropped for an own relay contract (a per-voter smart account publicly linked enrollment to ballot, and hosted paymasters cannot fund gas per organizer). Encrypted identity vault so one Semaphore identity unlocks from several passkeys, plus `rotateMember` recovery after losing them all. Session cookies now signature-checked. Contracts 66/66 (including a real-Groth16 E2E suite), backend 21/21, frontend 17/17 |
| H5–H9 (Phase B) | 2026-07 | Real integration. Contracts rewritten (on-chain Semaphore group, VotingType, lifecycle, locked paymaster, 94% cov); frontend chain client (`lib/{contracts,paillier,semaphore,zerodev,voting,organizer}.ts`, ZeroDev passkeys, chain-aware hooks); backend on-chain registrar + SD + Status List 2021 + `/present` + rate limiting; `scripts-tally/` homomorphic tally + IPFS. New `viem` (frontend) + `ethers`/`express-rate-limit` (backend) deps. Contracts 28/28, backend 5/5, frontend 9/9. Live Amoy deploy pending user key. Branch `phase-b/real-integration` |
