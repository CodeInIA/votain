# Votain — Agent State

## Current milestone: Phase A DONE ✅ (H4 + UX polish pass) — next up: H5 (Phase B)

## Completed milestones

### H0 — Bootstrap (partial)
- Dependencies audited and upgraded across all 3 modules
- Biconomy removed → ZeroDev packages added to frontend
- MCPs configured: Playwright MCP, Stitch MCP (project ID: 7436293275873814220)
- `docs/ai/` directory created

### H1 — Design system & base components ✅ (2026-05-25)
All 9 tests pass. Production build clean. No TS errors.

**UI components** (`frontend/src/components/ui/`): Avatar, Badge, BarChart, BlockchainBadge,
Button, Card, Countdown, ElectionCard, EligibilityRow, GasWidget, Input (+ Textarea + Select),
LanguageSelector (Radix Select), Modal (portal), RadioCard, Skeleton, Spinner, Stepper, Switch,
Toast, TransactionPendingModal (H4)

> Removed as unused during polish: ActionCard, Checkbox, MiniBarChart.

**Layout** (`frontend/src/components/layout/`): BottomTabNav, TopNav, Footer, PageLayout

### H2 — Public + Voter screens ✅ (2026-05-25)
All screens implemented with hardcoded data from `src/data/seed.ts`:
- Discover, ElectionPreview, ElectionResults, HowItWorks, VerifyReceipt
- VoterElections, ElectionDetail, ZkProofGeneration, VoteConfirmation, ChangeVote,
  VoterHistory, ReVerification

### H3 — Organizer screens ✅ (2026-05-25)
- OrganizerAuth, OrganizerDashboard, CreateElection, ElectionManagement,
  GasManagement, MemberList, OrganizerProfile

### H4 — Shared screens + i18n + polish ✅ (2026-05-26)

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
- Language selector removed from header/footer — lives in both profile pages
- "How it works" moved from header to Footer + profile pages (mobile-only card with Terms/Privacy)
- TopNav visible on mobile (logo + wordmark + profile); nav links desktop-only; tabs on mobile

**Layout**
- `PageLayout`: `h-dvh` flex column — sticky header, scrollable `<main>`, pinned Footer (desktop-only), BottomTabNav (mobile)
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

- **contracts**: Hardhat 3.9.1, TypeScript 7.0.2, Semaphore contracts 4.14.3, Solidity 0.8.36 (config + all pragmas) — compiles clean, 5/5 tests pass
- **backend**: `@sd-jwt/core` 0.20.0 (project moved to OpenWallet Foundation — `@sd-jwt/types`
  no longer exists as a dep; `SDJWTConfig`/`JwtPayload` now import from `@sd-jwt/core`),
  IDKit-core 4.2.1, TypeScript 7.0.2, `@types/node` 26 (required a `crypto.createPublicKey`
  fix in `utils/keys.ts` — derive public key from private PEM export). `issue()` smoke-tested
- **frontend**: Vite 8.1.4, React 19.2.7, Tailwind 4.3.2, ethers 6.17, IDKit 4.2,
  react-router 7.18.1, i18next 26.3.6 — tsc clean, 9/9 tests, build OK
  - ⚠️ TypeScript **pinned at 6.0.3**: `typescript-eslint@8.64` peer-requires `<6.1.0`
  - ⚠️ `@sd-jwt/present` stays 0.19.0 (no stable 0.20 published) — revisit in H6/H7

---

## Phase A — COMPLETE ✅

All 24 screens implemented visually with hardcoded seed data. Full i18n for 13 languages.
Navigation works across all routes. Actions that need blockchain fire toast or simulated TX modal.

**Commit**: `feat(frontend): Phase A — design system (H1), 24 screens (H2+H3), i18n 13 languages`
  + `feat(frontend): H4 — TransactionPendingModal, i18n tx namespace, reduced-motion, E2E scaffold`

---

## Next: Phase B — Real integration

### H5 — Contracts production-ready on Amoy + frontend client
- Replace MockVerifier with official Semaphore V4 verifier
- Lock down ElectionPaymaster.sponsorVote
- Add cancelElection, closeEnrollmentEarly, closeVotingEarly, publishResults, markVoided
- Tests ≥80% coverage with solidity-coverage
- deploy.ts → deployments/amoy.json
- Deploy + verify on PolygonScan
- src/lib/contracts.ts (ethers v6 + ABIs TypeChain + addresses)
- src/lib/zerodev.ts (KernelAccount v3 + paymaster + bundler)
- src/hooks/usePasskeys.ts (WebAuthn with @zerodev/passkey-validator)

### H6 — Backend issuer
- Selective disclosure attributes in SD-JWT
- Status List 2021 endpoint
- Rate limiting
- Tests

### H7 — Real voter flow integration
### H8 — Real organizer flow integration
### H9 — Tally script + IPFS + results
### H10 — Frontend on IPFS via Fleek CD
### H11 — Backend on Phala TEE
