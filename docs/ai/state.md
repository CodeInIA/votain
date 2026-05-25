# Votain — Agent State

## Current milestone: H2 (Public + Voter screens)

## Completed milestones

### H0 — Bootstrap (partial)
- Dependencies audited and upgraded across all 3 modules
- Biconomy removed → ZeroDev packages added to frontend
- MCPs configured: Playwright MCP, Stitch MCP (project ID: 7436293275873814220)
- `docs/ai/` directory created

### H1 — Design system & base components ✅ (2026-05-25)
All 9 tests pass. Production build clean. No TS errors.

**UI components created** (`frontend/src/components/ui/`):
- Button (cva, 5 variants: gradient/default/primary/secondary/ghost)
- Badge (cva, 14 variants: phase states + role + blockchain badges)
- Card + CardHeader/CardTitle/CardDescription/CardContent/CardFooter (glass, depth prop)
- Input / Textarea / Select (forwardRef, label/hint/error, leftIcon/rightIcon)
- Modal (portal, AnimatePresence, Escape key)
- RadioCard + RadioGroup (48px touch target, gradient border on selection)
- Checkbox
- Switch
- Skeleton + SkeletonCard
- Spinner (sm/md/lg) + ProgressDots (onboarding dots)
- Stepper + OverlayStepper (ZK proof steps)
- Toast + ToastProvider + useToast (portal, 4 variants)
- Countdown (timezone-aware, red <1h)
- ResultBarChart (CSS %, winner glow) + MiniBarChart (Recharts)
- Avatar + IdentityCommitment (copyable truncated address)
- LanguageSelector (animated dropdown, 13 languages)
- EligibilityRow (met/not-met/unknown states)
- GasWidget (good/low/critical thresholds)
- BlockchainBadge + IPFSBadge

**Layout components** (`frontend/src/components/layout/`):
- BottomTabNav (mobile fixed bottom, 4 tabs)
- TopNav (desktop, role-aware: public/voter/organizer)
- Footer (updated with LanguageSelector)

**Other changes:**
- `frontend/src/data/languages.ts` — 13 languages with flag/code/name/nativeName
- `frontend/src/App.tsx` — wrapped in ToastProvider, lazy /dev/components route (DEV only)
- `frontend/src/pages/dev/Components.tsx` — full component showcase (DEV only)
- `frontend/src/pages/voter/Onboarding.tsx` — 5-step flow (4 info + verify), auto-detects browser language on mount
- `frontend/src/i18n/locales/en.json` — extended with nav/phase/badge/common keys

**recharts** installed with `NODE_OPTIONS=--use-system-ca` workaround (corporate SSL proxy).
recharts only imported in the DEV-only ComponentsShowcase — tree-shaken from production build.

**Validation screenshots** saved to `C:\Users\virus\OneDrive\UNI\4\TFG\progress\H1\`

## Next: H2 — Public + Voter screens

Screens to implement (data hardcoded in `src/data/seed.ts`):
- Discovery (1): election grid, filters, search, empty states
- Public Preview (2): details, badges, countdown, candidates read-only
- Public Results (3): bar chart, winner glow, tie state, export JSON
- How It Works (23): 4 steps
- Onboarding (4): already done
- World ID Verification (5): already integrated
- Re-verification (6): UI states
- Voter Election List (7): phase-aware CTAs, countdown red <1h
- Election Detail Enrollment (8): eligibility checklist, enroll CTA (toast)
- Election Detail Active (9): candidate selector, blank vote, gas banner
- ZK Proof Generation (10): 3-step overlay with setTimeout simulation
- Vote Confirmation (11): checkmark animation, reference number, PolygonScan link
- Change Vote (12): same selector, confirmation modal
- Voter History (13): list from seed
- Verify Receipt (24): input + success/not-found from seed

First action: create `src/data/seed.ts` with 6 elections covering all phases.
