# Votain — Conventions and Operating Rules

## Operating rules (BINDING for all agents)

1. **NEVER `git commit` / `git push` / destructive operations** without explicit user confirmation. After each milestone, list the changes for the user to review and commit.

2. **Phase A (H1-H4) — hardcoded data**: screens use data from `src/data/seed.ts` or inline. **NO** technical mocks (fake interfaces, fake Promise.resolve, simulated services). Buttons that require blockchain/backend show a toast "Integration pending".

3. **Phase B (H5-H9) — real integration**: connect directly to backend + Amoy contracts. No mocks. If a screen needs a new endpoint/function, add it in the same milestone.

4. **Always latest versions**: before each milestone, run `NODE_OPTIONS="--use-system-ca" npx npm-check-updates` on all 3 modules. Update one by one, verifying tests/build pass. If a new version breaks something and cannot be fixed in reasonable time, pin to the last stable and document in `state.md`.

5. **Always free tier**: do not propose services with recurring costs. If in doubt, verify before proceeding.

6. **Responsive required**: every new screen must be validated at:
   - Mobile: 375×667 (iPhone SE)
   - Tablet: 768×1024 (iPad)
   - Desktop: 1440×900
   Using Playwright MCP. Screenshots in `docs/progress/H<n>/screens/<name>/`.

7. **After each milestone**: update `docs/dev/state.md` with current state, versions, and technical debt.

8. **This plan lives in `docs/PLAN.md`**: any future agent must read it before touching anything.

9. **All code comments and .md files must be written in English**. No Spanish (or other language) in source files or developer docs. The `.env` file is named `.env` (not `.env.local`).

10. **Each milestone gets its own git branch**. Before committing any work for milestone N, the user creates branch `hN/<slug>` from the current state (e.g., `h0/bootstrap`, `h1/design-system`, `h2/voter-screens`). The agent only lists changes; the user creates the branch and commits.

## TypeScript / JavaScript conventions

### ethers v6 (NOT ethers v5)

```typescript
// CORRECT — ethers v6
import { ethers } from "ethers";
const value = ethers.parseEther("1.0");
const balance = await provider.getBalance(address);  // returns bigint
const big = 1000000000000000000n;  // native BigInt, NOT BigNumber

// WRONG — do not use in this project
import { BigNumber } from "ethers";  // NO
ethers.utils.parseEther(...)  // NO, does not exist in v6
```

### Solidity 0.8.35

```solidity
pragma solidity ^0.8.35;
// EVM target: paris (no PUSH0, compatible with Polygon Amoy)
// OZ v5.x: @openzeppelin/contracts ^5.6.1
// Semaphore: @semaphore-protocol/contracts ^4.14.2
```

### React 19 + hooks

```typescript
// Use React 19 hooks (use, useTransition, etc.)
// No class components
// Presentation-only components in Phase A: receive data as props, no fetching
// Local state with useState/useReducer
// Effects only when necessary, not for data fetching in Phase A
```

### Tailwind CSS 4

```typescript
// Tailwind 4 uses native CSS variables, not arbitrary palette in config
// Arbitrary classes still work: bg-[#0a0a0f]
// Plugin: @tailwindcss/vite (not the classic Tailwind 3 postcss plugin)
```

### i18n — flat keys

```typescript
// CORRECT: flat keys with section prefix
const { t } = useTranslation();
t('election.status_active')
t('common.back')

// WRONG: nesting
t('election.status.active')  // NO — JSON files use a single level of nesting per section
```

### File and component naming

```
components/ui/Button.tsx        — PascalCase for components
hooks/usePasskeys.ts            — camelCase with "use" prefix
lib/contracts.ts                — camelCase
data/seed.ts                    — camelCase
pages/voter/Onboarding.tsx      — PascalCase
```

## UI conventions (stich.md)

### Color tokens

```css
--background: #0a0a0f;
--primary: #4F8EF7;          /* cold blue */
--primary-dim: #3a6fd4;
--primary-container: #1a3a70;
--secondary: #7C5CFC;        /* violet */
--tertiary: #00D4FF;         /* cyan */
--surface-low: #141420;
--surface: #1e1e2e;
--on-surface: #E8E8F0;
--on-surface-variant: #9090A8;
--outline-variant: #2a2a3a;
--error: #FF4444;
--success: #22C55E;
--warning: #FBBF24;
```

### Touch target minimums

- Buttons on mobile: minimum **44×44px** (WCAG 2.5.5)
- Interactive elements: minimum **44px** on the smallest dimension
- Spacing between targets: minimum **8px**

### Election phase badge colors

| Phase | Color |
|-------|-------|
| Enrollment | `#4F8EF7` (primary blue) |
| Active | `#22C55E` (success green) |
| Tallying | `#FBBF24` (warning yellow) |
| Closed | `#9090A8` (on-surface-variant) |
| Voided | `#FF4444` (error red) |
| Cancelled | `#FF4444` (error red) |

## Available MCPs and status

> Update this section after H0 verification.

| MCP | Status | Notes |
|-----|--------|-------|
| Playwright MCP | Pending verification | `@modelcontextprotocol/server-playwright` |
| Stitch MCP | Not available as official MCP | Fallback: read `stich.md` directly via Read tool |
| Chrome DevTools MCP | Pending verification | Or equivalent |
| Filesystem MCP | Available (built into Claude Code) | Read assets from `OneDrive/UNI/4/TFG/stich/` |

**If a MCP fails**: warn the user before proceeding, do not improvise.

## Development environment

```bash
# SSL on Windows (university / corporate network)
NODE_OPTIONS="--use-system-ca"   # required for npm install / npm-check-updates

# Required Node.js versions
node >= 22 (LTS)
npm >= 10
```

## Expected commit structure (user, not agent)

```
H0: bootstrap, dependency upgrade, docs IA
H1: design system and base components
H2: public and voter screens (visual)
H3: organizer screens (visual)
H4: i18n, a11y polish, E2E smoke tests
H5: production contracts + ZeroDev client
H6: backend issuer features
H7: voter flow integration
H8: organizer flow integration
H9: tally script + IPFS results
H10: frontend IPFS deployment
H11: backend Phala TEE
H12.x: thesis chapters X-Y
H13: defense slides + video
```
