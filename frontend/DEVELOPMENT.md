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
- **Where the badge appears**: election cards, the dashboard list, the voter detail, the
  public preview and the organizer's own management page. `interactive` (tap reveals the
  explanation, since touch has no hover) is ON only where the badge stands alone. Inside a
  clickable card it would be a button nested in a button, and the tap would be stolen from
  the card; those cards lead to a detail page where it IS interactive.
- **Discover filters by live status, not by the stored field.** Whether a domain verifies
  is a DNS answer, so the page resolves it once per DISTINCT organizer/domain pair rather
  than per card. Only "verified" is offered as a chip: no domain is the normal state for
  most organizers, and a chip for its absence would read as a category of suspicion.

## Dates in the create wizard

Deadlines are judged by `block.timestamp`, so the wizard reads the CHAIN's clock and uses
it for both validation and the pickers' lower bound. The browser clock is only a fallback
for the no-chain seed mode. A local node seeded with time jumps can sit days ahead, and
when the two disagree by more than five minutes the error names the chain's time rather
than saying "must be in the future", which reads as plainly wrong to someone looking at
their own calendar.

Bounds carry the time, not just the day, and the picker clamps to them on BOTH paths:
editing the hour spinners and selecting a day. Selecting a day used to land on 00:00,
under a bound of 20:25.

With no separate enrolment window, the earliest selectable vote start sits
`MIN_VOTE_LEAD_MS` ahead: `enrollStart` is stamped at submission and `enrollEnd` IS the
vote start, so offering the current instant hands the organizer a deployment the contract
refuses. Anything under a day still gets a warning rather than an error, because a short
notice is legitimate for a group already waiting and only the organizer knows which case
they are in.
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

## Installable, and findable

The app shipped with a four-line `<head>`: one title for every route, no
manifest, no icons beyond a favicon, no `robots.txt`, no `sitemap.xml`. A
crawler saw one page called "Votain" and Chrome offered no way to install
anything.

### The install half

`public/manifest.webmanifest` plus PNG icons at 192, 512 and a 512 maskable.

**Transparency is decided per icon, not once.** The `any` icons and the favicon
are transparent, because the launcher and the browser chrome supply their own
ground and a baked-in dark square would sit as a black tile on a light one. The
maskable icon cannot be: Android crops it to a circle or a squircle, so it
carries the brand ground and keeps the mark inside the 80% safe zone. The
apple-touch icon is opaque too, since iOS composites transparency onto black
rather than leaving it, and an explicit colour is more predictable than
whatever that resolves to. `theme_color`
and the `theme-color` meta carry the same value, since one paints the task
switcher and the other paints the browser chrome before the manifest is parsed.
iOS ignores the manifest, so `apple-touch-icon` and the two `apple-mobile-web-app`
metas are there as well.

**The service worker is network first, and that is a decision rather than a
default.** Chrome will not offer "Install app", and Android will not mint a
WebAPK, without a worker that handles fetch. Putting a cache in front of a
voting application is a liability: a stale shell is old verification code
running against a new backend, and nobody can see it happen. So the network
answer always wins, the cache only answers when there is no network, and a
deployment takes effect on the next load. Cross-origin requests, non-GETs and
`/api/` are never cached at all: a cached answer from the RPC or the issuer
would be a lie about the state of an election. It registers in production only,
because a worker in front of the dev server serves yesterday's modules with
today's edits.

### The findable half

- `src/seo/publicRoutes.ts` is the one list of indexable routes.
  `src/seo/seoPlugin.ts` renders `robots.txt` and `sitemap.xml` from it at build
  time, using `VITE_PUBLIC_URL`. Neither file is checked in, because both need
  an absolute origin, and a hostname baked into a static file is one nobody
  remembers to change. The origin comes from `VITE_PUBLIC_URL`: `.env` locally,
  a real environment variable on the host in production, since no env file is
  deployed. A build that cannot find it fails rather than emitting a site with
  no sitemap and an empty canonical. The production origin is
  `https://votain.app`; being a `.app` domain it is HSTS preloaded, so it is
  HTTPS only, which is also what the service worker needs to register.
- **Election pages are crawlable but unlisted.** They live on chain, so a static
  sitemap cannot enumerate them and one generated at build time is stale the
  moment an organizer deploys the next election. Crawlers find them through
  Discover, which is what links to them.
- **`/voter/*` and `/organizer/*` say no twice.** `robots.txt` asks a crawler
  not to fetch them, and `useRouteMeta` writes `noindex, nofollow` into any page
  under those prefixes for a crawler that ignores it or arrived from elsewhere.
  Neither is a security boundary; the route guards are.
- `usePageMeta` gives each page its own title and description, from the heading
  it already renders, so there is no second set of SEO-only strings to drift
  from the visible ones. The election preview titles itself with the election's
  name, which is what a shared link should say. A page that sets no description
  restores the document default: leaving the previous page's behind had the
  terms page describing how the protocol works.
- `public/_redirects` serves `index.html` for every path. Without it a deep link
  to `/discover` is a 404 on a static host, which is also what a crawler records
  for a page that exists.

`landing-background.jpg` became a 1440px WebP on the way through: 1055 kB to
202 kB, on every page, for an image that renders at ten to twenty eight percent
opacity behind everything.

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
├── countries.ts       # ISO 3166-1 alpha-3 table, localised names, flags, search
├── eligibility.ts     # attribute policy, its hash, and the voter-side challenge
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
- History/receipts prove *that* and *when* you voted. They do not reveal *what*,
  but say why precisely: the ballot is a Paillier ciphertext in the `VoteCast`
  event, paired with the voter's nullifier, and the receipt shown to the voter IS
  that nullifier. So the choice is hidden by the tally key being secret, not by
  the chain being unable to hold it. Anyone with a voter's receipt AND that key
  reads their vote, and every re-vote they made. The key never leaves the
  organizer, is never published as an audit artefact, and the management page
  stops offering to export it once an election is decided (see below).
- The nullifier is not an identity: Semaphore keeps it unlinkable from the
  enrolment commitment, so the key alone yields an anonymous table of votes and
  deanonymizes nobody. It is the pairing with a receipt that matters, which is
  also why it weakens coercion resistance rather than privacy in general.

## Vote references never render at full length

