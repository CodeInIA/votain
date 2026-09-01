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

## Terms and Privacy pages, organizer dashboard polish (2026-08-24)

The footer and both profile pages linked Terms and Privacy to `href="#"`. Both pages
now exist at `/terms` and `/privacy`, sharing a `LegalPage` shell.

The content describes what the software actually does rather than boilerplate: what
World ID hands over (a per-app nullifier, no biometrics), why the vault ciphertext
cannot be read by the issuer, why re-voting is indistinguishable, exactly what is
public on chain, and two things the design does NOT protect against (the relayer sees
the network origin of a ballot, and a dishonest issuer could register voters who do
not exist). Stating the limits is the part that makes the rest credible.

Both pages are translated into all thirteen locales, like the rest of the interface:
a reader who picked their own language should not be handed the one part of the site
that decides what they are agreeing to in a language they did not choose.

Translating them surfaced a bug older than the pages: `i18n/config.ts` never set `dir`
on `<html>`, so Arabic rendered left to right across the whole app. A page of Arabic
prose made it obvious where a nav bar did not. It now sets `lang` and `dir` on init and
on every `languageChanged`.

Dashboard, from user testing:
- On mobile the gas balance and quick actions now sit above the elections list
  (`order-1`/`order-2`), since the list is long and buried them.
- Search box over "my elections". The stat tiles keep counting every election, not the
  filtered view: a search should narrow what you look at, not restate the totals.
- The gas tank is per ORGANIZER and shared by all their elections, which the wizard
  never said. The deposit is now labelled optional, shows the balance already held, and
  the confirmation dialog no longer claims the deposit is "deducted from your gas
  balance" when it is added to it and deducted from the wallet.
- An empty tank surfaced as a raw revert, which reads like the voter did something
  wrong. `GasTankEmptyError` now says whose problem it is and what unblocks it.

## Windows Hello passkeys were rejected as PRF-incapable (2026-08-24)

Reported from real use: World ID verification asked for the Windows Hello PIN, the
passkey was created, and then it did not appear under "my account". No vault file
existed on the backend at all, so `putVaultEntry` had never run.

`enrollPrfPasskey` decided whether the authenticator supported PRF by reading
`prf.enabled` from the CREATION, and bailed out when it was false. Measured on
Chrome 151 and Firefox 154 over Windows Hello (Windows 11 25H2):

| creation request | `prf.enabled` at create | PRF value |
|---|---|---|
| `prf: {}` | false | returned by the next `get()` |
| `prf: { eval: { first } }` | true | returned AT CREATION |

So the flag was never evidence of anything. Windows Hello does not evaluate the PRF
unless asked to, and reports `enabled: false` while being perfectly capable. Every
Windows Hello voter was rejected and dropped silently into the localStorage fallback,
which is the path that never registers on chain. `derivePrfSecret` carried the same
gate, so the organizer's tally key fell back the same way.

The fix is to let the PRF value decide, never the flag. Creation now asks for `eval`,
and when the authenticator answers with the secret the voter is spared a second
ceremony, which is what happens on both browsers above. The failure ladder is
`prf.eval` then `prf` then no extensions, in that order: dropping straight to no
extensions mints a credential with no hmac-secret that can never do PRF, which is far
worse than one extra prompt.

The silent degradation itself is untouched and still open, see the no-PRF fallback
decision above. It was masked by this bug; it is not fixed by it.

## Signing out left the voting identity behind (2026-08-24)

`clearIdentity`, `forgetOrganizerAddress` and the display-name reset were all written
and wired to nothing. Sign-out cleared only the session flags.

This was not untidiness. `getOrCreateIdentity` returns the stored identity whenever the
mode is "local", without regard to who is signed in, so the next person to sign in on
that browser voted as the previous one. In PRF mode the leftover commitment and
`votain_vote_*` records showed one voter another voter's history.

Voter sign-out now calls `clearIdentity`. In the no-PRF fallback that deletes the only
copy of the secret scalar, which is the intended meaning of signing out of a device and
costs nothing real: such an identity is local-chain only anyway.

Organizer sign-out now forgets the wallet address and display name. It deliberately
keeps `votain_paillier_sk_*`: those are tally private keys for elections already on
chain, and signing out must not be able to make a result undecryptable forever.

Known coupling: voter and organizer share `votain_prf_credential_id`, and the organizer
session is invalidated when no credential is cached, so a voter sign-out logs the
organizer out too on the next reload.

## Passkey handling after real use on two browsers (2026-08-24)

Three problems, all from the same blind spot: the code treated this browser's cached
credential id as if it were the authenticator's inventory. One machine has ONE
authenticator and one localStorage PER BROWSER, so the two disagree constantly.

**Adding a device from a second browser created a duplicate.** `enrollThisDevice` went
straight to creating a passkey whenever nothing was cached here, so a second browser on
the same machine minted a second credential in the same Windows Hello. Best case a
duplicate vault entry for one authenticator, worst case Windows Hello overwriting the
first and quietly breaking the entry the voter already had. What the voter saw was a raw
`InvalidStateError` under "could not add this device".

Creation now passes `excludeCredentials` with the vault's ids, which is the mechanism
WebAuthn has for exactly this, and the refusal becomes `PasskeyAlreadyRegisteredError`.
It is excluded from the retry ladder: retrying only prompts again and fails again.

**Saying "already registered" was not enough.** The refusal carries no credential id, so
nothing could be cached and the profile kept offering to add the device. `enrollThisDevice`
now asserts with the known ids after a refusal, which identifies the credential and caches
it through `assertPrf`, and returns `{ credentialId, alreadyRegistered }` instead of
signalling by exception. The list then marks the entry "this device" and the button goes.

**The organizer could destroy their own tally keys.** The profile offered "remove passkey",
which called `clearPrfCredential`: that deletes nothing from the authenticator, it only
forgets the local id. But `derivePrfSecret` treated a missing id as a missing passkey and
minted a new credential, and since `organizer.ts` stores the Paillier private key only when
it is NOT derivable, every election created on that device became undecryptable. The guard
at `tally.ts:115` compares the derived public key against the election's on-chain one, so
it failed loudly rather than publishing wrong numbers, but it failed for good.

`derivePrfSecret` now tries `assertPrf([])` before creating anything, so an existing
passkey answers and the key comes back. This also covers cleared site data and moving
browser. The button is renamed to forget (`forget_passkey_*`, thirteen locales) and its
text says what it does: it signs you out here, the passkey stays in the authenticator.

Voter and organizer stay asymmetric on purpose. The voter has a server-side list of
passkeys over one shared identity, so removing one is meaningful and the last is
protected. The organizer has no vault, only a local credential id, so forgetting it is
the only operation that exists.

## The organizer display name survives a new browser (2026-08-24)

`votain_organizer_name` is per browser and is now cleared on sign out, so an organizer
who signed out or moved browser silently fell back to the "VotainOrg" placeholder, and
the next election they created carried it.

