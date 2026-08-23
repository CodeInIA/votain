# Votain: Agent State

## Current milestone: post-Phase-B lifecycle + tally + UX pass ✅, next up: live Amoy deploy

### Post-Phase-B pass (2026-07)
- Contract `phase()` now returns 8 states: added `UPCOMING` (before enrollment) and
  `PENDING_VOTE` (enrollment closed, voting not open, only when `enrollEnd < voteStart`).
  Fixed the early-close boundary (`< voteEnd`, was `<=`). +3 phase tests → 31/31.
- **In-app tally**: organizer computes + publishes results from the app (browser Paillier
  decrypt → wallet-signed `publishResults`). Key is **derived from the passkey PRF** with a
  public per-election `keyNonce` in metadata: nothing stored at rest, re-derivable across
  synced devices; export + offline CLI kept as backups. Deterministic Paillier keygen reuses
  `bigint-crypto-utils` primality (`lib/tallyKey.ts`), validated standalone.
- Organizer display name persisted (`votain_organizer_name`), used as `created by`.
- Create-election: optional separate enrollment window, unsaved-changes guard, custom dark
  `DatePicker` (Radix Popover) with time + native mobile fallback.
- UX fixes: sign-in vs register routing, phase-driven CTAs, logged-in voter routing, sign-out
  to landing, affirmative success toasts. Shared `lib/phase.ts` + `StatusNotice`; MemberList
  dropdown → `SelectMenu`; eslint 0 problems (Fast-Refresh module splits).

## Completed milestones

### H0: Bootstrap (partial)
- Dependencies audited and upgraded across all 3 modules
- Biconomy removed → ZeroDev packages added to frontend
- MCPs configured: Playwright MCP, Stitch MCP (project ID: 7436293275873814220)
- `docs/ai/` directory created

### H1: Design system & base components ✅ (2026-05-25)
All 9 tests pass. Production build clean. No TS errors.

**UI components** (`frontend/src/components/ui/`): Avatar, Badge, BarChart, BlockchainBadge,
Button, Card, Countdown, ElectionCard, EligibilityRow, GasWidget, Input (+ Textarea + Select),
LanguageSelector (Radix Select), Modal (portal), RadioCard, Skeleton, Spinner, Stepper, Switch,
Toast, TransactionPendingModal (H4)

> Removed as unused during polish: ActionCard, Checkbox, MiniBarChart.

**Layout** (`frontend/src/components/layout/`): BottomTabNav, TopNav, Footer, PageLayout

### H2: Public + Voter screens ✅ (2026-05-25)
All screens implemented with hardcoded data from `src/data/seed.ts`:
- Discover, ElectionPreview, ElectionResults, HowItWorks, VerifyReceipt
- VoterElections, ElectionDetail, ZkProofGeneration, VoteConfirmation, ChangeVote,
  VoterHistory, ReVerification

### H3: Organizer screens ✅ (2026-05-25)
- OrganizerAuth, OrganizerDashboard, CreateElection, ElectionManagement,
  GasManagement, MemberList, OrganizerProfile

### H4: Shared screens + i18n + polish ✅ (2026-05-26)

**TransactionPendingModal** (`frontend/src/components/ui/TransactionPendingModal.tsx`)
- 3 states: pending (spinner + relayer steps), success (green checkmark), failed (red X)
- Integrated into ElectionDetail (enroll) and CreateElection (deploy) with 2.5s simulation
- Showcased in `/dev/components` (DEV only)

**i18n**
- All 13 locales (en, es, fr, de, pt, it, nl, zh, ar, ru, hi, ja, ko) updated with `tx.*` namespace
- Fixed duplicate `"common"` key in `en.json` (invalid JSON, now clean)
- All 13 files validated: 28 top-level keys, parse OK

**Reduced-motion support**
- `MotionGlobalConfig.skipAnimations` set globally in `main.tsx` when `prefers-reduced-motion: reduce`
- CSS `@media (prefers-reduced-motion: reduce)` rule added in `index.css`
- `TransactionPendingModal` uses `useRef`-based reduced-motion check for spring animations

**E2E tests** (`frontend/e2e/smoke.spec.ts`)
- Playwright config for desktop (1440×900), tablet (768×1024), mobile (375×667)
- 24-screen smoke suite: navigate, wait for hydration, assert no crash + no JS errors
- Install: `npx playwright install chromium` (network SSL issue blocked install in this session)
- Run: `npm run test:e2e`