A reference is a 32-byte nullifier as hex: around 60 characters with no spaces,
so it is a single unbreakable token that runs straight off a phone screen.
`shortenReference` in `lib/utils.ts` keeps both ends, which is what someone
compares when checking a receipt, and it is display only: every place that offers
one copies or verifies the full value.

The confirmation screen already did this inline; the helper is that logic moved
somewhere the other three callers could reach. The election detail card now
shortens and gains a copy button, because shortening without one would take away
the value the voter came for. History rows shorten. `VerifyReceipt` keeps the
full string and only allows it to wrap: that page exists for comparing a
reference against a record, so it is the one place the whole thing must be
readable.

## Coercion: what actually defends, and what only looks like it

The receipt shown to a voter is their nullifier, and the `VoteCast` event pairs
that nullifier with the ballot ciphertext. So a coercer holding both a receipt
and the tally key reads the vote. Two ideas for closing that turn out to be
worth writing down, one because it fails and one because it works.

**Deriving the receipt from the nullifier does not help.** A one-way function of
the nullifier looks safer, but the attacker never has to invert it: they compute
it over every nullifier on chain, of which there are only as many as there are
voters, and match. One-wayness buys nothing when the input space is small and
public. More fundamentally, any receipt that lets a voter confirm their ballot is
on chain also lets them point at it. That is the same capability, and it is the
classic tension between individual verifiability and receipt-freeness rather than
a formatting problem.

**Re-voting is the defence, and it holds even against a coercer with the key.**
The tally keeps only the highest nonce per nullifier (`tally.ts`), so a coercer
can read a ballot but can never know it is the final one. To be certain they
would have to control the voter at the moment voting closes, which is a far more
expensive attack than reading a receipt.

**The threat that stays open is the organizer.** A coercer only holds the key if
the organizer leaked it or is the coercer, and the second case breaks the
property outright. The structural answer is threshold decryption, splitting the
key so no single party can decrypt alone. Votain has one key and one organizer,
so the honest claim is coercion MITIGATION through re-voting, in the Estonian
sense, not receipt-freeness in the JCJ or Civitas sense. Worth a paragraph in the
thesis rather than a silent gap.

## The tally key disappears once the election is decided

Export and import of the Paillier key exist for one reason: making sure the tally
CAN be run, on this device or another. A closed, voided or cancelled election has
either had its tally published or will never have one, so both actions are gone
from that point and a line explains why.

Removing the export is not only tidiness. Every ballot is a Paillier ciphertext
stored publicly on chain, and that key is the only thing between those
ciphertexts and reading them one at a time. Writing a fresh unencrypted copy of
it into a Downloads folder is worth doing while it protects against losing the
ability to count, and is pure liability afterwards. The replacement note says to
delete the copies, and says why.

Worth stating for the thesis: this is also why the key must never be published as
an audit artefact. Handing it to a verifier would let them confirm the tally, and
also read every individual ballot. A system that wants third-party verification
of the count publishes a proof of correct decryption instead, which Votain does
not implement. The count is verifiable here in the weaker sense that it is
immutable and its inputs are public, not in the sense that a stranger can
recompute it.

## Radix Selects are controlled, so a tap can close them

Radix opens a Select on `pointerdown` for a mouse, but on touch and pen it opens
on `click`, and that handler only opens: it never toggles. Tapping the trigger
while the list is open runs the dismiss layer first, which closes it, and then
the trigger's click, which reopens it. On a phone that reads as a very fast
closing animation followed by a list that will not go away.

`useTapSafeSelect` takes control of the open state and ignores an opening that
lands within 300ms of a close. A deliberate second tap is far slower than the
reflex being guarded against, so nothing a person can actually do is swallowed.

Both `LanguageSelector` and `SelectMenu` use it, which is every Radix Select in
the app. Any new one should too.

## The results chart gives labels a line of their own on narrow screens

`ResultBarChart` put the option name in a fixed 7rem column with `truncate`,
which cut off any name longer than a word or two. On a phone that meant a set of
results with the choices themselves unreadable, and the blank-vote label is a
sentence in most locales: 27 characters in Spanish, 31 in Russian.

The row now wraps. The label takes a full line below `sm` and only sits beside
the bar once there is room, and it no longer truncates at any width: a candidate
name is the one thing on that chart that cannot be inferred from what is left of
it. Percentages and counts keep their column.

## Published results are shown, not linked

A decided election has its totals on chain, so both the voter page and the public
preview render the breakdown inline with `ResultBarChart`, the same component the
full results page uses. Someone opening a decided election's link is asking who
won, and a bare candidate list with a button to go and see the answer elsewhere
withholds it.

The full results view still exists and is linked from inside that card: it
carries the verification badges and the audit trail. What it no longer gets is
the footer call to action, which would have sent the reader away from the page
they were already on.

`hasPublishedResults` decides this in one place, keyed on the tally being
present. It used to be three conditions in three files, and two of them tested
`ipfsCid`, which is empty for every tally run in the app.

## Tally key derivation cost

The organizer's Paillier key is re-derived from the passkey PRF secret rather
than stored, which means a 2048-bit key is generated in the browser every time an
election is created. That is pure BigInt work: **nothing in the path touches the
chain or the network**, so the cost is identical on a local node and on Amoy.

The prime search discards candidates by trial division against the primes below
10000 before running Miller-Rabin, and screens survivors with a single MR round
before paying for the full forty. Roughly seven candidates in eight never reach a
modular exponentiation. Measured in the vitest environment, one derivation went
from **43.7s to about 6.5s**.

Both filters are exact, not probabilistic shortcuts: trial division rejects only
numbers a small prime divides, and the one-round screen rejects only numbers
Miller-Rabin proves composite. Neither can skip a value the original walk would
have accepted, so the derivation is unchanged.

**`tallyKey.test.ts` pins the derived keypair for a fixed secret and nonce.** The
derivation is a compatibility surface, not an implementation detail: a change
that yields a different key silently makes every election created before it
undecryptable. If that test fails, the fix is not to update the vector.

What is left is unavoidable arithmetic, and a handful of seconds of frozen tab
still reads as a crash. The create wizard should say what it is doing between the
passkey prompt and the wallet prompt.

## What an election asks of a voter, and where that claim lives

The eligibility list said "World ID verified", which answers the wrong question:
the levels are different bars, and a voter who can only reach the lowest needs to
know before they get their passport out. It now names the level the election
actually sets.

Two things the first attempt uncovered:

- **`requireOrb` was a dead toggle.** It existed in the create wizard, was
  rendered as a Switch, and went nowhere: never passed to `createElection`,
  never written to metadata, never read back.
- **The organizer could not see the platform requirement at all.** The entry
  requirements card only rendered for attribute policies, so an election with no
  age or nationality rule showed nothing. It now always renders.

Persisting the flag fixed the display and left the real problem: `requireOrb`
sat at the TOP LEVEL of the metadata, outside the bytes `eligibilityPolicyHash`
commits to. Nothing could be held to it. The level therefore moved into the
policy as `personhood`, one of `device`, `document` or `orb`, where the on-chain
hash covers it and the backend recomputes it before signing anything.

- `effectivePersonhood(policy)` is how it is read, never the raw field. An
  attribute policy is `document` whether it says so or not, because the scan it
  already costs is the one that yields the deduplicating nullifier.
- `isEmptyPolicy` now means "asks nothing beyond being signed in". A policy
  holding only `personhood: "document"` is a real policy: attester, non-zero
  hash, and a Self scan that discloses nothing. The wizard defaults to it, and
  the restricted filter counts it, through the same predicate the badge uses.
- `requireOrb` is still READ, for elections deployed before the move, and
  written by nothing. `lib/organizer.ts` no longer emits it.

### The sign in screen was still promising one vote per person

`verify.description` read "We use World ID to ensure one vote per person. Your
biometric data never leaves your device". The second sentence is still true. The
first stopped being true when personhood moved to the document: sign in accepts
whatever World ID credential a voter holds, so its nullifier identifies an
ACCOUNT, and somebody with two of them holds two. One vote per person is a
property of a gated ELECTION now, enforced by the document nullifier the
contract deduplicates on.

It says what it does instead: World ID signs you in anonymously, it identifies
an account rather than a person, and each election sets for itself how strongly
a voter must prove they are one human. Worth keeping accurate rather than
reassuring, since the whole point of the migration was that the old sentence was
a claim nothing backed.

The two privacy strings beside it (`privacy.summary_1`, `privacy.worldid_2`)
were checked and left alone: nothing about the migration made them false.

## Two ballot options that read the same are one option

Uniqueness of candidate names was `new Set(names.map(n => n.toLowerCase()))`,
which is right about case and blind to two other ways of writing the same line:
a precomposed `é` against `e` plus a combining accent, and runs of whitespace,
which HTML collapses when it renders. Either pair reaches the voter as the same
words twice. The vote is cast by POSITION, so the tally stays correct while the
intent behind it does not, and the voter has no way of noticing.

`lib/ballotNames.ts` owns the rule now: NFC, collapse whitespace, lowercase. It
deliberately does not strip accents, because `Jose` and `José` are different
names and an organizer is entitled to both.

It is applied in three places, and the third is the only one that cannot be
bypassed:

1. The wizard, so the organizer is told while they can still fix it.
2. `createElection`, which throws before a transaction exists. This is the last
   code the app runs, not a defence against a transaction built by hand: an
   election can be sent straight to the factory, and nothing about creation
   passes through a server that could refuse it.
3. `fetchElection`, where `withDistinctNames` appends the ballot position to
   options that collide. Nothing reaches a voter except through this path. A
   contract-level check is not the alternative on offer: the names live inside a
   JSON string in `metadataJson`, and parsing that on chain is neither practical
   nor worth its gas. It runs AFTER the results are attached, because it returns
   new objects and would otherwise drop the vote counts written onto the
   originals.

The blank-vote option is what makes the read side more than belt and braces. It
is appended when an election is READ, in the reader's language, so no rule in
the wizard had ever compared against it and a candidate could be given its exact
name. The wizard now refuses that collision in the organizer's own language, and
the read path catches it in every other.

## The public verifier, which was verifying nothing

`VerifyReceipt` searched `VOTER_HISTORY`, the hardcoded demo data in
`data/seed.ts`. Against a real deployment it found nothing and always would,
which made the one public verification tool the only screen in the app that
never touched the chain.

It now goes through `findVoteReceipt` in `lib/voting.ts`, reading the same
public `VoteCast` events the voter's own history reads. Two ways in, and the
ambiguity between them is worth knowing about: a nullifier is a field element
and prints at exactly the same width as a transaction hash, so a `0x` string of
32 bytes could be either and nothing about it says which. The transaction
lookup runs first because it is one request and settles the question; only when
no such transaction exists is the string tried as a nullifier, which costs one
`queryFilter` per election.

**It stays unauthenticated, and that is the point.** The value of publishing a
nullifier is that a THIRD party can check a receipt somebody shows them: an
auditor, a journalist, a losing candidate. Folding it into the voter's history,
which is the obvious simplification, would turn a property of the system into a
convenience for one person. So the two stay separate, and the seam between them
is a `?ref=` link: the history offers a copy button and a verify button per row,
and the verifier accepts the reference in its URL. Signed-in voters also get
their own receipts listed under the search box as shortcuts, because nobody
memorises a nullifier, but the page works identically with no session.

Reachability was the other half of the same mistake. The only links were in the
voter profile and the post-vote confirmation, so the one audience it exists for
could not find it. It is now in the public top nav and the footer, and the title
says "Verify a vote" rather than "Verify your vote", which is what it actually
does.

Two things fixed on the way:

- **The history's nullifier was truncated to 16 hex characters.** Not a privacy
  measure, since the full value is already public in the event; it just meant
  the CSV export and the on-screen receipt gave the voter a string that could
  not be looked up.
- **Every history row opened the results page**, so a vote in an election still
  running led to a screen whose only content was "no results yet". The
  destination now comes from `hasPublishedResults`, the shared predicate, rather
  than from a list of phases: `closed` is necessary but not sufficient, because
  an election can be closed with its tally unpublished.

## What a green tick on the requirements list is claiming

Three rows, and each was saying something slightly different from what was known.

**The level row was promising.** It went green on `commitment !== null`, which
proves this browser holds a Votain identity, not that the voter meets THIS
election's bar. Once the personhood level started being enforced, that put a
green tick in front of device-level voters looking at an Orb election, who were
then refused at enrollment with `orb_required`. It now asks
`personhoodSatisfied(required, held)`, where `held` comes from the session's own
level, reported by `GET /api/me` and parked in localStorage by `AuthProvider`.
That cache is a display hint and never a boundary, exactly like the
`votain_voter_logged_in` flag beside it: the binding check reads the level out
of the signed credential, server side, at the moment it is asked to sign.