The first idea was to store the name, either on chain at first sign in or in the backend.
Both were wrong. On chain it duplicates data that is already there and pays gas for a
field that is self-asserted, so being on chain buys durability, not truth. The backend has
no database, only JSON files, and a second store for a cosmetic string has to be kept in
sync with the one that already exists.

Because the name IS already on chain: it is snapshotted into each election's metadata at
creation and read back for display. So the dashboard recovers it from the organizer's most
recent election and only prompts when there is nothing to recover. The dashboard already
holds that list, newest first and filtered by the connected address, so this costs no
extra chain call.

`recoverOrganizerName` skips two non-answers. An election created while the name was lost
carries the placeholder, and one whose metadata had no name at all reports the raw address,
since that is the display fallback. Adopting either would bury the real name under
something the organizer never chose, permanently and silently.

Renaming still does not rewrite past elections, which is the audit trail and is now stated
in the onboarding prompt rather than left to be discovered.

Implementation note: the first version set state inside an effect and eslint rejected it
(`react-hooks/set-state-in-effect`). The effect now only writes to localStorage and the
decision to prompt is derived during render, which is also more correct: elections arriving
late can no longer open the prompt before recovery has had a chance to answer.

## Organizer domain verification (2026-08-24)

Organizers can now prove they control a domain, so a voter can tell an institution
from an individual. The badge shows the DOMAIN, never a generic checkmark, and that
choice carries the whole design.

A checkmark is an opaque claim: it only means something if you trust whoever granted
it, and Votain cannot verify that someone is a country. Granting one by fiat would put
an unverifiable trust signal at the centre of a system whose entire thesis is that you
do not have to take anyone's word for anything, and it would be worse than nothing,
because a badge changes how a voter reads an election. A domain explains itself and
anyone can re-check it. `elecciones.gob.es` means what it says, and
`votacion-oficial-gob.com` looks exactly as suspicious as it deserves, where a
checkmark beside that same name would launder it.

Mechanism: a TXT record under an underscore subdomain (RFC 8552, since the apex is
crowded with SPF, DMARC and vendor tokens):

    _votain.elecciones.gob.es.  IN TXT  "v=votain1; address=0xa5216ed9..."

A contract cannot do this itself. Contracts are deterministic state machines and every
node has to reach the same result replaying the transaction, so a DNS lookup would break
consensus. The check therefore happens off chain, which costs nothing here: DNS is
public, so the voter can repeat it rather than trust our result.

DNS is the source of truth and nothing else is stored. The backend keeps only the list
of domains worth looking up for an address, because domains cannot be enumerated from an
address, and every read re-checks live. So REMOVING THE TXT RECORD IS THE REVOCATION and
it is immediate. That removed the whole SD-JWT credential and Status List machinery this
feature was first sketched with.

Decisions worth keeping:

- Adding a domain needs no signature: the DNS record authorises it, since you can only
  register a domain whose record already names your address. Removal does need one, or
  anyone could drop a competitor's domain from the lookup list.
- `lookup_failed` must never strike a badge or read as "not published". A resolver blip
  would otherwise punish an election whose DNS is fine, and it is also why failures are
  not cached.
- The three failure outcomes are reported separately because each is fixed differently:
  nothing published yet, a record naming a different wallet, or a lookup that failed.
  A single "could not verify" tells the organizer none of that, and DNS propagation
  means the first check failing is the NORMAL first answer, not a broken feature.
- The domain is snapshotted into the election metadata at creation, like the name. A
  verification that lapses later shows struck through, so the voter sees what it was and
  what it is now, rather than the past being quietly rewritten.
- Elections without a domain are normal, not suspicious. Most organizers are individuals
  and small associations that will never own one, and making them look deficient would
  only pressure them into faking it.
- The live check runs on our backend so the organization never learns who is reading
  their election. The independent check offered to the voter goes through a public
  DNS-over-HTTPS resolver for the same reason, which is a privacy property the
  `.well-known` alternative could not have offered.

## Create wizard, seeding and domain badge placement (2026-08-25)

From a session of real use against the local chain. Most of these were found because the
chain clock and the browser clock disagreed, which turned out to be a lens on several
separate bugs rather than one.

**Dates were validated against the wrong clock.** `phase()` reads `block.timestamp`, but
the wizard compared with `Date.now()`. On a node seeded with time jumps, 44 hours apart,
every election was born ACTIVE with an enrolment window that had closed before it existed,
so nobody could ever join it. The wizard now reads the chain's clock for validation and
for the pickers' lower bound, and names that clock in the error when the two disagree by
more than five minutes: "must be in the future" reads as wrong to someone whose own
calendar says otherwise.

Related, and separate: the picker's bound only constrained the DAY, so at six in the
evening it still offered today at nine in the morning. Bounds now carry the time, clamped
on both paths, since selecting a day set 00:00 without consulting the bound at all.

**The wizard offered a value its own validation rejects.** With no separate enrolment
window, `enrollStart` is stamped at submission and `enrollEnd` IS the vote start, so
offering the current instant produces a deployment that reverts with InvalidConfig once
mined. The minimum now sits five minutes ahead. The under-24h warning also never fired
where it mattered most: a `> 0` guard hid it at exactly zero enrolment time.

**Seeding drags the chain clock forward and it never comes back.** Finished elections
must be created live, voted on, then advanced past their voteEnd to publish a tally.
`SEED_LIVE_ONLY=1` skips them and compresses the one live spec that carries ballots, which
brought the drift from 44 hours to about 3 minutes. The compression matters: without it
that single spec's `voteFrom: HOUR` accounted for the whole remaining hour.

**No length bounds anywhere.** `ElectionV4` did not check `cfg.name` at all, and nothing
capped `metadataJson`, which holds the description and candidates and lives on chain in
full. Bounds added in bytes on chain, in code points in the wizard. A minimum is a weak
filter (aa clears it as easily as a) and exists to catch a slip before it is permanent;
the ceilings are the ones that protect anything.

**Navigation after creating.** The wizard pushed instead of replacing, so the browser's
back button returned to a filled-in wizard whose deploy had already happened, one click
from a duplicate election. The management page's back button used history, which does
nothing at all after a reload.

**Hardcoded English in four places**, rendered untranslated in all thirteen locales:
the blockchain badge, the blank-vote option generated for every chain election, and both
eligibility labels. Three live in `chainElections.ts`, a data layer with no hook, so they
use the i18n singleton. The tradeoff, documented there: a language change does not
retranslate an already-fetched election until it is refetched, which navigation does.

**Domain badge placement.** Added to the dashboard list, the organizer's management page
and the public preview, and made tap-revealable where it stands alone. Discover searches
domains and filters by LIVE verification status, resolved once per distinct
organizer/domain pair. Only "verified" is offered as a chip, never its negative.

