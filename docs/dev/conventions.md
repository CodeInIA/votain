# Votain. Conventions and Operating Rules

## Operating rules (BINDING for all agents)

1. **NEVER `git commit` / `git push` / destructive operations** without explicit user confirmation. After each milestone, list the changes for the user to review and commit.

2. **Real data, and a loud fallback.** Screens read the chain and the backend. `src/data/seed.ts` is NOT what they show: it is the demo fallback for when no contract addresses are configured, `isChainConfigured()` decides between them, and a banner says so on every screen while it is in use. **NO** technical mocks anywhere (fake interfaces, fake `Promise.resolve`, simulated services): a sample election that cannot be told from a real one is worse than no election at all.

   *(Phases A and B are complete. Rule 2 used to read "Phase A, hardcoded data" and rule 3 "Phase B, real integration"; both are now history, and the rule that survives them is this one.)*

3. **If a screen needs a new endpoint or contract function, add it in the same pass.** No screen waits on a TODO in another module.

4. **Always latest versions**. Before each milestone, run `NODE_OPTIONS="--use-system-ca" npx npm-check-updates` on all 3 modules. Update one by one, verifying tests and build pass. If a new version breaks something and cannot be fixed in reasonable time, pin to the last stable and document in `state.md`.

5. **Always free tier**. Do not propose services with recurring costs. If in doubt, verify before proceeding.

6. **Responsive required**. Every new screen must be validated at:
   - Mobile: 375×667 (iPhone SE)
   - Tablet: 768×1024 (iPad)
   - Desktop: 1440×900

   Using Playwright MCP. Screenshots in `docs/progress/H<n>/screens/<name>/`.

7. **After each milestone**. Update `docs/dev/state.md` with current state, versions and technical debt.

8. **This plan lives in `docs/PLAN.md`**. Any future agent must read it before touching anything.

9. **All code comments and `.md` files must be written in English**. No Spanish (or other language) in source files or developer docs. The `.env` file is named `.env`, not `.env.local`.

10. **No em dashes (`, `) or hyphens as clause separators in documentation**. Use periods, commas or colons. Hyphens are only allowed inside compound words (e.g. "end-to-end"), technical identifiers (e.g. "ERC-4337"), version numbers, file paths and command flags. Em dashes look AI-generated; the substitution is conscious.

11. **Each milestone gets its own git branch**. Before committing any work for milestone N, the user creates branch `hN/<slug>` from the current state (e.g. `h0/bootstrap`, `h1/design-system`, `h2/voter-screens`). The agent only lists changes. The user creates the branch and commits.

## TypeScript / JavaScript conventions

### Explicit typing (rule 12, binding for all agents)

All TypeScript code must use explicit types. No implicit `any`. Specific rules:

- **Function parameters**: always annotated. `(id: string)`, `(proof: IDKitResult)`.
- **Async function return types**: always `Promise<void>` or the appropriate generic. `async (): Promise<void>`.
- **Catch bindings**: always `(error: unknown)` or `(e: unknown)`. Never bare `catch (error)`.
- **`res.json()` casts**: cast at the source (`res.json() as Promise<MyType>`), not in the next `.then` callback.
- **`useMemo` / `useState` generics**: annotate when the inferred type is ambiguous (`useMemo<MyType[]>(...)`).
- **Module-level constants**: annotate when not obviously typed (`const isMobile: boolean = ...`).
- **`as unknown`** is allowed only as a stepping stone before narrowing. Never `as any`.
- **Named types for API shapes**: define a named type or interface for every `res.json()` response. Inline object literals in casts are acceptable only for small one-off shapes.

```typescript
// CORRECT
const handleFoo = async (id: string): Promise<void> => { ... };
catch (error: unknown) { ... }
const data = await res.json() as Promise<{ nullifier?: string }>;
const items = useMemo<Item[]>(() => [...], []);

// WRONG
const handleFoo = async (id) => { ... };     // implicit any on id
catch (error) { ... }                         // implicit unknown (non-obvious)
.then((data: Foo) => ...)                     // cast in the wrong place
```

### ethers v6 (NOT ethers v5)

```typescript
// CORRECT, ethers v6
import { ethers } from "ethers";
const value = ethers.parseEther("1.0");
const balance = await provider.getBalance(address);  // returns bigint
const big = 1000000000000000000n;  // native BigInt, NOT BigNumber

// WRONG, do not use in this project
import { BigNumber } from "ethers";  // NO
ethers.utils.parseEther(...)  // NO, does not exist in v6
```

### Solidity 0.8.37

```solidity
pragma solidity ^0.8.37;
// EVM target: paris (no PUSH0, compatible with Polygon Amoy)
// OZ v5.x: @openzeppelin/contracts ^5.6.1
// Semaphore: @semaphore-protocol/contracts ^4.14.2
```