**The attribute rows were understating.** They were hardcoded to `unknown`
forever. Before enrollment that is exactly right, and must stay: the proof runs
on the voter's phone and never reaches this browser, so a green tick would be an
invention. After enrollment the chain knows, because the contract refuses
`enrollAttested` without a signature the attester only produces once a document
proof has cleared that exact policy. Membership IS the evidence, so enrollment
turns every row green.

One nuance worth keeping: the inference holds relative to the attester the
ELECTION declared, which is not always ours. That is still the party the
election chose to trust, and the policy hash still fixes the rules it was gated
on, but it is not our signature in every case.

## Telling the voter why a transaction failed

`ElectionDetail` caught a failed enrollment, logged it, and set a boolean.
`TransactionPendingModal` had taken an `errorMessage` prop the whole time and
nobody passed it, so every failure read as "transaction failed". The create
wizard had the same omission; the vote path kept the message but showed it raw
and in English. All three go through `relayErrorMessage` now, which names seven
reverts in all thirteen locales and falls back to the raw text, because an
unrecognised failure is more useful verbatim than flattened.

The reason it stayed hidden so long is worth knowing. `isTankEmpty` looked for
the text "insufficientbalance", and that text never appears. Measured against a
local chain with a drained tank, ethers raises:

```
execution reverted (unknown custom error) (action="estimateGas", data="0xf4d678b8", revert=null)
```

Gas estimation fails at the PROVIDER, which has no ABI, so declaring the custom
errors on the contract does not give this one a name either. The selector in
`error.data` is all that survives. `revertNameOf` reads it against a table whose
every entry a test recomputes from its signature, and also scans the message
text, which is the Amoy path: there the relay runs on the server and the browser
receives a string rather than an error object.

## Switching between the two views of an election

`components/ui/ViewAsSwitch.tsx` with its rules in `lib/electionViews.ts`. An
organizer managing an election had no way to see what a voter sees, which is the
thing they most need to check before it opens, and a voter view of an election
they own had no way back to the controls except through the dashboard.

Two details that are not obvious:

- **There is no single "voter view".** Discover sends a signed-in voter to
  `/voter/election/:id` and everyone else to the public `/election/:id`, so
  `voterViewHref` makes the same choice from `voterLoggedIn`. Otherwise the
  organizer would be shown a page they could not have arrived at.
- **The organizer direction needs both halves of `canManageElection`.** Owning
  the election without a live organizer session offers a route `RequireOrganizer`
  bounces; a live session on somebody else's election offers a page that refuses
  to load. It appears on the public preview AND on the voter detail page, because
  which of the two an organizer lands on depends on whether they are also signed
  in as a voter.

## Plurals

Every string interpolating `{{count}}` needs one form per plural category the
language actually uses, and that is not two everywhere: Spanish, French,
Portuguese and Italian add `many`, Russian has four, Arabic six, and Chinese,
Japanese and Korean have exactly one. `Intl.PluralRules` is the authority;
`src/i18n/plurals.test.ts` asks it rather than assuming.

The suffixes are the CLDR category names (`_one`, `_other`, `_few`, …), which is
i18next's JSON v4 format. **`_plural` is the v3 format and this version ignores
it**, silently falling back to the unsuffixed key. That is how the results line
read "13 elección": the plural translation was there, correct, and dead. The test
forbids the suffix and forbids leaving an unsuffixed form beside the suffixed
ones, since that is the other way the singular disappears.

## Election filters are shared, not copied

Discover and the organizer dashboard filter different sets of elections but
offer the same filters, so all of it lives in one place:

- `lib/electionFilter.ts` owns the state shape, the empty value, the
  "is anything active" predicate and the matching rule.
- `components/ui/ElectionFilters.tsx` is the bar itself, fully controlled. Its
  property filters (verified domain, has requirements) are hueless chips rather
  than `Badge`s: every colour in the palette is already a phase (primary is
  `enrolled`, secondary `tallying`, tertiary `pending_vote`, warning `tie`,
  error `cancelled`, yellow `enrolling`, green `active`), so any hue picked for
  them could only collide with a state. Contrast alone carries the on/off.
- `hooks/useVerifiedDomains.ts` resolves domain verification once per distinct
  organizer and domain pair, and hands back a predicate.
- `components/ui/EligibilityChips.tsx` shows an election's entry requirements.
  A component rather than a snippet because the summary comes from a hook, which
  cannot be called from inside a list callback.
- `restrictedOnly` is a separate filter from the age and nationality inputs
  beside it. Those ask "would I qualify", which an unrestricted election
  satisfies trivially, so it matches every value; this asks "which of these have
  requirements at all", which no combination of the inputs can express.

### The filter panel is four bands, not one row

Everything sat in a single wrapping row: phase pills, two property chips, then
the four voting rules, all the same distance apart. They are four independent
questions, and running them together made them read as one long list of
alternatives, so the chips that wrapped onto a second line looked like more of
whatever the line above was. Each band now carries a caption and a hairline rule
above it. Nothing about how a filter behaves changed.

The last band is the only one asking about the VOTER rather than the election,
which is the distinction `restrictedOnly` and the age and nationality inputs
always had and never showed: "which of these have requirements at all" against
"would I qualify".

Two things the bands exposed once they were bands:

- **The eligibility controls did not fit a phone.** Two personhood chips, a
  label, two age boxes, another label and a country search were one wrapping
  row, which on a 390px screen left about forty pixels for each number and put
  the country search alone on a line at a third of its width. Each group is now
  its own row below `sm:` and they return to one line above it.
- **Clearing lived only in the empty state.** `Discover` offered it when a
  filter had hidden everything, which is the one moment the person can already
  see something is wrong. Two chips and an age bound that merely narrow the list
  are harder to notice and just as tedious to undo one at a time, so the panel
  carries the button whenever anything is on. It resets the search box too,
  since that sits above the bands and narrows the same list.

The results count is spaced off the panel rather than butting against it. It is
a statement ABOUT the filters, and with no gap it read as one more line of the
panel, directly under the clear button.

### Card stats are a grid, because four facts of different widths are not a row

