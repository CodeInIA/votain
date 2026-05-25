# frontend/. Developer Guide

## Stack

- **React** 19.2.6
- **Vite** 8.0.14 (Rolldown)
- **Tailwind CSS** 4.3.0
- **TypeScript** 6.0.3
- **react-router-dom** 7.15.1
- **framer-motion** 12.40.0
- **i18next** 26.2.0 + react-i18next 17.0.8 (13 languages)
- **`@zerodev/sdk`** 5.5.10 (Account Abstraction + Passkeys)
- **`@zerodev/passkey-validator`** 5.6.0
- **`@zerodev/ecdsa-validator`** 5.4.9
- **ethers** 6.16.0
- **`@semaphore-protocol/{identity,group,proof}`** 4.14.2
- **paillier-bigint** 3.4.3
- **`@worldcoin/idkit`** 4.1.6 + **`@worldcoin/idkit-core`** 4.1.6
- **`@sd-jwt/core`** 0.19 + **`@sd-jwt/present`** 0.19
- **lucide-react** 1.16.0

## Current routes

```
/                       Landing
/voter/onboarding       Onboarding (5 steps + World ID QR)
/voter/dashboard        stub
/organizer/auth         stub
/discover               stub
/how-it-works           stub
```

## src/ structure

```
src/
├── App.tsx
├── main.tsx
├── i18n/
│   ├── index.ts               # i18next config + auto-detect
│   └── locales/               # 13 languages: en, es, fr, de, pt, ar, hi, it, ja, ko, nl, ru, zh
├── pages/
│   ├── Landing.tsx
│   └── voter/
│       ├── Onboarding.tsx     # Screens 4+5: onboarding + World ID QR
│       └── Onboarding.test.tsx
├── components/
│   └── ui/
└── data/
    └── seed.ts                # (to create in H2) hardcoded data for visual phase
```

## Color palette (dark mode iOS 26 Liquid Glass)

```css
--background: #0a0a0f
--primary: #4F8EF7       /* cold blue */
--secondary: #7C5CFC     /* violet */
--tertiary: #00D4FF      /* cyan */
--surface-low: #141420
--on-surface: #E8E8F0
--on-surface-variant: #9090A8
```

## i18n

- 13 active languages (see `src/i18n/locales/`).
- Flat keys: `"section.key"`, no nesting.
- Browser auto-detect (IP-detect added in H4).
- **Never** hardcode text strings. Always use `t('key')`.

## Current phase: VISUAL DESIGN (Phase A)

Screens use **hardcoded data** directly (in `src/data/seed.ts` or inline). NO technical mocks. Blockchain/backend actions show toast "integration pending".

## Mandatory responsive validation

Each new screen: screenshots at mobile (375x667), tablet (768x1024), desktop (1440x900). Save to `docs/progress/H<n>/screens/<name>/`.

## Commands

```bash
npm run dev      # http://localhost:5173
npm run build    # tsc + vite build
npm test         # vitest run
npm run lint     # eslint
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

- `Onboarding.test.tsx`: 4 tests fail due to missing i18n setup in vitest (pre-existing, fix in H1).
- Stub pages not implemented (H1 to H4).
- ZeroDev real integration (H5): `src/lib/zerodev.ts` + `src/hooks/usePasskeys.ts`.
- `src/lib/contracts.ts` with typed ABIs (H5).
- `src/lib/semaphore.ts` + `src/lib/paillier.ts` (H5).

## Target deployment

**Fleek free tier (IPFS)** with automatic CD from GitHub `main`.
