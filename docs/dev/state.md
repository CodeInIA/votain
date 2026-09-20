# Votain. Current Project State

**Last updated**: 2026-09-21 (signing in on a phone survives the trip to World App or the wallet)
**Completed milestone**: Phase B (H5–H9) except H9's last mile. Contracts, backend issuer and
both user flows are wired and green; the tally runs on both paths, but only the auditor CLI
pins to IPFS and the in-app path publishes an empty CID. See H5, H6 and H9 in `PLAN.md`.
**Since Phase B**: 8-phase lifecycle (`UPCOMING`/`PENDING_VOTE` added to the contract
`phase()`), **in-app tally** with a Paillier key **derived from the organizer's wallet signature**
(nothing stored at rest; CLI kept as the auditor path), organizer display-name persistence,
custom dark `DatePicker`, phase-aware voter/organizer/public screens, and shared phase helpers.
**This pass**: signing in on a phone. Both roles sign in by LEAVING — the voter to World App,
the organizer to their wallet — and a backgrounded tab is something the system may discard, so
what came back was a cold start that had thrown away work already done. The voter's proof
request is opened by the backend now and named in an httpOnly cookie, because the SDK cannot
rebuild a request from its id and the bridge key lives inside its WASM: a reload collects the
proof instead of losing it. The organizer's session was never lost at all — WalletConnect
persists it — but the mount effect read a module variable the reload had emptied and never
asked for it back. `return_to` stays off, now for one reason rather than two: it misroutes to
an installed PWA. See "Signing in on a phone" in `architecture.md`.
**Found by measuring, not by reading**: the resume effect aborted its own in-flight fetch in a
StrictMode cleanup and left its once-only guard set, so "at most once" had become "never" — and
every unit test passed while that was true. A `StrictMode` wrapper does not reproduce it here
(counted: 1 mount, 0 cleanups), so the test file says so rather than pretending to cover it.
**Also corrected**: `tallyKey.ts` had described its key as coming from a passkey's PRF secret
long after that was changed to a wallet signature.
Tests: contracts 185/185, backend 142/142, frontend 560/560.
**Next milestone**: Live Amoy deployment (pending funding the deployer key). It must carry
`PLATFORM_ATTESTER_ADDRESS`, the key the backend signs enrolments with: without it the
factory deploys elections that enrol the old, publicly linkable way, which looks entirely
normal from every screen. `deploy.ts` now refuses to deploy off the local chain without it
unless `ALLOW_PUBLIC_ENROLMENT=1` says so out loud.
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
| `@types/node` | 26.5.1 | OK |
| Solidity | 0.8.37 | Latest stable |
| TypeScript target | ESNext | |

**Tests**: 185/185 passing, including an E2E suite that checks real Groth16 proofs against the official Semaphore verifier.

**Technical debt pending**:

- Coverage with `solidity-coverage`. NOT installed: the 94% figure once claimed for
  Phase B is not reproducible from this tree, and no coverage tool is configured.
- Deploy and verify on PolygonScan Amoy. Blocked on funding the deployer key, and the
  single largest gap in the project: nothing here has run against a live chain.

**Done since this list was written**, verified against the tree on 2026-09-18: the official
`SemaphoreVerifierV4` is what `deploy.ts` uses off the local chain (`MockVerifier` survives
only for local runs, unless `USE_REAL_VERIFIER=true`); `cancelElection`, `closeEnrollmentEarly`,
`closeVotingEarly`, `publishResults` and `markVoided` all exist on `ElectionV4`; and so do the
`VotingType` enum and `thresholdValue`. "Lock down `ElectionPaymaster.sponsorVote`" is obsolete
rather than done: that function no longer exists, the paymaster relays through `relayEnroll`
and moves money through `deposit`/`reserve`/`release`/`withdraw`.

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

**Tests**: 126/126 in 23 suites (`node --import tsx --test`, not Vitest). World ID v4
verification, replay rejection, SD-JWT round-trip, Status List 2021, the eligibility policy,
the attester, the identity vault and the organizer domains.

**Technical debt pending**:

- SD-JWT presentation endpoint (`@sd-jwt/present`). NOT done: the package is not a dependency
  of this module. Phase B's log claims a `/present` endpoint that is not in the tree.
- No central configuration boundary. `env.ts` is two lines (`dotenv.config()`) and
  `process.env` is read in 68 places across ~20 variables, of which 4 throw when missing.
  `ELIGIBILITY_ATTESTER_PRIVATE_KEY`, a private key, is read in 8 of them. A missing variable
  surfaces mid-request rather than at boot, which will matter most inside the TEE.

**Done, or overtaken**: Status List 2021 is live at `/credentials/status/:listId`, and rate
limiting is applied in `index.ts` (120/min on `/api`, 10/min on the tighter route). "Integrate
World ID Credentials via IDKit as the primary selective-disclosure source" was not done and is
not owed: `@selfxyz/core` was chosen instead, because World ID Credentials does not cover
Spanish documents. See the eligibility table in `PLAN.md`. World ID is still what proves
personhood; Self is what discloses attributes.

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
**Tests**: 537/537 unit tests in 66 files passing (Vitest, jsdom), covering the voter identity lifecycle (minting, sealing, the PRF read-back proof, rotation, adding further passkeys), the per-election identities that keep enrolments unlinkable, noticing an expired session, WalletConnect return handling, the Paillier ballot encoding, the i18n plural tables, how the lists are paged and ordered, the schedule timeline both roles read, turnout counted in people rather than ballots, the three words a new voter has to put back before their phrase is accepted, the twelve boxes they type it into on the way back, the hat following the page without fighting the header for it, the saved list holding on to a row somebody has just unsaved, and the member list naming each election once instead of once per member. Playwright E2E scaffold in `e2e/` (excluded from Vitest).

