# frontend/. Developer Guide

## Stack (versions as of 2026-07-15)

- **React** 19.2.7
- **Vite** 8.1.4 (Rolldown)
- **Tailwind CSS** 4.3.2
- **TypeScript** 6.0.3, **pinned**. `typescript-eslint` requires `<6.1.0`, do not bump to 7.x yet
- **react-router-dom** 7.18.1
- **framer-motion** 12.42.2
- **i18next** 26.3.6 + react-i18next 17.0.9 (13 languages)
- **`@radix-ui/react-select`** 2.3.3 (headless primitive, LanguageSelector)
- **country-flag-emoji-polyfill** 0.1.8 (flag emojis on Windows/Chromium)
- **ethers** 6.17.0 (chain reads, organizer EOA, local relay)
- **`@semaphore-protocol/{identity,group,proof}`** 4.14.3 + **poseidon-lite** (nullifier)
- **paillier-bigint** 3.4.3
- **`@worldcoin/idkit`** 4.2.0 + **`@worldcoin/idkit-core`** 4.2.1
- **`@sd-jwt/core`** 0.20.0 + **`@sd-jwt/present`** 0.19.0 (no stable 0.20 of present yet)
- **lucide-react** 1.24.0

## Routes (all 24 screens implemented, Phase A)

```
/                                Landing (auto-redirects by role if logged in)
/discover                        Public election discovery
/election/:id                    Public election preview
/election/:id/results            Public results
/how-it-works                    How It Works
/terms                           Terms of use (legal text: en + es only)
/privacy                         Privacy notice (legal text: en + es only)
/verify-receipt                  Verify vote receipt

/voter/onboarding                Onboarding (5 steps + World ID QR, REAL integration)
/voter/signin                    Voter sign in
/voter/re-verify                 Identity recovery (World ID + new passkey)
/voter/elections                 My elections (phase-aware tabs)
/voter/election/:id              Election detail (enrollment / active)
/voter/election/:id/zk-proof     ZK proof generation (simulated)
/voter/election/:id/confirmation Vote confirmation
/voter/election/:id/change-vote  Change vote
/voter/history                   Voting history
/voter/profile                   Voter profile (language, legal links, sign out)

/organizer/auth                  Passkey + wallet setup
/organizer/dashboard             Organizer dashboard
/organizer/elections/new         Create election wizard
/organizer/election/:id          Election management (phase-gated)
/organizer/gas                   Gas management
/organizer/members               Registered members
/organizer/profile               Organizer profile

/dev/components                  Design-system showcase (DEV only)
*                                NotFound
```

## Auth model

`src/contexts/AuthContext.tsx`: persistent voter + organizer sessions:

- **Source of truth for the voter session is the httpOnly `voter_vc` cookie** (issued by
  the backend after World ID verification). The localStorage flags
  (`votain_voter_logged_in`, `votain_organizer_logged_in`) are only an optimistic UI cache:
  on mount `GET /api/me` reconciles them: a 401 clears a spoofed/stale flag, an
  authenticated response confirms it, a network error keeps the optimistic state.
- The organizer flag is reconciled against `eth_accounts` (no wallet authorized → cleared).
  Spoofing either flag only changes cosmetic nav; every real action is guarded by the
  cookie (server) or by wallet signatures + `onlyOrganizer` checks (chain).
- `voterSignOut()` clears localStorage AND calls `POST /api/logout` (clears the cookie)
- **The organizer display name is recovered from the chain, not stored twice.** It lives in
  `votain_organizer_name`, so a new browser or a sign out loses it, and the next election
  created would carry the placeholder. It is also snapshotted into every election's metadata
  at creation (`organizer.ts`, read back in `chainElections.ts`), so the dashboard reads it
  back from the organizer's most recent election and only prompts when there is nothing to
  recover. `recoverOrganizerName` skips the placeholder and elections whose metadata carried
  no name (where `organizer` falls back to the raw address): adopting either would bury the
  real name under something the organizer never chose.