**Build**: clean, 528ms, no TS errors

### UX polish pass ✅ (2026-05-26 → 2026-07-15)

**Auth model** (`frontend/src/contexts/AuthContext.tsx`, new)
- Persistent voter + organizer sessions in localStorage (`votain_voter_logged_in`, `votain_organizer_logged_in`)
- `voterSignOut` / `organizerSignOut` clear storage; World ID verify (`useWorldIdVerify`) sets voter login
- Landing `/` auto-redirects by role: voter → `/voter/elections`, organizer → `/organizer/dashboard`
- Removed the H0-era `/api/me` backend check on Landing (Phase A is local-only; it also broke sign-out)

**Navigation**
- `TopNav` and `BottomTabNav` are driven ONLY by auth state (the page `role` prop is ignored):
  public sees Discover; voter sees Discover/Elections/History; organizer sees Dashboard/Discover/Members/Gas
- Profile is a top-right avatar icon (desktop + mobile); logo click routes to the role's home
- Language selector removed from header/footer: lives in both profile pages
- "How it works" moved from header to Footer + profile pages (mobile-only card with Terms/Privacy)
- TopNav visible on mobile (logo + wordmark + profile); nav links desktop-only; tabs on mobile

**Layout**
- `PageLayout`: `h-dvh` flex column, sticky header, scrollable `<main>`, pinned Footer (desktop-only), BottomTabNav (mobile)
- Footer on all app pages via PageLayout default; Landing keeps its own full Footer
- New route `/voter/profile` (VoterProfile page: verification status, verify-receipt/re-verify links, language, legal links, sign out)

**Component correctness**
- `LanguageSelector` rebuilt on **@radix-ui/react-select** (portal, popper positioning + collision flip,
  keyboard nav, ARIA). Fixes: dropdown under sibling cards (backdrop-filter stacking context),
  non-rounded selected item, Chromium compositing artifact (content is now opaque, no backdrop-blur)
- `MemberList` raw `<select>` → design-system `Select`
- Theme-consistent scrollbars in `index.css` (thin, rounded, `--color-outline-variant`); real `.scrollbar-none` utility (was a no-op class)
- `cursor-pointer` on all raw `<button>` elements across pages
- Removed pointless back arrows (MemberList); OrganizerAuth got onboarding-style round back button + no footer

**i18n**: added `nav.dashboard/members/gas`, `landing.my_elections`, `common.all`,
`election.ends_in/vote_now`, `reverify.reason1-3` to all 13 locales; fixed `discover.results_count` interpolation

**Tests/config**: `Landing.test.tsx` footer assertion updated; `vite.config.ts` excludes `e2e/**` from Vitest
(9/9 unit tests green; production build clean)

### Dependency refresh ✅ (2026-07-15, after Phase A merge to dev)

All three modules upgraded to latest (`npm-check-updates`), verified green:

- **contracts**: Hardhat 3.9.1, TypeScript 7.0.2, Semaphore contracts 4.14.3, Solidity 0.8.36 (config + all pragmas), compiles clean, 5/5 tests pass
- **backend**: `@sd-jwt/core` 0.20.0 (project moved to OpenWallet Foundation, `@sd-jwt/types`
  no longer exists as a dep; `SDJWTConfig`/`JwtPayload` now import from `@sd-jwt/core`),
  IDKit-core 4.2.1, TypeScript 7.0.2, `@types/node` 26 (required a `crypto.createPublicKey`
  fix in `utils/keys.ts`: derive public key from private PEM export). `issue()` smoke-tested
- **frontend**: Vite 8.1.4, React 19.2.7, Tailwind 4.3.2, ethers 6.17, IDKit 4.2,
  react-router 7.18.1, i18next 26.3.6: tsc clean, 9/9 tests, build OK
  - ⚠️ TypeScript **pinned at 6.0.3**: `typescript-eslint@8.64` peer-requires `<6.1.0`
  - ⚠️ `@sd-jwt/present` stays 0.19.0 (no stable 0.20 published): revisit in H6/H7

---

## Phase A: COMPLETE ✅

All 24 screens implemented visually with hardcoded seed data. Full i18n for 13 languages.
Navigation works across all routes. Actions that need blockchain fire toast or simulated TX modal.