## Pending user actions (block a live Amoy run, not code)
- Fund the deployer key with ~1.5 to 2 POL (`npm run estimate:amoy` reports the gap), set
  `PRIVATE_KEY` in `contracts/.env` → `npm run deploy:amoy` → verify on PolygonScan.
- After deploying: copy `PlatformRegistry` from `deployments/amoy.json` into backend `.env`
  (`REGISTRY_ADDRESS`) and set `REGISTRAR_PRIVATE_KEY` to the same deployer key (it owns the
  registry). Without this, voters fail `enroll` with `NotPlatformVerified`.
- Pinata JWT for the tally CLI: deferred, the in-app tally path does not need it.
- ZeroDev project RPC + passkey server URL: ✅ done, in frontend `.env`.

## Anonymous age and nationality eligibility, via Self (2026-08-26)

Elections can now restrict enrollment to voters who prove a minimum age or a
nationality from their passport chip, without revealing either. The proof is
generated on the voter's phone by the Self app reading the document over NFC, and
what reaches Votain is a yes or no per rule.

### The bug this uncovered first

`ElectionV4.enroll` was `external` with no access control, gated only on
`registry.verifiedMembers`. Any eligibility check living in the backend would
have been decorative: a voter the relay refused could call `enroll` from their
own wallet and land in the tree anyway. That is a real hole independent of this
feature, and closing it is what the contract change is actually for.

The fix follows the principle already written down for domain verification: a
contract cannot resolve DNS, and it cannot verify a proof anchored on another
network either, but it can verify a signature. So `ElectionV4` gained two
immutable fields, `eligibilityAttester` and `eligibilityPolicyHash`, and a second
entry point `enrollAttested(commitment, deadline, signature)` behind an EIP-712
domain. `address(0)` leaves an election open and behaving exactly as before; a
gated one reverts `AttestationRequired` on the plain path. The constructor
rejects one field without the other, since an attester with no published policy
gates on rules nobody can read and a policy hash with no attester publishes rules
nothing enforces.

The domain separator is hand rolled. OpenZeppelin's `EIP712` reaches
`ShortStrings` and `Bytes`, which need `mcopy` and a Cancun target, and this
project compiles for paris. Retargeting the whole codebase to obtain a domain
separator would be a deployment decision taken for a formatting convenience.

### The optimizer had to move to the default profile

`ElectionFactory` embeds `ElectionV4`'s creation code, and unoptimized it went
past the 24576-byte limit the moment `enrollAttested` was added, which made every
test fail at `deployStack`. It was already sitting a few hundred bytes below the
ceiling before any of this. The default profile now enables the optimizer like
`production` already did, so the suite exercises the bytecode that actually
deploys.

### Why Self and not World ID Credentials

World ID **does** have this now: `@worldcoin/idkit-core`, already installed,
exposes an `identityCheck` preset with `minimum_age`, `nationality`,
`issuing_country` and `document_type`. The table in `docs/PLAN.md` claiming
otherwise was out of date and has been rewritten.

It was not chosen because World ID Credentials has a geographic allowlist and
Spain is not on it. A feature the author cannot demonstrate on his own document
is not one this project can rely on. Self has no such allowlist, reads any ICAO
passport, and ships mock passports with configurable nationality and age, so
every branch is testable without a real document and the real one still works for
the defence.

**World ID stays the personhood layer.** Self supplies attributes only. That is
not a compromise, it is what makes Self's weak spots irrelevant here: `enroll`
already deduplicates by human through the World ID nullifier, so a dual national's
second passport buys no second ballot, and a borrowed passport is still bound to
somebody else's World ID. Passive Authentication proves a document is genuine,
never that the holder owns it.

### The copy says "document", not "passport"

`ALLOWED_DOCUMENT_IDS` accepted attestation 2 (EU identity card) alongside 1
(passport) from the start, and Self has no per-request document selection: the
voter presents whichever they hold. The interface strings said "passport"
throughout anyway, which understated what the code already accepted. For a
Spanish voter that is the difference between using the card in their wallet and
going to look for a passport they may not own. Spain is on Self's full-support
list, DSC and CSCA both, so the DNI is expected to work.

Six strings changed across all thirteen locales. `eligibility.mock_mode` still
names the passport on purpose: that is what the Self app labels the button a
developer has to tap five times to reach it.

### The Spanish DNI works, confirmed on a real document

The author added his real Spanish DNI to the Self app without trouble. That
settles the doubt this design was built around and makes the note in
`docs/PLAN.md` about the Spanish DNI not being supported obsolete: that line came
from World ID Credentials, not from Self.

Two traps surfaced while testing it, both now documented in `.env.example`:

- **`SELF_MOCK` picks one world or the other.** `1` verifies against the staging
  trees and only mock documents pass; `0` verifies against production and only
  real ones do. Nothing accepts both, and the rejection does not say which side
  the mismatch is on.
- **The session id is not in the public signals.** `readSessionIdFromProof` read
  `pubSignals[userIdentifierIndex]`, which holds a SHA-256 hash of the whole
  `userContextData` that the SDK recomputes as an integrity check. Every real
  proof came back as "carried no session". It now reads `userContextData` itself
  (32 bytes chain id, 32 bytes identifier, then caller data), mirroring the SDK's
  own `slice(64, 128)`. That removes the last dependency on a circuit index,
  which belongs to a circuit version rather than to the request format.
  `backend/src/eligibility/self.test.ts` is new and covers the parser and the
  scope, 10 cases.
- **The wire field is `publicSignals`, not `pubSignals`.** The route was written
  against the SDK's method signature rather than the HTTP payload, so every real
  proof was rejected as missing a field the app had sent. Self's own docs
  disagree with themselves about the name, so both are now accepted, and a
  rejected body logs the keys it carried.
- **`.env` changes did not reach the running server.** `dotenv` reads it once at
  startup and `tsx watch` follows only source files, so a corrected
  `SELF_ENDPOINT` sat unused while the process kept serving the old one. The dev
  script now passes `--include .env`. The endpoint is also baked into the QR, so
  a code generated before the change carries the stale URL even after a restart.

### The allowlist costs a reveal, and why that is acceptable

Self expresses country rules as an **exclusion** list, carried in the circuit as
`uint256[4]`. "Only Spaniards" cannot be phrased that way: it would mean listing
the 194 countries it excludes, which does not fit and never will. So a blocklist
is a pure predicate and an allowlist is not; the allowlist is checked against a
revealed nationality.

The leak is smaller than it looks. In an election whose published policy already
says "ESP only", learning that an enrolled voter is Spanish adds nothing an
observer could not read off the policy. It is still compared and discarded, never
stored. Age is always a predicate: the date of birth never leaves the phone.
Nothing else is ever requested, not the name, not the document number, not the
gender, not the expiry date. The create wizard states the asymmetry so an
organizer knows which of the two options asks more of the voter.

### Shape of the code