- Renaming does NOT rewrite past elections, since each one holds the name it was created
  with. That is the audit trail, and the onboarding prompt says so.

## Organizer domain verification

`src/lib/organizerDomains.ts`, `src/components/organizer/MyDomains.tsx`,
`src/components/ui/DomainBadge.tsx`. Backend: `src/organizer/domains.ts`.

The badge shows the DOMAIN, never a checkmark. A checkmark only means something if you
trust whoever granted it, and we cannot verify that someone is a country; a domain
explains itself and anyone can re-check it. Do not "simplify" it into a tick.

- **DNS is the source of truth.** The backend stores only which domains to look up for an
  address, because domains cannot be enumerated from an address, and re-checks live on
  every read. Removing the TXT record is the revocation, and it is immediate.
- **`lookup_failed` must never strike a badge** or be shown as "not published". It says
  nothing about the domain, which is also why it is not cached.
- **The three failure outcomes stay separate** (`no_record`, `address_mismatch`,
  `lookup_failed`): each is fixed differently, and DNS propagation makes a first failed
  check the normal first answer rather than a bug.
- **The domain is snapshotted into the election metadata** at creation, like the name, and
  re-checked at display. A lapsed one shows struck through instead of vanishing.
- **No badge is normal, not suspicious.** Most organizers will never own a domain, and
  making them look deficient would only push them to fake it.
- A contract cannot do the lookup: DNS is non-deterministic and would break consensus.
- Navigation (`TopNav`, `BottomTabNav`) is driven ONLY by auth state, never by the page

## Voter identity (Semaphore)

`src/lib/semaphore.ts`, `src/lib/passkeyPrf.ts`, `src/lib/identityVault.ts`.

A voter has exactly ONE Semaphore identity. Two active identities for one human would
produce two independently countable ballots that no contract could correlate, so
multi-device support means the SAME secret unlocked from each passkey, never a new
identity per device.

- **The secret is sealed once per passkey** in the encrypted vault:
  HKDF-SHA256(WebAuthn PRF) then AES-256-GCM. The issuer stores ciphertext only and cannot
  decrypt it, so it cannot compute a voter per-election nullifiers.
- **A new device unlocks it** through `assertPrf([...credentialIds])`. Passing every known
  credential lets a synced passkey, or the voter phone over the WebAuthn hybrid/QR
  transport, answer the prompt.
- **Failure to unlock is loud.** `getOrCreateIdentity` throws `IdentityLockedError` rather
  than minting a second identity, which the registry would refuse and `enroll` would reject
  much later with an unrelated error.
- **Recovery** (`/voter/re-verify`) needs a FRESH World ID proof, not the session: it
  rebinds the on-chain commitment through `PlatformRegistry.rotateMember`, so a stolen
  session must not be enough. The voter regains elections they had not joined, and is
  permanently refused in the ones they had.
- **Fallback (no PRF support):** a random identity in localStorage
  (`votain_semaphore_identity`), never published to the vault. Note it is NOT registered on
  chain, so on Amoy it cannot enroll. See docs/ai/state.md for the open decision.
- **Never trust `prf.enabled` from a creation.** Windows Hello does not evaluate the PRF
  while creating a credential and reports `enabled: false` while being fully capable, so
  gating on it rejects every Windows Hello voter. Only the PRF value itself is evidence.
  Creation asks for `prf: { eval: ... }`, and when the authenticator answers there the
  voter is spared a second ceremony. If a creation fails, retry `prf.eval` then `prf` then
  no extensions IN THAT ORDER: a credential minted without the extension has no
  hmac-secret and can never do PRF.
- **Never mint a passkey without `excludeCredentials`.** One machine has one authenticator
  but one localStorage per browser, so a second browser sees no cached credential id and
  would create a duplicate passkey for an authenticator that already holds one. The
  authenticator knows what it holds: give it the vault's ids and it refuses with
  `InvalidStateError`, surfaced as `PasskeyAlreadyRegisteredError`. That refusal does not
  say WHICH credential, so `enrollThisDevice` then asserts to identify and cache it,
  which is what makes the profile show the device as registered.