`ElectionCard` put the rule, the enrolled count, the turnout and the date in one
flex row with `flex-wrap` and `ml-auto` on the date. Four values of very
different widths ("Two-thirds majority" beside "0 enrolled") meant the row broke
in a different place on every card, and the date landed on the first line or the
second depending on what sat beside it. Nothing was misaligned within a card and
the wall of cards still read as ragged.

Each fact now has its own cell in a fixed `grid-cols-[1.35fr_1fr]`, pinned with
`col-start` and `row-start` so a card with no turnout figure leaves that cell
empty rather than reflowing the other three. The first column is the wider one
because it carries the voting rule, the longest label in the group in every
language.

### Requirements are shown, not labelled

`EligibilityChips` deliberately does not use `Badge`. Every Badge variant is the
same shape, an uppercase translucent pill with a ring, which is the vocabulary of
election PHASE; a restriction rendered in that vocabulary read as another status
and vanished beside one. The chips are square-cornered, solid, mixed case and
carry an icon.

They also show the rules rather than the word "Restricted". Someone scanning a
list wants to know whether THEY qualify, and "18+" beside a Spanish flag settles
that at a glance where a generic label only raises the question and sends them
into the election to find out. The full sentences stay in the `title`, and on the
election page, so the short form never costs the precise one.

One rule holds across the app, and it is worth keeping: **a rounded-full
uppercase pill is a PHASE; a rounded chip with an icon is a PROPERTY.** Phase is
the only thing allowed to use hue as its primary signal.

Colour lives in the ICON, never in the fill. A solid amber block competed with
the phase pill beside it, which is already yellow while an election is enrolling,
and read as a warning rather than as a fact about the election. The chips sit on
the same neutral surface as the rest of a card's metadata; only the blocked-
countries icon takes a colour of its own, because it is the one rule that
excludes rather than admits.

They were copies before, and the copies drifted: the dashboard had the age and
nationality inputs but no phase chips and no restricted badge, so an organizer
could not narrow by state and could not tell which of their own elections were
restricted. Discover's "clear filters" also reset three filters by name and left
the rest on, which could leave the list still empty after clearing it.

## Attribute eligibility (age, nationality)

An election can restrict enrollment to voters who prove a minimum age or a
nationality from their passport chip.

**Organizer side**, in step 3 of the create wizard, off by default. The policy is
written into `metadataJson` and its `keccak256` into the contract, so anyone can
recompute one from the other. The attester address is fetched from the backend at
creation time and frozen into the election: it cannot be changed afterwards,
which is what makes the restriction something voters can rely on rather than
something the organizer can rewrite mid-election.

Countries are chosen through `components/ui/CountryPicker.tsx`: type part of a
name, pick from the filtered list, and the selection appears as removable cards
with flags. Nobody types an ISO code, because nobody knows offhand that Spain is
ESP and a typo there silently produces a policy that excludes the wrong country.

`lib/countries.ts` stores only the alpha-3 to alpha-2 mapping. Names come from
`Intl.DisplayNames` in the active locale, so the list is translated into all
thirteen languages without a single string in the locale files, and flags are the
alpha-2 code rewritten as regional indicator symbols (`main.tsx` already installs
country-flag-emoji-polyfill for Windows). Search folds diacritics, so "espana"
finds España, and matches substrings so "korea" finds "South Korea". The policy
itself always speaks alpha-3: the alpha-2 code never leaves that module.

The voter sees the same treatment. `EligibilityCheck` lists requirements as
flagged, localised country names rather than "ESP, PRT", which asks the reader to
decode something they were never told.

The wizard says out loud that "allow only these countries" makes voters disclose
their nationality while "block these countries" does not. That asymmetry is not
ours: Self can only express exclusions, so an allowlist has to be checked against
a revealed value. An organizer choosing between the two should know which one
asks more of the voter.

**The policy travels with the election, not in a separate request.** It lives in
the on-chain `metadataJson`, and `chainElections` verifies it against the
`eligibilityPolicyHash` the contract stores, which is the same check the backend
makes before it will attest anything. A policy whose hash does not match is
treated as no policy and logged. Two consequences: lists and cards can show
restrictions without a request per election, and there is no second source of
truth to disagree with the first. An earlier version fetched it per election from
the backend, which added a failure mode and a state for not knowing; both are
gone.

**Restrictions appear at every level a decision is made.** A badge on the
election card, so someone scanning Discover or the dashboard can see an election
is not open to everyone before opening it. The requirements themselves on the
voter page, the public preview and the organizer's management page, the last of
which is also the only place an organizer can check what their own election was
gated on without reading the contract.

**Discover and the dashboard filter by age and nationality with the same
controls.** `EligibilityFilterControls` and `matchesEligibilityFilter` are shared
so the two lists cannot mean different things by the same input. Two decisions
worth keeping: an election with no age rule counts as requiring zero rather than
being excluded from every range, and the nationality control asks which elections
would ADMIT a country rather than which ones name it, so an unrestricted election
matches every choice. Filtering for "Spain" and losing every open election would
be the wrong answer to the question being asked.

**The restrictions are on the election page, not behind the enrol button.** Both
the voter page and the public preview list them in the eligibility card, beside
the other entry conditions, and carry a "Restricted" badge next to the phase so
nobody has to scroll to learn the election is not open to everyone. Someone
without a document to hand should be able to see that an election is not for them
without starting a flow to find out.

Status on those rows is `unknown` on purpose: nothing is known about whether this
particular voter meets them until they verify, and a green tick would be a claim
the app cannot make.

`usePolicyRequirements` writes the text once, so the election page and the
verification flow cannot describe the same policy differently. The public preview
fetches the policy itself, because that is the link people share, and fails quiet
there: the restriction is enforced on chain regardless, and the voter page is
where a failure needs reporting.

**Voter side**, `components/voter/EligibilityCheck.tsx`. Replaces the enrol
button while it runs, shows the requirements before asking for anything, opens a
challenge, polls the backend, then collects an attestation and enrolls with it.

The two ways in are mutually exclusive, not a QR with a link underneath. On a
phone the Self app is on this very device, so there is nothing to scan and the
voter gets a button, matching what `WorldIdVerify` already does and reusing the
same `isMobile` user-agent test. That link carries a `deeplinkCallback`, so Self
returns the voter here rather than leaving them to find the browser again. On a
desktop the app is on a different device, so the QR is the only bridge and the
callback is deliberately absent: it would redirect the phone, not the screen the
voter is watching.

