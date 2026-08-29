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