- **A missing cached credential id never means a missing passkey.** `derivePrfSecret`
  asks the authenticator for an existing credential (`assertPrf([])`) before creating one.
  For the organizer this is load-bearing: their Paillier tally key is re-derived from the
  passkey rather than stored, so a new credential would be a new key and every election
  they created would stop decrypting.
- `votain_identity_mode` records which mode is active.
- **Signing out clears the identity** (`clearIdentity` from `voterSignOut`). Leaving it
  behind let the next person on the browser inherit the previous voter's identity, since
  `getOrCreateIdentity` returns the stored one whenever the mode is "local". Organizer
  sign-out keeps `votain_paillier_sk_*`: those decrypt results of live elections.

## src/ structure

```
src/
├── App.tsx                    # routes + AuthProvider + ToastProvider
├── main.tsx                   # flag-emoji polyfill, reduced-motion, mount
├── contexts/AuthContext.tsx
├── i18n/
│   ├── config.ts              # i18next config + auto-detect
│   └── locales/               # 13 languages: en, es, fr, de, pt, ar, hi, it, ja, ko, nl, ru, zh
├── hooks/useWorldIdVerify.ts  # real World ID -> backend verify -> VC cookie
├── pages/                     # public/ voter/ organizer/ shared/ dev/
├── components/
│   ├── layout/                # PageLayout, TopNav, BottomTabNav, Footer, Header
│   └── ui/                    # design system (Button, Card, Badge, Modal, BackButton, …)
├── data/
│   ├── seed.ts                # hardcoded elections (6, all phases + 4 voting types)
│   └── languages.ts
└── lib/                       # contracts, deployments, relay, semaphore, identityVault,
                               #   paillier, tally, logs, worldId
```

## Design-system rules

- Any CTA-looking button MUST use `components/ui/Button` (never restyle a raw `<button>`).
- Back links use `components/ui/BackButton`.
- Native `<select>` is forbidden in pages: use `Select` from `components/ui/Input`.
- Dropdowns/popovers use Radix primitives (portal-based): never `absolute z-*` inside cards
  (`backdrop-blur` creates stacking contexts that trap z-index).
- Raw `<button>` is fine for tabs/pills/rows/icon-inline actions; global CSS restores
  `cursor: pointer` (Tailwind v4 defaults to `cursor: default`).

## Color palette (dark mode iOS 26 Liquid Glass)

```css
--background: #0a0a0f
--primary: #4F8EF7       /* cold blue */
--secondary: #7C5CFC     /* violet */
--tertiary: #00D4FF      /* cyan */
--surface-low: #1b1b20
--on-surface: #e4e1e9
--on-surface-variant: #c2c6d5
```

## i18n

- 13 active languages (see `src/i18n/locales/`).
- Flat keys: `"section.key"`, no nesting.
- Browser auto-detect (IP-detect pending from H4).
- **Never** hardcode text strings. Always use `t('key')`: including inside `components/ui/`.
- When adding a key, add it to ALL 13 locale files (a Node script over JSON.parse beats 13 manual edits).

## Current phase: Phase B, chain-connected

When a deployment manifest resolves (`src/lib/deployments.ts`), every screen reads real
chain state and the seed data is not used. Without one, the app falls back to
`src/data/seed.ts` and shows the demo banner. Voter writes are relayed through
`ElectionPaymaster`; organizer writes are signed by their own EOA.

## Mandatory responsive validation

Each new/changed screen: verify at mobile (375x667), tablet (768x1024), desktop (1440x900)
with Playwright MCP. Save evidence to `docs/progress/H<n>/screens/<name>/`.

## Commands

```bash
npm run dev          # http://localhost:5173
npm run build        # tsc + vite build (no sourcemaps)
npm test             # vitest run (e2e/ excluded)
npm run test:e2e     # playwright (requires: npx playwright install chromium)
npm run lint         # eslint
```