Three layers, only the innermost aware of Self, so an EUDI Wallet connector could
sit beside it: `eligibility/policy.ts` (type, canonical JSON, hash),
`eligibility/self.ts` (adapter over the open-source `@selfxyz/core` verifier),
`eligibility/attester.ts` (EIP-712 signer). The managed Self Enterprise service
is deliberately not used: a paid third party sitting in the enrollment path would
contradict the thesis it is meant to support.

The scope is **per election**, derived from the address and capped at Self's 25
characters. The scope is what the nullifier comes from, so one app-wide scope
would give this server a stable pseudonym per voter across every election they
ever verify for.

Sessions live in an in-memory `Map` with a 15-minute TTL. The backend has no
database and here that costs nothing: a restart only makes a voter mid-scan scan
again, while persisting would write a durable record tying a World ID nullifier
to an in-flight passport check.

The canonical policy serialiser is duplicated between frontend and backend on
purpose. Two processes compute the same hash at different times and never compare
notes; drift surfaces as "policy does not match its published hash", which is the
alarm it should raise.

Countries are picked, never typed. `CountryPicker` searches the localised list
live and shows the selection as flagged cards. `lib/countries.ts` keeps only the
alpha-3 to alpha-2 table and derives names from `Intl.DisplayNames`, which means
250 country names in 13 languages cost zero locale strings and stay correct on
their own. Asking an organizer to remember that Spain is ESP invites a typo that
would silently exclude the wrong country, and the policy hash would faithfully
commit to the mistake.

The Self app returns the voter to Votain, but only when that means anything.
`deeplinkCallback` is set on the tappable link and left off the QR: scanning the
QR means Votain is on a desktop and the app is on a phone, so a redirect would
move the wrong screen. The return address is supplied by the browser (only it
knows the origin serving the page, a LAN address under `vite --host` in
development) and sanitised on arrival, since it lands in a payload the Self app
navigates to and shows to the voter: http and https only, and in production the
origin must match `FRONTEND_URL`, or this endpoint becomes a way to mint Self
links pointing anywhere.

`@selfxyz/qrcode` is not used, and does not need to be: it is a React wrapper
from the legacy SDK that draws a QR and holds a websocket open. The drawing is
three lines with `qrcode.react`, already a dependency, and the websocket is
redundant because Self's relayer posts the proof to our server directly while the
browser polls the session it opened.

The deep link itself is built by the BACKEND with Self's own `SelfAppBuilder`,
not assembled in the browser. Hand-copying that builder's defaults, which is what
the first version did, went stale within two SDK releases: the payload gained a
`selfDefinedData` field and the staging chain id changed from 44787 to 11142220.
Neither would have failed loudly. Building it through the SDK also runs its
validation server-side, so a localhost endpoint or an over-long scope is caught
before a voter sees a QR. `@selfxyz/common` is now a declared dependency for
that, imported through the same `utils/appType` subpath `@selfxyz/core` uses.

### Two environment quirks worth remembering

`@selfxyz/common` declares `node-forge` as a **GitHub URL** in every published
version, so any environment blocking git dependency fetches cannot install the
SDK at all. `backend/package.json` now overrides it to the registry release
`^1.3.3`, which current `@selfxyz/core` asks for anyway. Re-check on upgrade.

`skipLibCheck` was turned on in the backend tsconfig and then turned back off.
It was a workaround for `pkijs` and `elliptic` declarations that did not
typecheck under `@selfxyz/core@1.0.8`, and the upgrade to 1.2.0-beta.2 resolved
them: the build is clean without it. Suppressing dependency declaration errors
that no longer exist would only hide the next real one.

### The QR that never advanced, and why it was invisible

The end-to-end test finally reached the point where Self verified a real Spanish
DNI and reported success. The browser kept showing the QR anyway.

Nothing was wrong with the verification. `EligibilityCheck` guarded its polling
loop with a ref set in an unmount cleanup:

```ts
const cancelled = useRef(false);
useEffect(() => () => { cancelled.current = true; }, []);
```

StrictMode mounts, unmounts and mounts again in development. That first simulated
unmount ran the cleanup and set the flag; a ref survives the remount, and nothing
ever set it back. So the flag was true for the component's entire life, and every
poll tick returned on its first line. The loop was running and doing nothing.

It is invisible from every angle that usually catches things: tsc and eslint are
happy, the tests do not mount this component, the backend log shows a successful
verification, and Self shows a success screen. Only the browser stays still. The
fix is one line, resetting the flag on the way in, and it is now the reason the
comment there exists.

Two things made it harder to diagnose than it should have been. Sessions live in
memory, so the backend restarts that `tsx watch` performs on every edit wipe
them: editing files while somebody is mid-scan invalidates their session. And the
poll gave up on the first failed request, which would strand a voter over a
momentary blip; it now distinguishes a vanished session, which is final, from a
transient failure, which is retried up to four times.

### Three runtime bugs that no static check would have caught

Found while preparing the end-to-end walkthrough, all of them invisible to tsc
and eslint and all of them fatal in the browser:

- `lib/eligibility.ts` read `VITE_API_URL`, which exists nowhere. Every other
  module uses `VITE_BACKEND_URL`. Requests would have gone to the Vite dev server
  instead of the backend, so the whole feature was dead on arrival.
- `EligibilityCheck` listed `onVerified` in the polling effect's dependencies.
  The parent passes an inline arrow, so the prop is a new function on every
  render and the interval was torn down and recreated each time: a 2.5 second
  timer that keeps restarting never fires. It now lives in a ref.
- The create wizard only WARNED when no attester was reachable, then deployed
  anyway and failed with a message about a missing argument. A gated election
  freezes the attester address in at creation, so this would have produced an
  election nobody could ever enroll in. It is now a blocking validation error.

### Checked against the official docs (2026-08-28)

With Self's documentation MCP available, the integration was audited against the
source rather than against memory. Four things were wrong.

**The SDK was below Self's documented floor.** Self requires
`@selfxyz/core >= 1.1.0-beta.1`, because earlier versions point at Celo Alfajores
for mock documents and will not verify correctly. We were on 1.0.8, chosen for
being the newest non-beta, which turned out to be the wrong criterion: the floor
is a correctness requirement, not a preference. Now on **1.2.0-beta.2**, the
published latest, whose bundle references celo and sepolia rather than alfajores.

**The `node-forge` override is gone.** It was never the right fix, only the
reachable one. `@selfxyz/common` declares that dependency as a GitHub fork, and
npm 12 disables git dependencies by default (`allow-git=none`), which is what
produced `EALLOWGIT`; the restriction is npm's supply-chain hardening, not a
sandbox or anything configured on this machine. A project `.npmrc` now sets
`allow-git=all`, so a plain `npm install` works and installs exactly what Self
declared. An override would instead swap a dependency the author deliberately
forked: a guess for node-forge, and for the 1.2.x line's forked `snarkjs` it
would replace the library that verifies the proofs. `root` does not help, because
the git dependency is transitive.

