# frontend/. Developer Guide

## Stack (versions as of 2026-07-15)

- **React** 19.2.7
- **Vite** 8.1.4 (Rolldown)
- **Tailwind CSS** 4.3.2
- **TypeScript** 6.0.3 — **pinned**: `typescript-eslint` requires `<6.1.0`, do not bump to 7.x yet
- **react-router-dom** 7.18.1
- **framer-motion** 12.42.2
- **i18next** 26.3.6 + react-i18next 17.0.9 (13 languages)
- **`@radix-ui/react-select`** 2.3.3 (headless primitive — LanguageSelector)
- **country-flag-emoji-polyfill** 0.1.8 (flag emojis on Windows/Chromium)
- **`@zerodev/sdk`** 5.5.10 (Account Abstraction + Passkeys)
- **`@zerodev/passkey-validator`** 5.6.0
- **`@zerodev/ecdsa-validator`** 5.4.9
- **ethers** 6.17.0
- **`@semaphore-protocol/{identity,group,proof}`** 4.14.3
- **paillier-bigint** 3.4.3
- **`@worldcoin/idkit`** 4.2.0 + **`@worldcoin/idkit-core`** 4.2.1
- **`@sd-jwt/core`** 0.20.0 + **`@sd-jwt/present`** 0.19.0 (no stable 0.20 of present yet)
- **lucide-react** 1.24.0

## Routes (all 24 screens implemented — Phase A)

```
/                                Landing (auto-redirects by role if logged in)
/discover                        Public election discovery
/election/:id                    Public election preview
/election/:id/results            Public results
/how-it-works                    How It Works
/verify-receipt                  Verify vote receipt

/voter/onboarding                Onboarding (5 steps + World ID QR — REAL integration)
/voter/signin                    Voter sign in
/voter/re-verify                 Re-verification
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

## Auth model (Phase A)

`src/contexts/AuthContext.tsx` — persistent voter + organizer sessions:

- localStorage keys: `votain_voter_logged_in`, `votain_organizer_logged_in`
- On mount, probes `GET /api/me`: a valid httpOnly `voter_vc` cookie (issued by the
  backend after World ID verification) restores the voter session
- `voterSignOut()` clears localStorage AND calls `POST /api/logout` (clears the cookie)
- The VC cookie is **voter-only**; organizers will authenticate with passkeys in Phase B
- Navigation (`TopNav`, `BottomTabNav`) is driven ONLY by auth state, never by the page

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
└── lib/                       # (H5) contracts.ts, zerodev.ts, semaphore.ts, paillier.ts
```

## Design-system rules

- Any CTA-looking button MUST use `components/ui/Button` (never restyle a raw `<button>`).
- Back links use `components/ui/BackButton`.
- Native `<select>` is forbidden in pages — use `Select` from `components/ui/Input`.
- Dropdowns/popovers use Radix primitives (portal-based) — never `absolute z-*` inside cards
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
- **Never** hardcode text strings. Always use `t('key')` — including inside `components/ui/`.
- When adding a key, add it to ALL 13 locale files (a Node script over JSON.parse beats 13 manual edits).

## Current phase: Phase A complete — next is Phase B (real integration)

Screens use **hardcoded data** (`src/data/seed.ts`). NO technical mocks. Blockchain/backend
actions show toast "integration pending". Exception: World ID verification is real.

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
VITE_AMOY_RPC_URL=https://rpc-amoy.polygon.technology
VITE_ZERODEV_PROJECT_ID=     # From ZeroDev dashboard (free tier)
# Contract addresses filled in H5:
VITE_ELECTION_FACTORY_ADDRESS=
VITE_PLATFORM_REGISTRY_ADDRESS=
VITE_PAYMASTER_ADDRESS=
```

## Technical debt (see `docs/dev/state.md`)

- ZeroDev real integration (H5): `src/lib/zerodev.ts` + `src/hooks/usePasskeys.ts`.
- `src/lib/contracts.ts` with typed ABIs (H5).
- `src/lib/semaphore.ts` + `src/lib/paillier.ts` (H5).
- IP-based language auto-detect (H4 leftover).
- `@sd-jwt/present` upgrade to 0.20 when published (H6/H7).

## Target deployment

**Fleek free tier (IPFS)** with automatic CD from GitHub `main`.