## Required environment variables

```bash
VITE_BACKEND_URL=http://localhost:3000
VITE_WORLD_ID_APP_ID=        # App ID from World ID Developer Portal
VITE_WORLD_ID_RP_ID=         # RP ID (same as App ID in staging)
VITE_WORLD_ID_ACTION=        # Action name (e.g. vote-registration)
VITE_CHAIN_NETWORK=amoy
VITE_CHAIN_ID=80002
# rpc-amoy.polygon.technology is dead. Tenderly is the only free Amoy endpoint
# that serves eth_getLogs over the full block range, which queryFilter needs.
VITE_RPC_URL=https://polygon-amoy.gateway.tenderly.co
VITE_AMOY_RPC_URL=https://polygon-amoy.gateway.tenderly.co
# Contract addresses. Override-only: the deploy script writes
# src/lib/deployments/<network>.json and the client reads it automatically.
# Leave BLANK rather than deleting; an empty value is treated as unset.
VITE_ELECTION_FACTORY_ADDRESS=
VITE_PLATFORM_REGISTRY_ADDRESS=
VITE_PAYMASTER_ADDRESS=
```

## Chain integration layer (Phase B)

The UI stays presentation-only. A thin data layer maps chain state to the same `Election`
type the Phase A screens already consume, and falls back to `data/seed.ts` when contracts are
not configured (`isChainConfigured()` is false).

```
src/lib/
├── deployments.ts     # resolve addresses (manifest glob or VITE_* env)
├── contracts.ts       # ethers v6 clients + human-readable ABIs
├── chainElections.ts  # ElectionV4 state → Election UI model; members from events
├── paillier.ts        # homomorphic ballot encryption (base-1e6 packing)
├── semaphore.ts       # identity, group-from-events, nullifier, vote proof
├── identityVault.ts   # seal/unseal the Semaphore secret per passkey
├── relay.ts           # voter calls submitted through ElectionPaymaster
├── logs.ts            # queryFilter from the deployment block, windowed on strict RPCs
├── worldId.ts         # shared IDKit request (login and recovery)
├── tally.ts           # in-app homomorphic tally
├── voting.ts          # enroll / castVote / history (voter actions)
└── organizer.ts       # createElection (+ Paillier keygen), lifecycle, gas
src/hooks/
├── useElections.ts       # chain-aware list/detail (seed fallback)
└── useOrganizerWallet.ts # injected EOA + chain enforcement (organizers)
```

Key rules:
- Voters never hold an EOA and never send their own transaction. Everything goes through
  **`ElectionPaymaster`**, which reimburses the relayer from the organizer gas tank. That is
  not only about gas: a per-voter sending address would publicly link a voter enrollment to
  their ballot and defeat the Semaphore proof.
- Organizers use an **injected EOA** (MetaMask) to deploy/manage and pay for it.
- The election's **Paillier private key** is generated at creation and stored in localStorage
  (`votain_paillier_sk_<address>`); the organizer exports it for the tally CLI. Known
  limitation (documented for the thesis): production would seal it to the organizer's
  passkey via WebAuthn PRF, as done for the voter's Semaphore identity.
- History/receipts can prove *that* and *when* you voted, never *what*: the candidate is
  unrecoverable on-chain by design.

## Extra env (Phase B)

```bash
VITE_CHAIN_NETWORK=amoy          # deployment manifest to load
VITE_CHAIN_ID=80002
# Contract addresses are read from src/lib/deployments/<network>.json automatically
# (written by the deploy script); VITE_*_ADDRESS only needed to override.
```

## Remaining

- IP-based language auto-detect (H4 leftover).
- `@sd-jwt/present` upgrade to 0.20 when published.
- Live wiring verified end-to-end once contracts are on Amoy (needs user's deploy).

## Target deployment

**Fleek free tier (IPFS)** with automatic CD from GitHub `main`.