The cost is stated rather than hidden: `allow-git=all` relaxes npm's protection
for the whole dependency tree of that package.

**The endpoint must always answer 200.** The documented contract puts the verdict
in the body, `{ status, result, reason }`, and reserves the status code for
whether the callback arrived. The route answered 400 and 404, which a relayer
reads as a transport failure: a voter who merely missed the age rule would have
seen a network error instead of the reason.

**Rejections threw away the diagnosis.** 1.1.0-beta.1 exports typed errors, so a
`ConfigMismatchError` now logs which expectation failed (`InvalidScope`,
`InvalidRoot`, `InvalidTimestamp`) instead of collapsing to "proof_invalid".

**The age threshold read one field name.** The SDK type and runtime say
`minimumAge`; the published API reference still says `olderThan`. Reading only
one meant a rename would make the secondary check reject a voter the SDK had just
approved, since `isMinimumAgeValid` is verified immediately before it. Both names
are read now, and an unreadable value defers to the SDK's verdict with a warning
rather than failing the voter.

Three decisions were confirmed correct: `MAX_COUNTRY_LIST = 40` is exactly the
documented cap above which proofs fail in the Self app; `publicSignals` is the
wire field name; and the allowlist genuinely has to be enforced by us, because
`nationality` is a disclosure request rather than a verification rule and Self
never checks it.

Document types now come from the SDK's own `ATTESTATION_ID` constants
(`PASSPORT`, `BIOMETRIC_ID_CARD`) rather than the literals 1 and 2, so a
renumbering becomes a compile error instead of silently admitting the wrong
document. Aadhaar and the newer `SELFRICA_ID_CARD` stay out: Self documents
Aadhaar as unable to satisfy country rules, so a nationality-restricted election
would be accepting a document that cannot answer the question it asks.

Also noted: `@selfxyz/core` is the Self Pass SDK, which Self now labels Legacy in
favour of the managed `@selfxyz/enterprise-sdk`. Staying is deliberate. The
managed path bills per verification and puts a third party on the enrollment hot
path, which is the opposite of what this project argues for.

### What the code review changed (2026-08-28)

A review of the whole pending diff raised seven items. One was wrong, six were
real and are fixed.

**Wrong: the claimed under-age bypass.** The report said a proof disclosing no
age (`"00"`) would satisfy an 18+ policy. It conflated two different SDK
computations. The one that tolerates `"00"` is the config-mismatch guard at
`index.js:726`, which only decides whether to raise `ConfigMismatchError`. The
verdict actually read here is `isValidDetails.isMinimumAgeValid` at line 836,
`config.minimumAge <= parseInt(disclosed.minimumAge)`, which is false for `"00"`
(0) and false for a missing field (NaN), and it is checked before anything else.
The proof was already rejected.

**But the construct it pointed at deserved to go.** `minimumAgeProved:
provedThreshold ?? policy.minAge` compared the policy against itself whenever it
fired, so it could never fail. It was meant to survive a field rename, and that
scenario already fails closed at the SDK, so it bought nothing. An unreadable
threshold is now a rejection.

**Real: a blocklist election required a nationality nobody was asked for.**
`checkAttributes` demanded the value whenever a policy named countries, but
`requiresNationalityReveal` only asks for it on an allowlist. It survived purely
because an undisclosed field arrives as NUL padding, which is truthy. Trimming
those, which is correct anyway, would have rejected every voter in every "block
these countries" election. The requirement is now keyed on the allowlist alone;
the blocklist checks the value only if it happens to be there, since it is
enforced in-circuit regardless.

**Real: the Self callback was rate-limited per client address.** That request
comes from Self's relayer, so every voter shared one bucket, and the 429 past it
is exactly the non-2xx the relayer reads as a transport failure. Now keyed on the
session the proof names, falling back to the address only for bodies with no
recoverable session.

**Real: a failed attestation claim stranded the voter.** The poll stops on
`passed`, so a cancelled passkey prompt or a refused signature left the component
on a spinner with no button. The claim now has its own terminal failure.

**Real: the attestation was consumed after two awaits.** Two concurrent claims
with the same session and different commitments could both pass the status check
and both get signatures. Consumed before the awaits now.

**Real: an unreadable eligibility check silently downgraded an election to
open.** A backend that is down sent the voter to the ungated path and a bare
`AttestationRequired` revert. There is now a distinct unknown state that blocks
and offers a retry.

Two React compiler rules pushed the shape of that last fix: dependencies must be
the address rather than the election object, and the reload has to be a re-run of
the effect rather than a callback it calls, because the compiler cannot see that
the writes are deferred behind an await.

## Results hidden from everyone except the organizer (2026-08-28)

A closed election showed its results on the organizer's management page and
claimed there were none on the public and voter pages. The tally was on chain
the whole time.

Three views asked the same question and one of them asked it differently:

```
organizer   phase === 'closed' && candidates.some(c => c.votes !== undefined)
public      phase === 'closed' && election.ipfsCid
voter       phase === 'closed' && election.ipfsCid
```

`ipfsCid` is the audit trail of a tally pinned to IPFS, and `lib/organizer.ts`
already documents it as empty whenever the count was run in the app, which is the
normal path and the only one wired up. So the two views that tested it were
gating public results on an artefact nobody produces.

Now one exported predicate, `hasPublishedResults`, beside the type it tests, used
by all three. The condition that was already right is the one that survived.

## Change vote offered after voting had ended

A voter who had already voted saw "change my vote" on an election whose results
were published. The contract would have refused it: `castVote` requires an open
voting window. The button was gated on `hasVoted` alone, with no phase in the
condition, so it appeared in tallying, closed, cancelled and voided elections
too.

The card stays, the button does not. The receipt is the voter's own proof that
they took part and should remain readable for the life of the election; the
action is only real while voting is open.

`ChangeVote` has its own route, so the guard could not live on the button alone:
reaching that URL directly let a voter pick a candidate and start generating a
proof before anything refused them. The page now checks the phase itself and says
voting has closed.

## Lifecycle transactions that vanish rather than revert

Closing enrollment, closing voting and publishing results sometimes showed an
error in the wallet while the app reported success, and the chain agreed with the
app: the state had changed.

The wallet was out of sync, not wrong about its own view. Transactions had been
sent from that same account by script (deployment, seeding, the end-to-end
walkthrough), so its cached nonce trailed the node's. That is worth knowing as
an operational fact: **a local chain plus a scripted account plus MetaMask means
clearing the wallet's activity data periodically.**

The code had a real weakness that surfaces exactly there, though.
`(await tx.wait()).hash` dereferences a receipt that ethers returns as **null**
when it can no longer find the transaction, which is what a dropped or replaced
one looks like, and a nonce conflict is the usual way that happens. The organizer
would have got "Cannot read properties of null". All seven organizer writes now
go through `waitForLifecycleTx`, which names the likely cause and the fix. A
genuine revert is unaffected: ethers throws on a status-0 receipt and that error
is reported as it is.