**Commit**: `feat(frontend): Phase A, design system (H1), 24 screens (H2+H3), i18n 13 languages`
  + `feat(frontend): H4, TransactionPendingModal, i18n tx namespace, reduced-motion, E2E scaffold`

---

## Phase B: Real integration ✅ CODE COMPLETE (2026-07, branch `phase-b/real-integration`)

Implemented and green: contracts 28/28, backend 5/5, frontend 9/9, all typechecks + builds
clean. Remaining step is a live Amoy deployment (needs the user's funded key + Pinata
accounts: see "Pending user actions").

### H5: Contracts production-ready + frontend client ✅
**Contracts** (`ElectionV4` rewritten):
- On-chain Semaphore group (LeanIMT via PoseidonT3): `enroll(commitment)` gated to
  PlatformRegistry-verified members; `castVote` validates the merkle root against the tree
  (fixes the "any root accepted" hole), 1h grace for recently-superseded roots.
- `VotingType` enum + `thresholdValue`; per-type outcome computed on-chain in `publishResults`.
- Lifecycle: `cancelElection`, `closeEnrollmentEarly`, `closeVotingEarly`, `markVoided`,
  `publishResults(cid, tally[])`. Terminal-state guards + `phase()` view.
- `voteCiphertext` is `bytes` (Paillier ciphertexts exceed uint256); pubSignals apply
  Semaphore's hash-to-field (`keccak >> 8`) to message+scope so official JS proofs verify.
- Paillier public key + metadata JSON stored on-chain per election.
- `ElectionPaymaster.sponsorVote` locked to configured EntryPoint v0.7 + trusted forwarder
  (`setSponsors`, onlyOwner); added `withdraw`.
- Official `SemaphoreVerifierV4` (Groth16) deployable; MockVerifier only for unit tests.
- 28 tests, **94.4% line coverage**. `deploy.ts` deploys PoseidonT3 (deterministic CREATE2),
  writes `contracts/deployments/<net>.json` AND mirrors it to `frontend/src/lib/deployments/`.

**Frontend client libs** (`src/lib/`):
- `deployments.ts`: resolves addresses from manifest glob or VITE_* env; `isChainConfigured()`.
- `contracts.ts`: ethers v6 clients + human-readable ABIs (factory/election/paymaster/registry).
- `paillier.ts`: homomorphic ballot encoding (base-1e6 packing, blank = last option).
- `semaphore.ts`: identity persistence, group from events, `computeNullifier` (Poseidon2, no
  throwaway proof), `generateVoteProof` (point order matches ISemaphoreVerifier calldata).
- `zerodev.ts` + `hooks/usePasskeys.ts`: Kernel v3.1 passkey smart accounts, sponsored UserOps.
- `hooks/useOrganizerWallet.ts`: injected EOA + Amoy enforcement (add/switch chain).

### H6: Backend issuer ✅
- `verify-human` registers `(nullifier, identityCommitment)` in PlatformRegistry on-chain
  (`chain/registrar.ts`; skipped gracefully if unconfigured).
- SD-JWT selective-disclosure attrs (`country`, `ageOver18`, `region`) via `sd/issuer.ts`.
- Status List 2021 revocation (`status/statusList.ts`) + `credentialStatus` on every VC.
- `routes/credentials.ts`: status list publication, admin revoke, issuer public key, `/present`
  (SD-JWT presentation verify + revocation/expiry check).
- `express-rate-limit` (global 120/min, verify-human 10/min). 5 tests.

### H7: Real voter flow ✅
Chain-aware hooks (`useElections`, `useElection`) serve on-chain data when configured, seed
otherwise. Discover/VoterElections/Preview/Detail/Results wired. Enroll = sponsored UserOp;
ZkProofGeneration runs the real encrypt→proof→submit pipeline (`lib/voting.ts`); Confirmation
shows the real tx + reference. History from VoteCast events (candidate hidden, anonymity).
World ID verify creates the Semaphore identity and sends its commitment to the issuer.