The QR is drawn with `qrcode.react`, already a dependency, from a link the
BACKEND built with Self's own `SelfAppBuilder`. `@selfxyz/qrcode` is not used: it
is a React wrapper from the legacy SDK whose job is drawing a QR and holding a
websocket open, the drawing is three lines here, and the websocket is redundant
because the proof reaches our server directly from Self's relayer while this
component polls the session for the outcome. Keeping it out also keeps its React
version constraints out.

This app does not assemble the payload either, and that is the more important
half. A hand-copied version of `SelfAppBuilder`'s defaults went stale within two
SDK releases: it was missing `selfDefinedData` and carried a staging chain id
that had changed. Nothing fails loudly when that happens, it just produces a QR
the app half understands.

**The canonical policy serialiser is duplicated** between `lib/eligibility.ts`
and `backend/src/eligibility/policy.ts`, on purpose. The organizer's browser
computes the hash at creation and the backend recomputes it at enrollment, in
processes that never talk to each other about it. Any drift surfaces as a policy
that "does not match its published hash", which is exactly the alarm it should
raise, and both copies are one small deliberately boring function.

## Attribute rules only exist above the device level

The wizard used to offer the age and nationality switch at every personhood
level, including "World ID account only". That combination cannot be satisfied
by anybody: those attributes come from a document, and at the device level there
is no document to read them from. An organizer who set it got an election nobody
could enroll in, and found out from their voters.

The switch now renders only when the level is `document` or `orb`, and dropping
back to `device` clears what was already filled in (`eligibilityEnabled`,
`minAge`, `countryMode`, `countries`) rather than leaving it staged to be
serialised later.

Hiding a control is a courtesy, not a rule, so the same statement is made twice
more below the UI:

- `isCoherentPolicy(policy)` in `lib/eligibility.ts` is the predicate, false for
  a `device` policy carrying attribute rules. `createElection` checks it before
  building the config, so a caller that skips the wizard gets a message naming
  both fields instead of the contract's `InvalidConfig`, which names neither.
- `parsePolicy` in the backend throws on it, and `ElectionV4`'s constructor
  reverts `InvalidConfig`. The contract is the one that actually binds, since
  the other two run where an organizer could go around them.

## The organizer sees the ballot they published

`ElectionManagement` showed the title, the dates, the requirements and the
controls, but never the candidates. The one person who cannot check their own
ballot before voters see it was the organizer, and metadata is written once at
deployment, so a wrong option list is not something a later edit can fix.

The card renders above the actions, guarded by `election.candidates.length > 0`
so an election whose metadata carries none does not show an empty box. Names and
descriptions use `break-words`, because an option can be a single long token and
the card is the narrowest column on the page.

## One person, two sessions, one navigation

`AuthProvider` always kept the voter cookie and the organizer flag independent,
so nothing stopped one person holding both. The chrome could not say so. Both
bars resolved `organizerLoggedIn ? ORGANIZER : voterLoggedIn ? VOTER : PUBLIC`,
which means the moment an organizer also signed in as a voter the organizer nav
won outright and every voter route vanished from the navigation. The routes kept
working; there was simply no link left to them.

Merging the two navigations was the alternative and would have been worse. A
single bar carrying Dashboard, Members, Gas, My elections and History says
nothing about which hat the person is wearing, and the two roles deliberately
see different things about the same election. So the role stays singular and
becomes switchable.

- `lib/activeRole.ts` owns the rule. `resolveActiveRole(sessions, preferred)`
  consults the preference only when BOTH sessions are live, which is the only
  case with a choice in it. With one session the answer is that session, so a
  preference left behind by a signed-out role cannot strand anybody. With both
  and nothing chosen it answers `organizer`, which is what the old expression
  returned: the change is additive and nobody's navigation moves on its own.
- `TopNav`, `BottomTabNav` and the landing redirect all read `activeRole`, so
  the top bar, the bottom bar and where a signed-in visitor lands cannot
  disagree about who just arrived.
- `components/layout/RoleSwitch.tsx` is the control, rendered only when both
  sessions exist. Where it lands is `switchDestination`, not simply the new
  role's home: Discover, the receipt verifier and How it works read the same
  from both sides, so switching there stays put, and the two profiles are paired
  as the same page seen from the other side. Only a page belonging to the role
  being left is left behind, since voter navigation wrapped around the gas tank
  is the alternative. The two views of one election are deliberately NOT paired:
  the organizer view loads only for the wallet that owns it, so a header switch
  would land on a page that refuses, and `ViewAsSwitch` already owns that
  crossing.

**Signing in claims the role; restoring a session does not.** `setVoterLoggedIn`
is called by the sign-in screens and sets the preference with it, since the role
you just entered is the one you meant to use. The `/api/me` reconcile calls
`rememberVoterSession` instead, which restores the session and leaves the
preference alone. Sharing one function would have let every page load hand the
navigation back to the voter, and a preference that does not survive a reload is
not a preference.

**It decides chrome, never access.** Route guards keep asking the sessions
themselves, so switching to the voter view costs an organizer nothing, and
editing `votain_active_role` by hand buys an attacker nothing: the cookie and
`onlyOrganizer` are what actually gate anything.

The visible knock-on is on How it works, whose invitation to register was hidden
from organizers. That was never about the roles excluding each other, only about
the session being hidden the moment it was created. It is offered now.

## How an election is decided, said on the election

The voting rule was chosen in the wizard, written to the contract, and never
shown again. No view of an election named it, so a voter could not tell whether
their ballot fed a plurality, a two-thirds bar or a count of confirmations, and
the organizer could not check that what they deployed carries the rule they
picked.

`components/ui/VotingRule.tsx` renders it for the voter, public and organizer
views, since the rule belongs to the election rather than to who is looking.
It reuses the wizard's own `voting_type.*_desc` strings so the two descriptions
cannot drift.

Witness threshold is the one whose description is incomplete without its number:
"at least N confirmations" is not a rule until N has a value. `thresholdValue`
therefore joins the election model, read straight from the contract, and
`election.witness_rule` states it with a count. Note it is NOT `privacyQuorum`,
which sits beside it in `chainElections.ts`: one is how many yes votes approve
the motion, the other how many ballots must exist before any result may be
revealed.

### Finding the other role, and leaving it

Two consequences of the roles becoming simultaneous, both on the profiles:

- `components/ui/OtherRoleCard.tsx` offers the session the person does not hold,
  and disappears once they do, since the header switch serves them from then on.
  Until the chrome could hold both, there was nowhere honest to make that offer.
  It sends a voter to `/organizer/auth` and an organizer to `/voter/signin`, NOT
  to `/voter/onboarding`: both voter doors end at the same World ID
  verification, but onboarding leads with four slides explaining what Votain is,
  which is the right introduction for someone arriving from the landing page and
  a waste of the time of someone already running elections here. `SignIn` sends
  Back to wherever the person came from for the same reason: it used to go
  straight to the landing page, which was harmless while the landing page was
  the only way in.
- `components/ui/SignOutActions.tsx` replaces the single sign out button on both
  profiles. With one session it is exactly what it was. With two, "sign out"
  stops having one meaning, so each role gets its own exit and the joint one
  stays for when the answer really is everything. Each exit clears only its own
  data (`voterSignOut` takes the voting identity and this device's vote records,
  `organizerSignOut` the remembered wallet and display name; neither touches the
  Paillier keys, which decrypt elections already on chain) and lands the person
  on the remaining role's home rather than the landing page, which would read as
  having signed them out of that one too.

### One icon per rule, everywhere the rule appears

`lib/votingTypes.ts` owns the order and the icons: a trophy for the option that
simply wins, a dashed circle for the bar at 50%, scales for the two-thirds
supermajority, and a checked person for a count of confirmations, the only rule
about WHO confirms rather than about proportions. The wizard, the cards, the
filter chips and `VotingRule` all read it, so an icon learned in one place means
the same thing in the others. `SelectMenuOption` gained an optional icon for the
wizard's own list, shown on the trigger as well as in it.

The filter is a single choice, like the phase pills: the four rules are
alternatives, so picking one clears the last. It goes through
`ElectionFilterState` like every other filter, which is what makes it count
towards the dot on the collapsed bar.

## Nothing loads that this visit does not need

The bundle was one 868 kB file. Every screen was imported statically, so
somebody reading the privacy policy downloaded the create-election wizard, the
ZK proof generator and the tally, and all thirteen translations. It is 51 kB
now, and the rest arrives when something asks for it.

Three separate causes, and only the first is the obvious one:

- **Every route behind `lazy()`.** Landing and NotFound stay eager: Landing is
  where a cold visit begins and deferring it puts a round trip before the first
  paint of the most linked URL on the site, and NotFound is smaller than the
  loading state it would need.
- **One language at a time.** 641 kB of it, all thirteen, in the main bundle. A
  Spanish reader downloaded Arabic, Hindi, Japanese, Korean, Russian and Chinese
  to never look at them. `i18n/config.ts` fetches the active language and
  English, which is the fallback and has to be there for a key that has not been
  translated yet to resolve to its English string rather than to its own name.
  `i18next-browser-languagedetector` went with them: detection was two rules,
  localStorage then the browser's list, and inlining them is what lets the right
  language be fetched BEFORE init rather than after.
- **`setLanguage`, never `changeLanguage`.** Switching to a language that is not
  loaded shows the raw keys. The helper loads, then switches. A test caught
  this, which is the argument for it existing.

`main.tsx` awaits the bootstrap before the first render, so nothing paints in
the wrong language and corrects itself, and renders anyway if that fetch fails:
an app showing its keys is bad, an app showing nothing is broken.

## A wallet that lives in another app

`window.ethereum` exists in a desktop browser with an extension and inside a
wallet's own in-app browser. Nowhere else, and that includes Chrome on Android
and this app once installed, so `hasWallet` was answering "no compatible wallet"
to a phone with MetaMask sitting one icon away.

WalletConnect is the protocol for that gap and `lib/walletConnect.ts` is the
whole of it: a session through a relay, a deep link into the wallet app on a
phone or a QR on a desktop, and an ordinary EIP-1193 provider back. The page
stays where it is, which is the point. Only organizers ever need it; a voter
holds no wallet, because an address of their own would tie their enrolment to
their ballot.

Three things worth knowing about how it is wired:

- **One accessor decides which provider is in play.** Six places used to read
  `window.ethereum` for themselves. Reading the chain from one provider while
  signing through another is how an app checks one wallet and transacts with a
  different one.
- **The event listeners re-subscribe when the session opens.** They attach to
  whatever provider exists when the effect runs, which with no extension is
  nothing, and the session is created later by `connect`. Without the epoch
  counter a network switch made in the wallet never reached the interface, which
  is the exact case the whole path exists for.
- **It is loaded on demand, and proving that took measuring.** The modal is
  950 kB of `@reown/appkit`. A dynamic import was not enough: Vite preloaded the
  chunk from the HTML, and once that was stopped it still arrived, pulled in by
  a vendor chunk that does load eagerly. `manualChunks` was forcing one chunk per
  package, which fragments the dynamic import's graph until the pieces are
  reachable from elsewhere. The wallet stack is excluded from it now.

## Asking for the fingerprint, without making it the only answer

Creating a passkey offered a list of USB and NFC security keys on a phone with a
working fingerprint reader, because `authenticatorSelection` named no
attachment and the browser then has to offer every transport it knows.

WebAuthn has no way to express a preference: the field is a filter or it is
absent. So the attempt ladder gained a second dimension. The first pass asks for
the device's own authenticator with `userVerification: "required"`, which is the
combination Google Password Manager treats as "create a passkey" and what makes
PRF available at all. The second drops the attachment entirely, so a device
whose credential manager cannot serve a platform credential gets the security
key and the QR rather than a dead end. An error that says "not this
authenticator" skips the rest of its pass instead of walking the extension
variants, which are not what failed.

`residentKey` became `required` in the same change, and that one is not cosmetic:
a non-discoverable credential cannot be found by an assertion with an empty
`allowCredentials` list, which is how a second browser finds an existing passkey
and how the organizer vault avoids minting a second identity.

## The local chain's keys are not in the production bundle

`relay.ts` held two Hardhat private keys as literals. They are the well-known
public ones, worthless anywhere, and the comment said so, but a shipped build of
a voting application containing the string "private key" is a question nobody
should have to answer twice. They sit behind `import.meta.env.DEV`, which is a
compile-time constant, so the production build drops the literals entirely.
`VITE_LOCAL_RELAY_KEY` and `VITE_LOCAL_REGISTRAR_KEY` exist for the one case
that needs them: a production build deliberately pointed at a local chain.