### Verification

Contracts 84 passing (16 new in `test/Eligibility.test.ts`, covering the bypass,
a forged signer, an expired deadline, a swapped commitment, malformed bytes,
cross-election replay, and that platform verification and the enrollment window
still apply). Backend 73 passing. Frontend 38 passing, tsc and eslint clean, the
production build green, and 522 i18n keys in parity across 13 locales.

`frontend/src/lib/eligibility.test.ts` pins the canonical policy string
`{"minAge":18,"allowedCountries":["ESP"]}` and so does the backend suite. The two
serialisers are only ever compared through the on-chain hash, so pinning the same
literal on both sides turns a silent drift, which would surface to a voter as
apparent tampering, into a failing test.

**Exercised end to end on a local node** by `contracts/scripts/e2e-eligibility.ts`
(17 checks, all passing) plus the HTTP endpoints by hand: a gated election
deployed through the factory, its published policy hash recomputed from its own
metadata, `enroll` refused with `AttestationRequired`, an attestation signed the
way `attester.ts` signs it and relayed through the paymaster, and the rejections
for a forged signer, an expired deadline, a swapped commitment, a second
enrollment by the same human, an unverified voter, and an attestation aimed at an
open election. On the backend: the policy read back off chain, the challenge
issued only to an authenticated voter, a forged cookie refused, another voter
refused a session that is not theirs, an attestation refused before the check
passed, and a junk proof leaving the pending session untouched.

**Not exercised by anyone yet**: the real Self app, the passport read, the QR and
the deep link. They sit behind a phone and a public tunnel. `SELF_ENDPOINT` must be
internet-reachable (the SDK rejects localhost), so testing locally needs ngrok or
similar, and `SELF_MOCK=1` accepts mock passports (five taps on "Passport" in the
Self app opens an editor for nationality, age and OFAC).

**Open question for the thesis, not for the code**: what the nullifier is derived
from, and therefore what happens when a passport is renewed. It does not affect
this design, since Self supplies no uniqueness here, but it is the kind of detail
a tribunal asks about.

## Tally key derivation, 6.7x faster (2026-08-28)

Creating an election sat silent for about three minutes after the passkey prompt
and before the wallet prompt, which reads as a crash: the organizer reported it
as a deploy failure. Nothing was failing. The organizer's Paillier key is
re-derived from the PRF secret rather than stored, so a 2048-bit key is generated
in the browser on every creation.

`nextPrime` walked upward by two running a full forty-round Miller-Rabin on every
candidate. At this size roughly one odd number in 355 is prime, so almost all of
that work was spent proving composite numbers composite. It now discards
candidates by trial division against the primes below 10000, then screens
survivors with a single MR round before paying for the full forty. Measured: one
derivation went from 43.7s to about 6.5s in the vitest environment. Incremental
residue tracking was measured too and added only 7 percent, not worth the extra
complexity in a determinism-critical path.

**Nothing in this path touches the chain**, so the wait was never a local-node
artefact and would have been identical on Amoy.

The derivation itself is unchanged, and that is the whole point: both filters are
exact rather than probabilistic shortcuts, so neither can skip a value the
original walk would have accepted. `frontend/src/lib/tallyKey.test.ts` is new and
pins the derived keypair for a fixed secret and nonce, captured from the
implementation BEFORE the change and still reproduced after it. That test did not
exist, which is why a compatibility surface that makes old elections undecryptable
if it moves had nothing guarding it.

Still open: six seconds of frozen tab between the passkey and the wallet prompt
is better than three minutes but still unexplained to the organizer. The wizard
should name what it is doing, and the work belongs in a worker so the tab stays
alive.

## Election filters unified across the two lists (2026-08-28)

The organizer dashboard and Discover had grown separate copies of the same
filter row, and the copies had drifted. The dashboard carried the age and
nationality inputs but no phase chips, no verified-domain chip and no restricted
badge, so an organizer could not narrow their own list by state and could not
tell from it which of their elections were restricted at all.

Extracted rather than patched, because patching would have left two copies to
drift again: `lib/electionFilter.ts` (state, defaults, active predicate,
matching rule), `components/ui/ElectionFilters.tsx` (the controlled bar),
`hooks/useVerifiedDomains.ts` (one DNS check per distinct organizer and domain
pair, returning a predicate) and `components/ui/RestrictedBadge.tsx`, which is a
component rather than a snippet because its summary comes from a hook and hooks
cannot be called from inside a list callback. `ElectionCard` now uses that badge
too instead of its own copy.

### The restricted marker became the requirements themselves

First attempt reused `Badge`, which was wrong twice over. Every Badge variant is
the same uppercase translucent pill, the vocabulary of election phase, so the
marker read as another status and disappeared next to one. And "Restricted" is
the wrong content: a reader scanning a list wants to know whether they qualify,
and the word only raises that question.

`EligibilityChips` now renders the rules compactly, "18+" and a flag, mixed case
and softer cornered so it cannot be mistaken for an uppercase phase pill. The
full sentence stays in the tooltip.

A first pass filled them solid amber, which was worse than the badge: it
competed with the enrolling pill, which is already yellow, and read as a warning
rather than as a fact. Colour now lives in the icon alone, on the neutral surface
the rest of a card's metadata uses, with red reserved for the blocked-countries
icon because that is the one rule that excludes rather than admits.
The three detail pages that had their own copy of the badge use it too, and
`eligibility.restricted` is gone from all thirteen locales.

The filter chip went the same way. It started as `variant="tie"`, which is the
warning amber, sitting next to `enrolling`, which is yellow. Reaching for another
palette colour was not an option either: primary is `enrolled`, secondary
`tallying`, tertiary `pending_vote`, error `cancelled`, green `active`. Every hue
is a phase, so any choice could only collide with a state.

Both property filters are therefore hueless now, square-cornered chips with an
icon where contrast alone says on or off. That settles a rule worth keeping: a
rounded-full uppercase pill is a phase, a rounded chip with an icon is a
property, and phase is the only thing that gets to use hue as its signal.

A `restrictedOnly` filter joins the chips row. It is deliberately separate from
the age and nationality inputs: those ask "would I qualify", which every
unrestricted election satisfies trivially, so they can never answer "which of
these have requirements at all".

Two bugs fell out of the merge. Discover's "clear filters" reset three filters by
name and left the age and nationality inputs untouched, so clearing could leave
the list still empty; it now resets the whole state object. And the dashboard's
search covered the title and domain but not the organizer name, which Discover's
did.

## Plurals were never resolving (2026-08-29)

The Discover results line read "13 elección" in Spanish and "13 election" in
English. The plural translation existed and was correct: it was written as
`discover.results_count_plural`, i18next's **JSON v3** suffix, and this project
runs i18next 26, which reads JSON v4 and ignores it. It fell back to the
unsuffixed key and nothing warned. A translation that is quietly ignored is worse
than a missing one, because it looks done.