**Security hardening (2026-07-18)**: the Semaphore identity is derived on demand from a
WebAuthn PRF passkey secret (`lib/passkeyPrf.ts`): nothing sensitive at rest, XSS-proof;
localStorage identity only as fallback when PRF is unsupported (never migrated once used).
AuthContext reconciles the localStorage session flags against `/api/me` (voter, httpOnly
cookie is source of truth) and `eth_accounts` (organizer): spoofed flags get cleared.
Known limitation for the thesis: the organizer's Paillier private key still lives in
localStorage; production would seal it to a passkey the same way.

### H8: Real organizer flow ✅
OrganizerAuth = MetaMask + Amoy enforcement. CreateElection deploys via factory with a freshly
generated Paillier keypair (private key → localStorage; `lib/organizer.ts`). ElectionManagement
runs real phase-gated txs. Gas deposit + balance real. Members from MemberEnrolled events.
Dashboard filtered to the connected organizer.

### H9: Tally script ✅ (`scripts-tally/`)
`tally-votes.ts`: VoteCast queryFilter → max-nonce-per-nullifier dedup (coercion resistance) →
homomorphic Paillier sum → decrypt + unpack → privacy-quorum guard → per-type outcome →
auditable JSON → optional Pinata pin (`--pin`) + `publishResults` on-chain (`--publish`).

## Environment rebuild (2026-08-16, after the dev laptop was lost)

- `https://rpc-amoy.polygon.technology` is **dead** (no DNS record). Replaced everywhere.
  Tenderly (`polygon-amoy.gateway.tenderly.co`) is the only free Amoy endpoint that serves
  `eth_getLogs` over the full block range, which every `queryFilter` call needs since none of
  them pass a `fromBlock`. drpc and publicnode cap it at 10000 blocks and would silently
  truncate member lists, vote history and the tally, so they are used only where the code
  writes but never reads logs (contract deploys, backend registrar).
- `TRUSTED_FORWARDER` resolved to `0x…dEaD`. ZeroDev is ERC-4337, not ERC-2771: the Kernel
  smart account is the direct `msg.sender` of `enroll`/`castVote`, and `_msgSender()` only
  affects organizer-only functions, where organizers sign with MetaMask. A burn address keeps
  `_msgSender() == msg.sender`. The previous fallback (unset → deployer address) would have let
  the deployer key impersonate any organizer.
- `deploy:amoy` now passes `--build-profile production`; it was silently deploying unoptimized
  bytecode, 17% more expensive and leaving `ElectionFactory` at 21091 of the 24576-byte limit.
- New `scripts/estimate-deploy-cost.ts` (`npm run estimate:amoy`): replays the deploy on the
  in-process network, prices the gas against the live Amoy gas price, and reports the shortfall
  against the configured `PRIVATE_KEY` balance. Full deploy is ~0.368 POL at the 30 gwei floor;
  ~0.090 POL per election, ~0.004 POL per enrollment.

## Multi-device voter identity (2026-08-16)

Requirement: a voter must be able to vote from any of their devices, each with its
own passkey. That cannot mean one Semaphore identity per passkey. At vote time the
election only sees a Semaphore nullifier derived from the identity secret, so a
human holding two active identities would cast two ballots that no contract could
correlate. Anonymity and multiple independent identities per human are mutually
exclusive.

Design: ONE identity per human, unlockable from every passkey.

- **`lib/identityVault.ts`** seals the Semaphore secret per passkey:
  HKDF-SHA256(PRF) → AES-256-GCM, blob = `iv ‖ ciphertext`. The issuer stores only
  ciphertext, so it still cannot compute a voter's nullifiers or link a ballot.
- **`backend/src/identity/vault.ts` + `routes/identity.ts`**: `GET/POST/DELETE
  /api/identity/vault`, authenticated by the SD-JWT session cookie. The commitment
  is pinned on first write; a second one returns 409. On-chain registration moved
  here from `verify-human`, which now only verifies World ID and sets the cookie.
- **`passkeyPrf.ts`**: new `assertPrf(credentialIds, salt)`. An empty list means
  discoverable credentials, which is what lets a synced passkey: or the user's
  phone over WebAuthn's hybrid/QR transport: answer on a brand new device. The old
  code always looked the credential up by an id cached in localStorage, so clearing
  site data or opening another browser silently minted a new identity and locked
  the voter out permanently.
- **`semaphore.ts`**: `getOrCreateIdentity()` resolves through the vault (unlock,
  or mint on first use); `enrollThisDevice()` adds the current device's passkey.