## Shared pieces added along the way

Four modules exist because the same need turned up in more than one screen, and
a second copy of any of them would have been a second thing to drift.

- **`lib/ballotNames.ts`** decides when two ballot options are the same option:
  NFC, collapsed whitespace, lowercase, accents left alone. Used by the wizard,
  by `createElection`, and by `fetchElection`, which is the only one of the three
  that cannot be bypassed.
- **`lib/voterSession.ts`** parks what `GET /api/me` says about the voter's own
  World ID level. A display hint, never a boundary: the binding check reads the
  level out of the signed credential, server side.
- **`lib/phase.ts`** gained `endsSoon` and `ENDS_SOON_MS`. The rule lived twice,
  once in the elections page and once as a bare `3600_000` inside `Countdown`.
  They agreed by luck.
- **`components/ui/ExpandableText.tsx`** keeps the first lines of a long
  description and hides the rest. It MEASURES rather than counting characters:
  whether text overflows four lines depends on the font, the language and the
  window, so a character threshold would offer "show more" on text that was
  already whole.

`lib/deployments.ts` also gained `explorerTxUrl` and `explorerAddressUrl`.
Five screens hardcoded `amoy.polygonscan.com`, which is right on exactly one of
the networks this app runs against; on the local chain a voter got a confident
"View on PolygonScan" button leading to an explorer that had never heard of their
transaction. They return `null` where a chain has no explorer, and the callers
render nothing rather than a dead link.

## Long text, and text that cannot wrap

A title is up to 100 characters and a description up to 2000, and nothing forces
either to contain a space. One unbroken token cannot wrap by default, so it
pushed the page wider than the viewport and left a horizontal scrollbar under
everything. `break-words` on all five views that show a title or a description,
plus `min-w-0` inside the flex row on the receipt card: a flex item will not
shrink below its content, so wrapping alone does nothing until the item is
allowed to be narrower than the word.

The organizer view never rendered the description at all. It went from the title
straight to the counters, so the one person able to correct a description was the
only one never shown it.

## The voter's own copy of their identity

`lib/identityBackup.ts` and the card in the voter profile. The vault lives on
chain now, which answers "what if this server disappears"; this answers the one
the chain does not, namely an RPC nobody can reach or an entry that is gone.
Same ciphertext, no third party in the path.

It is deliberately NOT presented as a secret to hide, and the copy says so: the
blob is sealed under a key derived from the passkey's PRF output, so without the
authenticator it opens nothing. That is exactly why it is safe to save, mail or
print, and telling voters to guard it like a seed phrase would be both wrong and
the kind of warning that makes people skip the backup entirely.

Restoring checks the commitment in the file against what the secret actually
derives to. A backup that opens but yields a different identity belongs to
another voter or was edited, and enrolling with it would fail much later with an
error pointing nowhere near the cause.

## The organizer login, and the second device it used to break

Four problems, one of them not a login problem at all.

**A silently forked identity.** `authenticatePasskey` decided what to do from
`votain_prf_cred_id` in localStorage: no id, register a new passkey. That id is
a per-browser cache, not an account, so a returning organizer on a second
browser was handed a brand new credential without being asked. Their elections
still appeared, because those belong to the WALLET, and the damage showed up
only at the tally: a new credential is a new PRF output, and the Paillier key
of every election they had already created is derived from the old one.

`derivePrfSecret` had solved this months earlier, asking the authenticator with
an empty `allowCredentials` before minting anything. The login path never got
the same treatment. It does now, through `PasskeyIntent`: "existing" asks the
authenticator, which is what reaches a synced passkey or one answering by QR
from a phone, and "first" mints one. The screen asks rather than guessing,
because the wrong guess is unrecoverable and the right one costs a tap.

**A screen that could not tell a first visit from a return.** It always showed
two steps and always said "create or use an existing passkey", though the code
already knew: `hasPrfCredential()` says whether this browser can assert
straight away, and `getRememberedOrganizerAddress()` says whether the wallet is
linked. The first decides the buttons, the second decides the greeting, and
they are deliberately different questions: the voter passkey shares the same
cache, so greeting on it alone would welcome back somebody who has only voted.

**No door except the landing page.** The header's Log in means voter, which is
right for almost everyone who taps it, and left an organizer arriving from
Discover with nowhere to go. The organizer entry now sits on the sign in screen
itself, under the primary button: subtle rather than a second button of equal
weight, which would claim two equal audiences. The landing link stopped saying
"Create an election", a task, and says "Sign in as an organizer", a door.

## The organizer's tally vault

The deepest of the four, and the reason the others were only half fixes: even
with a perfect login, a SECOND passkey still derived a second key.

`OrganizerVault` is the answer, and it is the voter's identity vault with a
different key: one sealed copy of a tally master secret per passkey, keyed by
the wallet, ownerless and self-service like `OrganizerDomains`, since the wallet
already owns the organizer's elections and needs nobody to vouch for it.

- **Existing elections keep their keys.** The first copy seals the PRF output of
  the passkey already in use, so the master secret IS what that organizer has
  always derived from. No version flag, no migration step, nothing to get wrong.
- **`getTallyMasterSecret` refuses rather than inventing.** A passkey with no
  copy that cannot reach one throws `VaultLockedError`. Deriving from its raw
  PRF output would hand back a key that decrypts nothing, which is the failure
  this whole change exists to remove.
- **`deriveElectionKeys(nonce, signer)`** takes the vault path when a wallet is
  present and falls back to the raw PRF only for a deployment with no vault
  contract, which is what those elections were created with anyway.
- **Adding a passkey happens on a device that already works**, from the
  organizer profile, because sealing needs the plaintext. Enrolling from the new
  machine is the case a sealed vault cannot serve, in either direction, and the
  copy says so.
- **The contract refuses to remove the last copy.** That loss is permanent and
  no later action undoes it, so it is a rule rather than a confirmation dialog.

## Organizer domains are claimed by the organizer

`fetchOrganizerDomains` now reads the claim list from `OrganizerDomains` on
chain and asks the backend for a live DNS verdict on each one. Two sources on
purpose: the chain says what to ask about, DNS says what is true, and nothing in
between is trusted. Adding a domain is a verification call followed by a
transaction the organizer signs; removing one is just the transaction, so the
signed-message dance that used to authorise a server-side delete is gone with
the list it protected.

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