All five count-bearing keys had the same shape of problem, not just the reported
one: `discover.results_count`, `gas.votes_remaining`,
`election_mgmt.tally_voters`, `voter_elections.urgent` and
`country_picker.more_results`. Each now carries one form per category its
language actually uses, generated by asking `Intl.PluralRules` rather than
assuming two: Spanish, French, Portuguese and Italian add `many`, Russian has
four, Arabic six, and Chinese, Japanese and Korean have one.

Russian needed a word change as well. "выборы" is pluralia tantum and cannot be
counted, so the countable "голосование" replaces it and declines properly across
one, few and many.

`frontend/src/i18n/plurals.test.ts` guards all of it in four checks: no `_plural`
keys, every category present for every count key in every locale, no unsuffixed
form left beside the suffixed ones, and a pinned list of the places where
singular and plural legitimately read the same ("Wähler" in German, "and N more"
in English, every Hindi noun here) so a new key cannot join that list unnoticed.

Verified in the browser as well as in the suite: the line now reads "1 election"
with one result and "13 elections" with thirteen.

## World ID level shown per election (2026-08-29)

The eligibility list said "World ID verified" on every election, which hides the
distinction that matters: an Orb scan happens in person, a device verification
does not. It now reads "verified with Orb" or "verified (device is enough)".

Two findings behind it. `requireOrb` was a **dead toggle**: present in the create
wizard, rendered as a Switch, never passed to `createElection`, never stored,
never read. An organizer flipped it and nothing anywhere changed. And the
organizer's own page never showed the platform requirement at all, because its
entry-requirements card only rendered when an attribute policy existed.

**The declaration does not yet bite.** `lib/worldId.ts` requests `orbLegacy` for
everyone at sign-in and the backend records no verification level, so every voter
is Orb-verified regardless of what an election declares. That errs strict, never
lax: an election saying "device is enough" gets Orb voters. Making it real needs
sign-in to vary per election, the credential to carry the level, and enrolment to
check it. Recorded here so the gap is a known boundary rather than an assumption
that it works.

## World ID credential level actually checked (2026-08-29)

The backend called the verify API, checked only that it returned 200, and took
the nullifier. The API confirms a proof is valid, not that it is the credential
the app asked for, so a device-level or selfie proof verified and was accepted
exactly like an Orb. The Orb requirement lived entirely in the client's request,
which is to say nowhere.

`ElectionV4.enroll` deduplicates on that nullifier and treats it as one human.
Only Proof of Human carries that guarantee, so the platform was silently offering
one-account-one-vote while claiming one-person-one-vote.

`auth/worldId.ts` now rejects anything below Proof of Human, before spending the
API call, and `verify-human` goes through it instead of keeping a second copy of
the same fetch: both copies had the same hole, so it had to be closed twice or
not at all.

Three details the docs settled. `issuer_schema_id` beats the identifier string,
because one is assigned by the protocol and the other is a label the caller
writes. Every response is checked rather than the first, since a 200 means "at
least one proof verified" and a mixed payload would otherwise ride in on its
strongest entry. And Orb is spelled `orb` in 3.0, `proof_of_human` in 4.0 and
`poh` in the authenticator.

`backend/src/auth/worldId.test.ts` covers it in 12 cases. Verified by reverting
the check: 5 of them fail without it.

Unchanged on purpose: the approach stays Orb-minimum, one identity one vote. The
wider question of what a Spanish voter does when Orbs are unavailable is still
open (see the entry above on the World ID level shown per election).

## Personhood moved from World ID to the document (2026-08-30)

The platform demanded Orb at sign-in, which excluded exactly the people it is
for. Orbs were withdrawn from Spain, World ID's NFC credential still reads
"coming soon" there, Selfie Check is beta and access-gated with no uniqueness
guarantee, and `deviceLegacy` is deprecated. A Spanish voter could not sign in at
all unless they had been Orb-verified before the withdrawal.

Sign-in now accepts whatever credential the voter holds. Legacy presets return
the HIGHEST one they have, so an Orb holder still signs in as one and the backend
records that; `verifyWorldIdProof` takes the minimum as an argument, ranking
`any` < `document` < `orb`, and an election that wants Orb asks at enrollment.

That moves the weight. `enrolledHumans` deduplicates on the World ID nullifier,
which now identifies an ACCOUNT, so a person with two of them could have enrolled
twice. `ElectionV4` therefore records a second nullifier, supplied by the
attester and derived from a document, in `usedPersonhoodNullifiers`. Zero is
refused, reuse is refused, and the EIP-712 signature covers it so a relay cannot
swap it in transit.

The earlier decision NOT to store the Self nullifier is reversed here, and the
reason it was made is worth keeping: it was safe only while World ID deduplicated
humans. Once sign-in stopped proving personhood, the Self nullifier became the
only thing standing between one-person-one-vote and one-account-one-vote. The
per-election scope chosen back then turns out to be exactly right for this: the
same document yields the same value inside one election and an uncorrelated one
in every other.

What is honestly weaker: an election declaring no policy has no document
nullifier, so it inherits account-level resistance only. That is the price of
letting Spanish voters in at all, and the create wizard should default to asking
for a document. Recorded rather than hidden.

Verified: contracts 89 passing including 6 new on the nullifier, backend 89,
frontend 56, and `scripts/e2e-eligibility.ts` at 22 passed against a real node,
where section 7 enrolls one person twice through two separate World ID accounts
and watches the second be refused.

## The personhood level became a policy field (2026-09-01)

Closes the gap the entry above left open. An election that declared no attribute
policy inherited account-level resistance only, and the level it wanted lived in
a top-level `requireOrb` flag in the metadata, OUTSIDE the bytes
`eligibilityPolicyHash` commits to. Anyone able to rewrite the metadata could
turn that flag off and nothing would notice, so it was a claim, not a rule.

`personhood` is now a field of the policy itself: `device`, `document` or `orb`,
inside the hash. The backend reads it back from the chain and refuses to sign
against a policy that does not match its published hash, which is what makes the
level enforceable rather than decorative.

- It is appended LAST in the canonical JSON and only when stated, so every
  election deployed before the field existed still serialises to exactly the
  bytes its hash was taken over. Pinned by a test on both sides.
- `effectivePersonhood` reads an attribute policy as `document` whether it says
  so or not, because the scan it already costs is the scan that produces the
  nullifier the contract deduplicates on. Nothing about existing elections
  changes.
- A policy holding only `personhood: "document"` is not empty. It needs an
  attester, a non-zero hash and a Self scan, with no attribute disclosed at all:
  the scan is there purely to make two enrollments behind one document
  impossible. The wizard now defaults to it.