### React 19 + hooks

```typescript
// Use React 19 hooks (use, useTransition, etc.)
// No class components
// Presentation components receive data as props and do not fetch
// Local state with useState/useReducer
// Data loading belongs in hooks (src/hooks/), not in a component's effect
```

### Tailwind CSS 4

```typescript
// Tailwind 4 uses native CSS variables, not arbitrary palette in config
// Arbitrary classes still work: bg-[#0a0a0f]
// Plugin: @tailwindcss/vite (not the classic Tailwind 3 postcss plugin)
```

### i18n, flat keys

```typescript
// CORRECT: flat keys with section prefix
const { t } = useTranslation();
t('election.status_active')
t('common.back')

// WRONG: nesting
t('election.status.active')  // NO, JSON files use a single level of nesting per section
```

### File and component naming

```
components/ui/Button.tsx        PascalCase for components
hooks/useOrganizerWallet.ts     camelCase with "use" prefix
lib/contracts.ts                camelCase
data/seed.ts                    camelCase
pages/voter/Onboarding.tsx      PascalCase
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

### Card heading icons

Every card heading in both profiles carries a small icon before its text, at
`w-4 h-4`, coloured by `roleAccent(role)` from `lib/activeRole`: `text-primary`
under the organizer, `text-tertiary` under the voter. The same function colours
each screen's `h1` icon, so there is one source of truth for "what colour is
this role".

Two exceptions, and both say something the accent cannot:

- **A state.** The green `ShieldCheck` on "verified voter" reports a fact about
  the voter, not a section, so it keeps the green and follows the text.
- **The other role.** `OtherRoleCard` wears `text-secondary`, deliberately not
  the colour of the role reading it, because the card is about the other one.

A card that carries the identity drawing takes no small glyph in its heading:
the drawing is that card's icon, and a second mark beside it reads as a second
identity.

### Colour does not carry state next to colour that carries none

A tint that changes with the data can only be read as information if nothing
beside it is wearing the same colour for decoration.

The quorum figure in `ElectionSummary` learned this the hard way. It turned
green once the quorum was met and sat purple until then, which was true and
worked, and it was the only state-derived tint in the app, in a row where the
other five are fixed. `Reserved`, two figures to its left, is permanently the
same green. So an election that had met its quorum showed two green icons of
which only one meant anything by being green, and one that had not showed the
meaningless green by itself. It was reported as elections having differently
coloured icons, which is exactly how it reads.

If a figure has a state worth reporting, say it in the value or in the hint
first: `3/3` against `1/3` answers it, and so does a sentence. Reach for colour
only once the row has no decorative colour left to be confused with.

### Touch target minimums

- Buttons on mobile: minimum **44×44px** (WCAG 2.5.5).
- Interactive elements: minimum **44px** on the smallest dimension.
- Spacing between targets: minimum **8px**.

### Election phase badge colors

Source of truth: `frontend/src/components/ui/Badge.tsx` (`variant` map). Eight
phases mirror `ElectionV4.Phase`.

| Phase | Badge color |
|-------|-------------|
| Upcoming (before enrollment opens) | muted grey (`on-surface-variant`) |
| Enrolling | yellow (`yellow-400`) |
| Pending vote (enrollment closed, voting not yet open) | cyan (`tertiary` `#00D4FF`) |
| Active | green (`green-400`) |
| Tallying | purple (`secondary` `#7C5CFC`) |
| Closed | muted grey (`on-surface-variant`) |
| Voided | dim grey (`on-surface-meta`) |
| Cancelled | error red (`#ffb4ab`) |

## Available MCPs and status

| MCP | Status | Notes |
|-----|--------|-------|
| Playwright MCP | ✅ Active | `@playwright/mcp` via `node` + full path to `cli.js`, `--headless`. Chromium installed in `ms-playwright/` |
| Stitch MCP | ✅ Active (HTTP transport) | Available via `stitch.googleapis.com/mcp`. Fallback: read `stich.md` directly |
| Chrome DevTools MCP | Pending verification | Or equivalent |
| Filesystem MCP | Available (built into Claude Code) | Read assets from `OneDrive/UNI/4/TFG/stich/` |

**If a MCP fails**: warn the user before proceeding. Do not improvise.

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
H0: bootstrap, dependency upgrade, dev docs
H1: design system and base components
H2: public and voter screens (visual)
H3: organizer screens (visual)
H4: i18n, a11y polish, E2E smoke tests
H5: production contracts + chain client
H6: backend issuer features
H7: voter flow integration
H8: organizer flow integration
H9: tally script + IPFS results
H10: frontend IPFS deployment
H11: backend Phala TEE
H12.x: thesis chapters X to Y
H13: defense slides + video
```
