# Votain. Current Project State

**Last updated**: 2026-05-25
**Completed milestone**: H0. Bootstrap, dependency upgrade, dev docs.
**Next milestone**: H1. Design system and base components.

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

### frontend/. STABLE (H0 complete)

| Dep | Version | Notes |
|-----|---------|-------|
| react | 19.2.6 | Updated |
| vite | 8.0.14 | Updated |
| tailwindcss | 4.3.0 | Updated |
| typescript | 6.0.3 | OK |
| `@zerodev/sdk` | 5.5.10 | **NEW**. Replaces `@biconomy/account` |
| `@zerodev/passkey-validator` | 5.6.0 | **NEW** |
| `@zerodev/ecdsa-validator` | 5.4.9 | **NEW** |
| ethers | 6.16.0 | OK |
| `@semaphore-protocol/*` | 4.14.2 | OK |
| framer-motion | 12.40.0 | Updated |
| i18next | 26.2.0 | Updated |
| lucide-react | 1.16.0 | Updated |

**Build**: ✅ (651ms, 568KB JS + 821KB WASM).
**Tests**: 4 tests failing due to missing i18n setup in vitest (pre-existing, fix in H1).

**Technical debt pending**:

- H1. Fix Onboarding tests (i18n mock in vitest setup).
- H1. Base UI components (Card, Badge, Modal, etc.).
- H2 to H4. 22 remaining screens from `stich.md`.
- H5. `src/lib/zerodev.ts`, `src/hooks/usePasskeys.ts`, `src/lib/contracts.ts`.
- H4. Code-splitting lazy-load for Semaphore WASM and Paillier.

**Implemented screens**:

- `/` Landing ✅.
- `/voter/onboarding` Onboarding (5 steps + World ID QR) ✅.
- Stubs: `/voter/dashboard`, `/organizer/auth`, `/discover`, `/how-it-works`.

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