- **`components/voter/MyDevices.tsx`** in the voter profile lists passkeys, adds
  the current device and unlinks others (never the last one). `devices.*` keys in
  all 13 locales.

Contracts, for the case where the secret is genuinely lost:

- `PlatformRegistry` gained `nullifierOf` / `commitmentOf` and `rotateMember`,
  which revokes the old commitment in the same tx that activates the new one, so
  active identities per human never exceeds one. String `require`s became custom
  errors.
- `ElectionV4.enroll` now dedupes by HUMAN (`enrolledHumans`, resolved via
  `registry.nullifierOf`) instead of by commitment, so rotating mid-election cannot
  buy a second leaf and therefore a second ballot. Costs ~25k extra gas per enroll,
  paid by the ZeroDev sponsor.

Tests: contracts 41/41, backend 11/11, frontend 14/14.

## ERC-4337 dropped for an own relay contract (2026-08-16)

Two independent findings killed the ZeroDev / account-abstraction path.

**1. It leaked voter identity.** `voting.ts` sent both `enroll` and `castVote` from the
same Kernel smart account, and a UserOperation's `sender` is public. Anyone could read
`enroll(commitment_C)` and `castVote(nullifier_N)` from one address, link C to N, and via
`PlatformRegistry.nullifierOf` back to the human. The Semaphore proof hid which member of
the tree voted while the transport layer published it. Ballot *choice* stayed secret
(Paillier), but *who voted and how many times* became attributable, which also degraded
coercion resistance.

**2. Hosted paymasters cannot do multi-tenant sponsorship.** ZeroDev funds gas per project,
billed to the project owner by card or prepaid credits, with no on-chain deposit a third
party can pay into. The organizer's deposit could never have reached it: `depositFor` sent
POL to our own `ElectionPaymaster`, where `sponsorVote` was never called by anything.

**The fix**: `ElectionPaymaster` became a relay hub. `relayEnroll` / `relayVote` call the
election and reimburse the caller from `gasBalance[organizerOf[election]]` in the same
transaction. Every voter's call now arrives from that one contract, so the sender reveals
nothing, and organizers genuinely fund their own elections.

- Relaying is permissionless: the ZK proof is the authorisation, and an invalid one reverts
  so the relayer eats their own gas. `maxGasPrice` caps reimbursement against drain.
- `ElectionFactory.createElection` calls `paymaster.registerElection(election, organizer)`;
  `deploy.ts` calls `setFactory` (replacing `setSponsors`).
- Backend: `chain/relayer.ts` + `routes/relay.ts`. `/relay/enroll` requires the session
  (enrollment is public anyway, and it blunts spam); **`/relay/vote` is deliberately
  unauthenticated**, because requiring a session would tell the issuer which voter cast
  which ballot, the exact link the design exists to destroy.
- Frontend: `lib/relay.ts` replaces `lib/zerodev.ts` (deleted, along with the unused
  `hooks/usePasskeys.ts`). Dependencies `@zerodev/*` and `viem` removed.
- Passkeys are untouched and still essential: they hold the Semaphore identity secret via
  the vault. They were never what made voting gasless.

Tests: contracts 47/47 (7 new paymaster relay tests), backend 17/17, frontend 14/14.

## Session cookies were not signature-checked (2026-08-16)

`/api/me` decoded the SD-JWT payload without verifying it, so `header.{"sub":"…"}.garbage`
authenticated as any voter. Since the vault write path registers the commitment on chain,
an attacker could have enrolled unlimited fake voters. Fixed in `auth/session.ts`
(signature + expiry + revocation), with 6 regression tests.

## Identity recovery after losing every passkey (2026-08-23)

Losing the only device holding a passkey used to be terminal: the World ID nullifier was
already spent in the registry, so the voter could never register again.

`POST /api/identity/recover` closes it. Authorised by a FRESH World ID proof, never by the
session cookie: this rebinds the identity a human votes with, so a stolen session must not
be enough to take one over. Nobody can produce a proof carrying someone else nullifier
without being that person.

- `chain/registrar.ts` gained `rotateOnChain`, `identity/vault.ts` gained `resetVault`
  (the old blobs seal a secret nobody holds any more), and the frontend entry point is
  `/voter/re-verify`, previously a placeholder that only fired a toast.
- The chain rotates before the vault is touched. The reverse order would leave the vault
  pointing at a commitment the registry does not honour.