- `orb` means document AND Orb, not either. The document nullifier stays the
  on-chain value because Self scopes it per election; a World ID nullifier is
  scoped per application and would be identical across elections, re-linking the
  enrollments this design works to keep apart.

The Orb check reads the level recorded in the SD-JWT at sign-in rather than a
proof presented at enrollment, and that IS the binding: the session is keyed by
the nullifier that credential was issued against. A proof accepted at enrollment
time would only prove that somebody, somewhere, has an Orb. A credential issued
before the claim existed carries no level and is treated as unmet.

### A level that was claimed, not proved

Found while wiring the above. `verifyWorldIdProof` returned
`level: payloadLevel(payload)`, the level of what was SENT. The verify API
answers "at least one of these verified", so a payload declaring an Orb
credential next to a real device one earns its 200 from the device proof, and
the session would have recorded Orb on the strength of an entry nothing checked.
Harmless while the level was only displayed; not harmless the moment it gates an
election. It now reads the entries that actually verified, and where the API
itemises nothing it records the LOWEST declared level: understating costs a
voter one more verification, overstating hands them an election.

## The gas tank failure that could not be read (2026-09-01)

Reported from testing: when an organizer runs out of gas, a voter trying to
enroll gets an error that does not say why. Two faults, and the first one is not
the one it looks like.

`isTankEmpty` matched the text "insufficientbalance" in the error message. It
never matched. Measured against the local chain by draining a tank and relaying
an enrollment, what ethers actually raises is:

```
execution reverted (unknown custom error) (action="estimateGas", data="0xf4d678b8",
reason=null, invocation=null, revert=null, code=CALL_EXCEPTION)
```

The relay ABI declared functions and no errors, so the selector had no name. But
declaring them does not fix this case either, which is the part worth writing
down: the call fails during GAS ESTIMATION, which happens at the provider, and
the provider has no ABI. `revert` is null regardless. The only thing that
survives is the four-byte selector in `error.data`, so `revertNameOf` reads that,
against a hand-written table pinned by a test that recomputes every selector from
its signature. It also scans the message text, which is the Amoy case: there the
relay runs on the server and the browser receives the composed string, selector
included, rather than an error object.

The second fault was the plain one. `ElectionDetail` caught the error, logged it,
and called `setTxState('failed')`, discarding the message; `TransactionPendingModal`
had accepted an `errorMessage` prop the whole time and nobody passed it. Same
omission in the create wizard. The vote path did surface the message, but raw and
in English only, so all three now go through `relayErrorMessage`, which names
seven reverts in all thirteen locales and falls back to the raw text rather than
to "something went wrong".

Also fixed while confirming this: `scripts/e2e-eligibility.ts` computed its
attestation deadlines from the LATEST BLOCK, while Hardhat stamps the next block
with `max(parent + 1, wall clock)`. Against a node last used two days earlier
every deadline was born expired, and the run died in section 4 on
`AttestationExpired` before reaching anything under test.

## An attestation deadline measured by the wrong clock (2026-09-02)

Reported from testing: enrollment in one election failed with
`AttestationExpired` and kept failing, however many times it was retried.

`signEnrollAttestation` computed `deadline = now + 15 min` from the SERVER's
wall clock. `ElectionV4.enrollAttested` compares that deadline against
`block.timestamp`. Where the two clocks agree, which is any network minting
blocks every couple of seconds, nothing shows. The local chain had been advanced
a week past a run of finished elections, so every attestation was born seven days
expired and no retry could produce a valid one.

`attestationBaseTime()` takes the LATER of the two clocks. Not the chain alone:
an idle node's last block can be hours old, and measuring from it would hand the
voter a deadline short by exactly that gap. Taking the later one can only move
the deadline outwards, so the voter always has the full window measured from
whichever clock is furthest along, and on Amoy it picks the wall clock and
behaves exactly as before at the cost of one block read.

This is the fourth appearance of the same confusion in one session: the e2e
script signing deadlines against a stale block, the countdowns disagreeing with
the phase, the create wizard refusing reachable dates, and now this. The lesson
worth keeping is that a contract judges in chain time, so anything it will judge
has to be measured there.

### The seed stopped dragging the clock

The drift itself was avoidable. Publishing a tally means advancing past
`voteTo`, and a chain clock only moves forward, so each finished election cost
its whole window: three hours apiece, plus two live elections opening their vote
window three days out. Six days of drift that never came back.

The window of an election that is already closed carries no information: nobody
can see it, nothing reads it, and the tally is identical either way. Both are
compressed now, and a full seed lands within about an hour of the wall clock
instead of a week. `SEED_ONLY` was added alongside, because the seed is not
idempotent and adding one election to a seeded chain otherwise meant destroying
the chain and every registration on it.

## What the app knows versus what it says (2026-09-02)

A cluster of small fixes with one shape: the interface asserting something
weaker, or plainly different, from what it had in hand.

- **The vote history said "you have not voted in any elections".** In PRF mode
  nothing is stored at rest, so after a reload the Semaphore secret is gone until
  a passkey tap re-derives it, and the lookup returned nothing. The page reported
  that absence as a fact about the voter, contradicting receipts the chain was
  holding. It now reads the per-election nullifiers `rememberVote` already wrote
  when the ballot was cast, which are public and need no secret, and an unlock
  widens the answer to ballots cast on other devices rather than enabling it at
  all. The unlock also writes down what it finds, so it is needed once rather
  than once per reload.
- **The public verifier searched the demo seed data.** It never touched the
  chain, so against a real deployment it found nothing and always would. It also
  lived behind a link in the voter profile, which put the app's one public
  verification tool in front of the only audience that did not need it.
- **A drained gas tank read as "transaction failed".** The reason was in the
  response the whole time as a four-byte selector, and nothing on the client
  could name it.
- **An empty participation bar** was drawn for elections nobody had joined, and
  the same ratio could report 200% turnout, because the chain counts ballots and
  a re-vote is a second ballot.

Each was a case of the UI having the information and not saying it. Worth
noticing as a pattern rather than four separate bugs.

## Next: Phase C, Decentralized deployments
### H10: Frontend on IPFS via Fleek CD
### H11: Backend on Phala TEE

## Future work: institutional identity beyond domain control

Domain control proves control of a domain, which is what people actually use to judge
authenticity, and it is honest about proving nothing more. It does not establish that an
organizer IS a given public body.

The real answer for European public institutions is eIDAS 2.0 and the EU Digital Identity
Wallet, where a member state issues the organization a verifiable credential and the
attestation chain ends at a government rather than at us or at a DNS registrar. That
would let an organizer present a legal-entity credential (EUDI/LEAR style) instead of a
hostname, and the badge could name the institution rather than its domain.

Out of scope here: it needs a qualified trust service provider, conformance to the ARF,
and access to a member state's issuing infrastructure, none of which are reachable in a
bachelor's thesis. Recorded so the limitation is a deliberate boundary rather than an
oversight.
