# Votain — Current Project State

**Last updated**: 2026-05-23
**Completed milestone**: H0 — Bootstrap, dependency upgrade, docs
**Next milestone**: H1 — Design system and base components

---

## Module status

### contracts/ — STABLE (H0 complete)

| Dep | Version | Notes |
|-----|---------|-------|
| hardhat | 3.x | Latest — migrated to HH3 config format (`defineConfig`, `plugins`) |
| @nomicfoundation/hardhat-toolbox-mocha-ethers | * | HH3 toolbox (replaces hardhat-toolbox@hh2) |
| chai | 6.x | ESM-only — compatible with HH3 |
| @openzeppelin/contracts | 5.6.1 | OK |
| @semaphore-protocol/contracts | 4.14.2 | OK |
| ethers | 6.16.0 | OK |
| dotenv | 17.4.2 | Updated |
| typescript | 6.0.3 | Updated |

**Tests**: 5/5 passing ✅ (HH3 + chai v6)

**Technical debt pending (H5)**:
- Replace `MockVerifier` with official Semaphore V4 verifier
- Add missing functions: `cancelElection`, `closeEnrollmentEarly`, `closeVotingEarly`, `publishResults`, `markVoided`
- Coverage >= 80% with `solidity-coverage`
- Deploy and verify on PolygonScan Amoy
- Lock down `ElectionPaymaster.sponsorVote`

**Note on Hardhat 3**: Migration completed in H0. Config is now `hardhat.config.ts` using `defineConfig` + `hardhat-toolbox-mocha-ethers`. The old `hardhat.config.cts` can be deleted.

---

### backend/ — STABLE (H0 complete)

| Dep | Version | Notes |
|-----|---------|-------|
| express | 5.2.x | OK |
| @sd-jwt/core | 0.19.0 | OK |
| @worldcoin/idkit-core | 4.1.6 | Updated from 4.1.2 |
| tsx | 4.22.3 | Updated from 4.21.0 |
| typescript | 6.0.3 | OK |
| @types/node | 25.9.1 | Updated |

**Status**: starts OK (requires `.env` with `ISSUER_PRIVATE_KEY`) ✅

**Technical debt pending (H6)**:
- Selective disclosure attributes in SD-JWT (`_sd` array: `country`, `ageOver18`, `region`)
- Status List 2021 (`/credentials/status/:listId`)
- SD-JWT presentation endpoint (`@sd-jwt/present`)
- Tests: World ID v4 verification, replay rejection, SD-JWT round-trip
- Rate limiting with `express-rate-limit`

---

### frontend/ — STABLE (H0 complete)

| Dep | Version | Notes |
|-----|---------|-------|
| react | 19.2.6 | Updated |
| vite | 8.0.14 | Updated |
| tailwindcss | 4.3.0 | Updated |
| typescript | 6.0.3 | OK |
| @zerodev/sdk | 5.5.10 | **NEW** — replaces @biconomy/account |
| @zerodev/passkey-validator | 5.6.0 | **NEW** |
| @zerodev/ecdsa-validator | 5.4.9 | **NEW** |
| ethers | 6.16.0 | OK |
| @semaphore-protocol/* | 4.14.2 | OK |
| framer-motion | 12.40.0 | Updated |
| i18next | 26.2.0 | Updated |
| lucide-react | 1.16.0 | Updated |

**Build**: ✅ (651ms, 568KB JS + 821KB WASM)
**Tests**: 4 tests failing due to missing i18n setup in vitest (pre-existing, fix in H1)

**Technical debt pending**:
- H1: Fix Onboarding tests (i18n mock in vitest setup)
- H1: Base UI components (Card, Badge, Modal, etc.)
- H2-H4: 22 remaining screens from stich.md
- H5: `src/lib/zerodev.ts`, `src/hooks/usePasskeys.ts`, `src/lib/contracts.ts`
- H4: Code-splitting lazy-load for Semaphore WASM + Paillier

**Implemented screens**:
- `/` Landing ✅
- `/voter/onboarding` Onboarding (5 steps + World ID QR) ✅
- Stubs: `/voter/dashboard`, `/organizer/auth`, `/discover`, `/how-it-works`

---

## Environment

| Tool | Status |
|------|--------|
| Node.js | v24.14.0 |
| npm | 10.x |
| SSL (university network) | Use `NODE_OPTIONS="--use-system-ca"` for npm/npx |
| Playwright MCP | Pending installation and verification |
| Stitch MCP | Not available — fallback: read `stich.md` directly |

---

## Open questions for the user

- [ ] **LaTeX template**: is there an official ETSII/URJC template to use? Or Overleaf with a generic template? (Blocks H12.1)
- [ ] **Free tier access**: accounts already created for ZeroDev, Fleek, Pinata, Phala, World ID Developer Portal?

---

## Completed milestones log

| Milestone | Date | Description |
|-----------|------|-------------|
| H0 | 2026-05-23 | Bootstrap, dep upgrade, docs, Biconomy→ZeroDev, Hardhat 3 migration |