- What the voter regains: elections they had not joined. What they never regain: elections
  they HAD enrolled in, even without voting, and their old receipts. Neither is fixable.
  `ElectionV4` cannot know whether they already voted there, because the ballots are
  anonymous, so refusing is the only safe answer. The UI states both costs before the
  voter commits.
- `registrar.ts` also stopped reporting a phantom success: a known human presenting a NEW
  commitment used to get `registered: true` with nothing written, and the failure surfaced
  much later as `NotPlatformVerified`. The vault now checks the chain before writing.

## Open decision: the no-PRF fallback does not work on Amoy

`getOrCreateIdentity` falls back to a localStorage identity when the device has no PRF
passkey, but that path never calls `putVaultEntry`, which is the only thing that registers a
commitment on chain. So on Amoy such a voter gets an identity nobody recognises and fails at
`enroll`. It only works on the local chain, where `ensureLocalRegistration` registers
directly.

Two ways out, not yet chosen: give the fallback its own registration endpoint (keeps
accessibility, accepts a weaker key store) or drop it and require a passkey with a clear
message. See the organizer-side precedent in `OrganizerAuth`, which now detects a missing
authenticator up front.

## Two-thirds supermajority generalised to a candidate field (2026-08-23)

`SUPERMAJORITY_TWO_THIRDS` used to require exactly two options, because
`_computeOutcome` hardcoded `tallyResults[0]`: the rule was "option 0 must reach two
thirds", not "the winner must". That is a real voting system (conclaves, many boards)
that the implementation simply could not express, and it left `THRESHOLD_NOT_MET`
unreachable for this type.

Now the behaviour splits on the option count:

- **Two options**: unchanged proposition semantics. Index 0 IS the motion, so falling
  short is `REJECTED` whichever way the rest of the ballots fell.
- **Three or more**: qualified-majority election. The leader must still clear two
  thirds or nobody is elected (`THRESHOLD_NOT_MET`). No tie check is needed above the
  bar, since two candidates each holding two thirds would need four thirds between them.

`WITNESS_THRESHOLD` keeps the two-option cap: it counts confirmations of one
proposition, so a wider ballot would have nothing to confirm. The wizard follows suit,
`isYesNo` now covers only that type.

The `PLAN.md` voting-type table also said thresholds were measured against "total
eligible voters". They never were: `_computeOutcome` uses the ballots cast, and the
blank vote counts towards that total, so a blank makes a threshold harder to reach
rather than being ignored. Table corrected and the denominator documented.

## Two i18n placeholders were rendering literally (2026-08-23)

`election.reference` was `"Reference: {{ref}}"` but the caller passed no variables and
appended the hash itself, so the UI showed `Reference: {{ref}}: 0xac27…`. Fixed by
making the key a bare label: the hash needs `font-mono`, so it belongs in the JSX.

An audit of every placeholder against its call site found the same shape in
`voter_elections.urgent`. Fixed the other way, by passing `count` instead of
prepending it, which also makes real i18next pluralisation possible later.

## Members filter ignored the election it was given (2026-08-23)

`ElectionManagement` links to `/organizer/members?election=<id>`, but `MemberList`
initialised its filter with `useState('all')` and never read the URL. The filter is now
derived from the query string and written back to it, so the view is shareable and
survives a reload. Note the organizer route guard drops the query string when it
redirects to login, so a filtered link followed while logged out still loses it.

## Pending user actions (block a live Amoy run, not code)
- Fund the deployer key with ~1.5 to 2 POL (`npm run estimate:amoy` reports the gap), set
  `PRIVATE_KEY` in `contracts/.env` → `npm run deploy:amoy` → verify on PolygonScan.
- After deploying: copy `PlatformRegistry` from `deployments/amoy.json` into backend `.env`
  (`REGISTRY_ADDRESS`) and set `REGISTRAR_PRIVATE_KEY` to the same deployer key (it owns the
  registry). Without this, voters fail `enroll` with `NotPlatformVerified`.
- Pinata JWT for the tally CLI: deferred, the in-app tally path does not need it.
- ZeroDev project RPC + passkey server URL: ✅ done, in frontend `.env`.

## Next: Phase C, Decentralized deployments
### H10: Frontend on IPFS via Fleek CD
### H11: Backend on Phala TEE