**Enrolling stopped naming the enrolled** (2026-09-16): what goes into an election's
merkle tree is a commitment derived from the voter's secret and that election's address,
authorised by a platform signature and deduplicated by a tag only the server can compute.
The chain no longer shows that the same person joined two elections: measured on the seeded
local chain, 8 commitments across 38 elections (one of them in 17) became 69, each in
exactly one, none of them known to the registry. The privacy page was corrected to match.
See `Who joined what, and why the chain no longer says it` in `architecture.md`.

**Gas, votes and deadlines** (2026-09-16): gas is reserved per election and cannot be
withdrawn while voters may still need it; the wallet is crossed only at `deposit` and
`withdraw`, everything else moves between the tank's two columns; an organizer can give up
the power to move any deadline, and the voter is told either way; what a ballot costs is
measured from past relays instead of assumed. See `Who pays for a vote` and `A power an
organizer can give up` in `architecture.md`.

**Reading lists** (2026-09-15): no screen hydrates the whole platform any more. Discover pages
what it reads; the organizer's and the voter's lists resolve through the chain's own event
indexes and are read complete so their totals stay exact; the receipt verifier and the vote
history read digests so they can stay complete without the cost. See `How a list is read` in
`architecture.md`. The remaining unbounded read is one person's own set: an organizer with
thousands of their own elections still has them all read, which would need on-chain aggregates
to close.

**Technical debt pending**:

- Code-splitting lazy-load for Semaphore WASM and Paillier.
- IP-based language auto-detect (ipapi.co) not wired yet.
- `lib/semaphore.ts` is 1090 lines, 33 exports and imported by 18 files. It holds at least
  five separable jobs: the identity lifecycle, this device's storage policy, registry reads,
  the vote proof, and per-election vote bookkeeping. A split into `identityLifecycle`,
  `deviceStorage` and `voteProof` behind the current module as a facade would leave the 18
  importers untouched.
- No linter. `typescript-eslint` does not support TS 7, so `tsc` is the only static check.
  See `frontend/DEVELOPMENT.md`.

**Implemented screens**: all 24, reading the chain. `src/data/seed.ts` is no longer what the
screens show: it is the DEMO FALLBACK, used only when no contract addresses are configured, and
`isChainConfigured()` decides. When it is in use a banner says so on every screen, because sample
elections that look like real ones are worse than none.

The seed set is 6 elections covering the phases and all 4 voting types. `AuthContext` is no
longer the Phase A localStorage stand-in: it reconciles its flags against the backend's httpOnly
cookie through `lib/backend.ts`, and exposes `sessionChecked` so a guard does not bounce a valid
session before the answer arrives. Auth-aware navigation (TopNav/BottomTabNav), theme-consistent
scrollbars, full i18n (13 locales, Arabic right-to-left).

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
- [ ] **Free tier access**. Accounts already created for Fleek, Pinata, Phala, World ID Developer Portal? Pinata is the one that blocks closing H9 from inside the app rather than from the CLI.

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
| Saved elections + session hardening | 2026-09-17 | **Saved elections**: `PlatformRegistry.setPreferences`, one sealed blob per human holding a list per ROLE, AES-GCM under a key derived from the voter's own secret, so the chain stores what nobody but them can read; measured at 149 bytes for two elections and 59,368 gas a change (`scripts/e2e-preferences.ts`). Bookmark on the cards and the election page, "saved" chip in the participation band, `/organizer/saved` in both navigation bars. **Session**: `isRevoked` stopped reading the whole revocation set on every authenticated request, the cookie became `__Host-` prefixed and Secure in development, CORS is opt in, and holder binding is written up as future work in `architecture.md`. **Defects**: linking a passkey now drops the local phrase, a session with no identity is routed instead of silently failing, the gas page no longer loops, the top bar measures itself instead of guessing a breakpoint, one clear-filters control in one corner, and the candidate count no longer disappears on signing in |
| Voter identity flow | 2026-09-15 | Two passes. **WalletConnect**: every organizer action works from a phone (idempotent provider, `rpcMap`, relay recovery on return, cancellation handled everywhere). **Voter identity**: registration on chain no longer rides on having a passkey, so an authenticator that cannot evaluate PRF no longer leaves a voter off the registry; the phrase modal became a two-step screen at `/voter/identity` that will not move on until the words are copied, and nothing mints a phrase outside it; recovery reuses those two steps and stopped demanding a passkey (`clearVault`); `MyDevices` became `MyPasskeys` and can link more than one; the PRF read-back proof is no longer skipped across authenticators. Contracts untouched. Backend 107/107, frontend 253/253 |
| H5–H9 (Phase B) | 2026-07 | Real integration. Contracts rewritten (on-chain Semaphore group, VotingType, lifecycle); frontend chain client (`lib/{contracts,paillier,semaphore,voting,organizer}.ts`, chain-aware hooks); backend on-chain registrar + SD + Status List 2021 + rate limiting; `scripts-tally/` homomorphic tally and IPFS pin. Live Amoy deploy pending user key. Branch `phase-b/real-integration`. **Four claims in the original entry did not survive an audit on 2026-09-18 and have been struck from it**: "94% cov" (no coverage tool is configured), "`/present`" (`@sd-jwt/present` is not a backend dependency), "locked paymaster" (it refers to `sponsorVote`, a function that no longer exists), and `zerodev.ts` + `viem`, both removed when ERC-4337 was dropped for the own relay. H9 is therefore NOT complete: the tally is real on both paths, but only the auditor CLI pins to IPFS, and the in-app path publishes an empty CID |
