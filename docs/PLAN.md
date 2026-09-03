# Votain TFG. Iterative Completion Plan

> **This is the canonical copy of the plan** for any future agent to continue without prior context.

## Context

**Votain** is an end-to-end verifiable, anonymous, coercion-resistant voting dApp on Polygon Amoy. The architecture combines:

- **Smart contracts** in Solidity (Semaphore V4, ERC-2771) inside `contracts/`.
- **Backend issuer** in Node.js emitting Verifiable Credentials (SD-JWT) after validating World ID, inside `backend/`. Will be deployed on a **decentralized TEE** (Phala Network) at the end.
- **Frontend** in React + Vite with **passkey-derived identities**, homomorphic Paillier and `@semaphore-protocol/*` inside `frontend/`. Will be published on **IPFS with CI/CD (Fleek)**.
- **Tally script** off-chain to filter votes by nullifier and decrypt results.

### Confirmed stack decisions

| Piece | Decision | Replaces | Reason |
|-------|----------|----------|--------|
| Gasless voting | **Own relay contract** (`ElectionPaymaster`) | ZeroDev / ERC-4337 (2026-08) | Hosted paymasters fund gas per project, billed to the project owner, with no way for an organizer to fund their own voters. Worse, one smart account per voter makes the sender address a public link between a voter's enrollment and their ballot, which defeats the Semaphore proof. A single relay contract fixes both: organizers pay for their own elections, and every voter looks identical on chain |
| Frontend deploy | **Fleek (IPFS) free tier with GitHub CD** | Vercel | Keeps "Hosted on IPFS" badge from `stich.md`, immutable verifiable CID |
| Backend issuer deploy | **Phala Network free tier (decentralized TEE) + MPC future work** | Centralized VPS | Issuer signs VCs. TEE with on-chain attestation upholds the TFG's trust principles |
| IPFS tally pinning | **Pinata free tier (1 GB)** | n/a | Sufficient for JSON audit trail |
| LaTeX thesis | **Overleaf free or local** | n/a | University template to confirm |
| Everything else (World ID Portal, Polygon Amoy, GitHub Actions, Hardhat, Vitest, Playwright, Zotero) | Free / open source | | |

**Cross-cutting constraint**: NOTHING with recurring cost. If a service claims free tier but requires a card, evaluate an alternative first.

### Verified state as of 2026-05-23

| Area | Done | Missing |
|------|------|---------|
| **Contracts** | 4 contracts + `MockVerifier` + 5 tests + `deploy.ts` | Official Semaphore verifier, lock-down `sponsorVote`, screen functions (cancel, closeEarly, publishResults), Amoy deploy, PolygonScan verification, coverage ≥80% |
| **Backend** | `verify-human`, `rp-signature`, `/me`, `/logout`, SD-JWT EdDSA, httpOnly cookies | Selective VC attributes, Status List 2021, tests, rate limiting, Phala TEE deploy |
| **Frontend** | `Landing`, `Onboarding` (5 steps + World ID QR), 13-language i18n, layout, 2 base UI components | The **24 remaining screens** from `stich.md`, complete design system, ZeroDev + Passkeys, crypto hooks, real integrations |
| **Tally** | Nothing | `scripts-tally/tally-votes.ts` |
| **Thesis** | `tfg.tex` placeholder | Full ETSII structure |
| **Defense** | Nothing | Slides + demo video + rehearsals |

### Mandatory responsive + essential MCPs

The dApp **must look and work well on both PC and mobile**. This is an acceptance requirement for each screen, not a nice-to-have.

| MCP | Usage | Milestone needed |
|-----|-------|-----------------|
| **Playwright MCP** | Screenshots at mobile (375×667), tablet (768×1024), desktop (1440×900) | H1 to H4, H7, H8 |
| **Stitch MCP / stich.md** | Consult original designs before implementing each screen. Fallback: read `stich.md` from `C:\Users\virus\OneDrive\UNI\4\TFG\stich\stich.md` | All Phase A (H1 to H4) |
| **Chrome DevTools MCP** | Inspect layouts, overflow, WCAG contrast | H1 to H4 |
| **Filesystem MCP** | Read assets from `OneDrive/UNI/4/TFG/stich/` | H1 to H4 |

**Mandatory procedure for each new screen**:

1. Read `stich.md`. Understand layout, states, copy, palette.
2. Implement.
3. Playwright MCP. Screenshots at 3 viewports, saved to `docs/progress/H<n>/screens/<name>/`.
4. Review. Overflow, buttons <44px, insufficient contrast: iterate.

### User decisions on process

- **Order**. Visual design of all 24 screens first (hardcoded data), then real integration.
- **Everything free tier**.
- **Latest versions always**. Dependency audit before each milestone.
- **Agent NEVER does `git commit`**. User reviews diffs and commits.
- **Goal**. July 2026 (extraordinary), September 2026 if needed.
- **Scope**. Complete per `copilot-instructions.md` (PRD) and `stich.md` (24 screens).

### Important distinction: "hardcoded data" vs "mocks"

- **Phase A**: hardcoded data in `src/data/seed.ts` or inline. NO technical mocks (fake `Promise.resolve`, fake interfaces).
- **Phase B**: real integration. No mocks. If a screen needs a new endpoint or function, add it in the same milestone.

### Voting types (decision 2026-05-25, suggested by thesis advisor)

The organizer who creates an election picks the **winner determination rule**. Four supported types broaden the use cases significantly (not just democratic elections):

| Type | Approval rule | Example use case |
|------|---------------|------------------|
| `SIMPLE_PLURALITY` | Candidate with the most votes wins, even by a 1-vote margin. No minimum threshold | Local elections, most parliamentary seats, club president |
| `ABSOLUTE_MAJORITY` | Leading option needs more than 50% of the BALLOTS CAST. No winner if nobody crosses it | Public elections with majority requirement, referendums |
| `SUPERMAJORITY_TWO_THIRDS` | Leading option needs at least 2/3 of the BALLOTS CAST. Works either as a yes/no motion (option 0 is the motion, so falling short is a rejection) or as a qualified-majority election over a field of candidates (nobody is elected below the bar) | Bylaw changes, board decisions, conclave-style elections |
| `WITNESS_THRESHOLD` | yes-votes ≥ N (absolute number, not percentage) | Wedding (4 witnesses), notarial multi-sig, cooperative quorum |

Default in the Create Election wizard: `SIMPLE_PLURALITY` (most common globally).

> **Denominator**: every threshold is measured against the ballots actually cast, not
> against the eligible roll, and the blank vote counts towards that total. So a blank
> ballot makes a threshold harder to reach rather than being ignored. This is what
> `ElectionV4._computeOutcome` implements; an earlier version of this table said
> "eligible voters", which never matched the contract.

**Cryptographic impact**: minimal. All three rules operate on the same Paillier homomorphic sum of ciphertexts. Only the post-decryption threshold check differs.

**Layer impact**:

- **Contracts (H5)**: `ElectionV4` gets a `VotingType` enum field + `thresholdValue` uint (used as N for WITNESS_THRESHOLD, ignored for the others). `publishResults` applies the corresponding rule.
- **Tally script (H9)**: same Paillier sum, branches on `VotingType` for the Approved/Rejected verdict.
- **Frontend Create Election wizard (H3 visual, H8 real)**: extra step "Voting type". Selecting WITNESS_THRESHOLD reveals an N input.
- **Frontend ballot UIs (H2)**: candidate-vs-Yes/No layouts depending on type. Wedding-style witness vote shows fewer candidates and clearer Approve/Reject framing.
- **`seed.ts` (H2)**: must include at least one example of each voting type so all UI states are covered in Phase A.
- **Results UI (H2 visual, H9 real)**: outcome rendering changes. Yes/No outcome for witness and supermajority; multi-candidate outcome for majority elections.

**Out of scope** (future work, noted in chapter 10 of the thesis): ranked-choice voting, STV, Borda count, quadratic voting. These either require additional cryptography or contradict the additive-homomorphic tally design.

### Identity and selective disclosure sources (decision 2026-05-25, revised 2026-08-26)

**Age is a floor, never a range.** Self proves `minimumAge` as a one-sided
predicate and returns the threshold it proved, never the age, which is what keeps
the birth date on the phone. Self Enterprise documents a maximum-age rule for
backend mode without naming its field, and reaching it would mean migrating off
the open-source SDK to dashboard-managed immutable flows. Recorded in
`docs/ai/state.md` as future work; the alternative, revealing the date of birth,
is refused.

For elections that require attribute verification (age, nationality), Votain
delegates to an external provider instead of building the document-reading and
ZK-proof pipeline from scratch. Reading a passport chip end to end means MRZ OCR
for the BAC key, raw ISO 7816 APDU exchange (which Web NFC cannot do, so a native
app would be required), the ICAO PKD master list to validate the SOD chain, and
RSA-2048 with SHA-256 verified inside a circuit. That is months of work to
reproduce something already built and audited.

| Source | What it provides | Status for Spain | Notes |
|--------|------------------|------------------|-------|
| **Self** (implemented) | Passport or EU identity card NFC read, ICAO 9303 PKI verification, ZK proofs of `minimumAge` and country rules | ✅ Spain is on the full-support list (DSC and CSCA). No geographic allowlist. Spanish passports have carried a chip since 2006, and the DNI is an EU identity card | **The implemented path.** Open-source `@selfxyz/core` verifier, self-hosted, free, no third party in the enrollment path. Mock passports with configurable nationality and age make the whole flow testable without a real document |
| **World ID Credentials, Identity Check** | Same document-backed attributes, requested through IDKit's `identityCheck` preset (`minimum_age`, `nationality`, `issuing_country`, `document_type`) | 🟡 Preview. Coverage is Argentina, Chile, Colombia, Costa Rica, Japan, Malaysia, Mexico, Panama, South Korea, Taiwan, the UK and a few more. **Spain is not on that list** | Not chosen. The library is already installed, so the integration would be small, but a feature that cannot be demonstrated on a Spanish document is not one this project can rely on |
| **EUDI Wallet (eIDAS 2.0)** | EU-wide wallet with SD-JWT VC. All 27 member states obliged to offer one from 2026 | 🟡 Pilot. Spain's **Cartera Digital Beta** publishes its age-verification protocol for integrating platforms | Future work (thesis chapter 10). The natural successor to the Self integration, and the reason the eligibility layer is provider agnostic |
| **Demo issuer (TFG fallback)** | Self-declared attributes during onboarding, signed by Votain's backend EdDSA key. Carries an explicit `evidence: "self-declared"` claim | Always available | Development and demo only, so testers without a supported document can still vote. UI shows a clear disclaimer |

**World ID stays the personhood layer.** Self supplies attributes and nothing
else. `ElectionV4.enroll` already deduplicates by human through the World ID
nullifier, which closes Self's two weak spots: a dual national's second passport
buys no second ballot, and a borrowed passport is still bound to somebody else's
World ID. Passive Authentication proves a document is genuine, never that the
holder owns it, so the two layers are complementary rather than competing.

**The trust boundary, stated plainly.** A contract cannot verify a passport
attribute proof: it is anchored on another network, and going to look for it
would break consensus for the same reason a contract cannot resolve a DNS record.
The relay verifies off chain and signs an EIP-712 attestation that the contract
checks. The election publishes the hash of the policy it was gated on, so the
rules are auditable even though their enforcement is not on chain. This is the
same shape as the domain verification already in the project.

**The anonymity set is the real limit, not the cryptography.** The proof reveals
nothing, but the predicate itself does. An election restricted to a narrow
attribute combination shrinks the set of people any given ballot could have come
from. One predicate is defensible; stacking several on a small election is not.
Worth a section of its own in the thesis.

**Layer impact**:

- **Contracts (H5)**: `ElectionV4` gets a `VotingType` enum field + `thresholdValue` uint (used as N for WITNESS_THRESHOLD, ignored for the others). `publishResults` applies the corresponding rule.
- **Tally script (H9)**: same Paillier sum, branches on `VotingType` for the Approved/Rejected verdict.
- **Frontend Create Election wizard (H3 visual, H8 real)**: extra step "Voting type". Selecting WITNESS_THRESHOLD reveals an N input.
- **Frontend ballot UIs (H2)**: candidate-vs-Yes/No layouts depending on type. Wedding-style witness vote shows fewer candidates and clearer Approve/Reject framing.
- **`seed.ts` (H2)**: must include at least one example of each voting type so all UI states are covered in Phase A.
- **Results UI (H2 visual, H9 real)**: outcome rendering changes. Yes/No outcome for witness and supermajority; multi-candidate outcome for majority elections.

**Out of scope** (future work, noted in chapter 10 of the thesis): ranked-choice voting, STV, Borda count, quadratic voting. These either require additional cryptography or contradict the additive-homomorphic tally design.

### Identity and selective disclosure sources (decision 2026-05-25)

For national or restricted elections that require attribute verification (age, nationality, region), Votain delegates to **World ID Credentials** instead of building the document-reading and ZK-proof pipeline from scratch.

| Source | What it provides | Status for Spain | Notes |
|--------|------------------|------------------|-------|
| **World ID Credentials** | Local NFC read of passport/national-ID chip, ICAO 9303 PKI verification, ZK proofs of `ageOver18`, `nationality`, etc. | ✅ Spanish passport works (ICAO universal). ❌ Spanish DNI not yet supported (Feb 2026) | Primary identity source. Integrated via IDKit. The dApp sees only yes/no per requested attribute. |
| **EUDI Wallet (eIDAS 2.0)** | EU-wide digital identity wallet with SD-JWT VC. Mandatory in EU late 2026 to 2027. | 🟡 Pilot stage. Spain DNI integration scheduled. | Future work (thesis chapter 10). Backend SD-JWT issuer is already SD-JWT VC compatible, so integration is a connector, not a rewrite. |
| **Demo issuer (TFG fallback)** | Self-declared attributes during onboarding, signed by Votain's backend EdDSA key. Carries an explicit `evidence: "self-declared"` claim. | Always available | Used during development and for the TFG demo so testers without a supported passport can still vote. UI shows a clear disclaimer. |

All three sources emit an SD-JWT VC with the same attribute schema (`country`, `ageOver18`, `region`). The rest of Votain is source-agnostic.

**Layer impact**:

- **Backend (H6)**: scope of "selective disclosure" reduces. No need to implement attribute extraction from scratch. Implemented in `backend/src/eligibility/`, split so that only `self.ts` knows which provider is in use and an EUDI connector could sit beside it.
- **Frontend create wizard**: optional attribute policy in step 3, off by default. **Frontend voter flow**: `EligibilityCheck` takes over the enrol footer for a restricted election.
- **Election eligibility check (H7)**: same code path regardless of which source emitted the SD-JWT. The eligibility checklist in Screen 8 just reads the VC.
- **Thesis (H12.3)**: comparison of the sources, the trust model of each, the anonymity-set limit above, and the roadmap to EUDI Wallet.

---

## Philosophy: iterative and validatable

Each milestone produces a concrete artifact that the user validates before advancing.

**Validation**: live demo, screenshots in `docs/progress/H<n>/`, textual confirmation "validated H<n>".

**After each milestone**: update `docs/dev/state.md` and list changes for commit.

---

## Milestones

### Milestone 0. Bootstrap, dependency upgrade, dev docs ✅ COMPLETED 2026-05-23

- [x] Dependency audit and upgrade (contracts, backend, frontend).
- [x] Biconomy to ZeroDev migration in `frontend/package.json`.
- [x] Root `CONTRIBUTING.md` + per-module `DEVELOPMENT.md`.
- [x] `docs/PLAN.md` + `docs/dev/{architecture,glossary,conventions,state}.md`.
- [x] `.env.example` in `backend/` and `frontend/`.
- [x] Hardhat 3 migration (config, tests, deploy script).
- [x] Solidity 0.8.35 and TypeScript target ESNext.
- [x] MIT to AGPL-3.0 relicense for dual-licensing strategy.
- [x] Playwright MCP installed and configured (`@playwright/mcp` via `node` + full path to `cli.js`, `--headless` flag, Chromium installed). Actual screenshot verification at 3 viewports happens in H1 when implementing screens.
- [ ] Confirm LaTeX thesis template. PENDING user response.
- [ ] Verify free tier access: ZeroDev, Fleek, Pinata, Phala, World ID.

---

## PHASE A. Visual design of all 24 screens (H1 to H4)

> Screens use hardcoded data. Navigation works. Blockchain or backend actions show toast "integration pending".

### Milestone 1. Design system and base components ✅ COMPLETED 2026-05-25

**Goal**: building blocks aligned with `stich.md` (Liquid Glass iOS 26, dark mode, cold accent palette).

- [x] Design tokens: `tailwind.config.ts`, `index.css` (colors, typography, radii, blur, mesh background).
- [x] UI components in `src/components/ui/`: Button (review variants), Card, Badge (8 states + Verified blockchain + IPFS + Tie + Role), Modal/Dialog, Input/Textarea/Select, RadioCard (min 48px), Checkbox/Switch, Skeleton, Spinner/ProgressDots/Stepper, Toast, Countdown (timezone-aware), BarChart (horizontal), Avatar/IdentityCommitment, Dropdown/LanguageSelector, EligibilityChecklistRow, GasBalanceWidget, BlockchainBadge/IPFSBadge.
- [x] Layout components: Header (role indicator), Footer, BottomTabNav (mobile), TopNav (desktop).
- [x] Fix Onboarding tests (i18n setup in vitest).
- [x] `/dev/components` showcase page (DEV only).

**Validation**: `/dev/components` shows all components in their variants. Mobile and desktop responsive. Lighthouse a11y ≥90.

---

### Milestone 2. Public + Voter screens (Screens 1 to 3, 4 to 13, 23, 24) ✅ COMPLETED 2026-05-25

- [x] `src/data/seed.ts`. 8 elections covering all phases AND all 4 voting types: at least one `SIMPLE_PLURALITY` multi-candidate (e.g. student council), one `ABSOLUTE_MAJORITY` Yes/No referendum, one `SUPERMAJORITY_TWO_THIRDS` bylaw change, one `WITNESS_THRESHOLD` wedding with N=4 testigos. Include candidates and fake voters per election.
- [x] Screen 1. Discovery (card grid, filters, search, empty states).
- [x] Screen 2. Public Preview (details, countdown, read-only candidates, auth overlay CTA, voting-type badge with threshold rule shown explicitly: "most votes wins" for `SIMPLE_PLURALITY`, ">50%" for `ABSOLUTE_MAJORITY`, "≥2/3" for `SUPERMAJORITY_TWO_THIRDS`, "≥4 testigos" for `WITNESS_THRESHOLD`).
- [x] Screen 3. Public Results (renders four layouts: bar chart with highest-bar winner for `SIMPLE_PLURALITY`, bar chart with threshold line for `ABSOLUTE_MAJORITY`, Yes/No outcome card for `SUPERMAJORITY_TWO_THIRDS` and `WITNESS_THRESHOLD`, glowing winner, tie state, "Threshold not met" state, export JSON).
- [x] Screen 23. How It Works (4 step cards).
- [x] Screen 4. Onboarding step 0 (language + IP auto-detect).
- [x] Screen 5. World ID Verification (functional, already implemented in backend).
- [x] Screen 6. Re-verification UI states.
- [x] Screen 7. Voter Election List (phase-aware CTAs, countdown red <1h).
- [x] Screen 8. Election Detail Enrollment (hardcoded eligibility checklist).
- [x] Screen 9. Election Detail Active (candidate selector for `SIMPLE_PLURALITY` and `ABSOLUTE_MAJORITY`, Yes/No selector for `SUPERMAJORITY_TWO_THIRDS` and `WITNESS_THRESHOLD`, blank vote always available).
- [x] Screen 10. ZK Proof Generation (3-step overlay, simulated `setTimeout`).
- [x] Screen 11. Vote Confirmation (animated checkmark, hardcoded reference).
- [x] Screen 12. Change Vote (selector + modal).
- [x] Screen 13. Voter History (seed data).
- [x] Screen 24. Verify Receipt (input + seed data).

**Validation**: full public and voter flow on mobile and desktop, coherent with `stich.md`. Video in `docs/progress/H2/`.

---

### Milestone 3. Organizer screens (Screens 14 to 20) ✅ COMPLETED 2026-05-25

- [x] Screen 14. Passkey + Wallet Setup (step UI, WRONG NETWORK state).
- [x] Screen 15. Organizer Dashboard (glass cards, hardcoded metrics).
- [x] Screen 16. Create Election (5-step wizard: basics, **voting type + threshold**, timeline, dynamic candidates or Yes/No, settings/eligibility). The voting-type step lets the organizer pick `SIMPLE_PLURALITY` (default) / `ABSOLUTE_MAJORITY` / `SUPERMAJORITY_TWO_THIRDS` / `WITNESS_THRESHOLD`. When `WITNESS_THRESHOLD` is selected, show an N input (default 2, min 1).
- [x] Screen 17. Election Detail Organizer (phase-gated controls, passkey confirm modals).
- [x] Screen 18. Gas Management (color-coded balance, deposit form).
- [x] Screen 19. Registered Members (truncated identity commitments, search).
- [x] Screen 20. Organizer Profile (edit display name, passkeys list).

**Validation**: full organizer flow. Actions trigger correct modals but respond with toast "integration pending". Mobile and desktop responsive.

---

### Milestone 4. Shared screens + full i18n + visual polish (Screens 21, 22) ✅ COMPLETED 2026-05-26

- [x] Screen 21. Error & Empty States (14 variants).
- [x] Screen 22. Transaction Pending Modal (pending/success/failed simulated).
- [x] i18n audit. All strings from H2 and H3 translated to 13 JSON files.
- [x] IP-based language auto-detect (ipapi.co free, 1k req/day).
- [x] Visual polish. 24 screens coherent.
- [x] Framer Motion animations + motion-reduce respect.
- [x] WCAG 2.1 AA (Lighthouse / axe).
- [x] Lighthouse ≥85 performance, code-splitting lazy WASM/Paillier.
- [x] E2E tests with Playwright. Smoke test all 24 screens.
- [x] Clean up TODOs, console.logs.

**Validation**: full dApp ✅. Major checkpoint, move to real integration.

> 🛑 **Major checkpoint, Phase A complete**: dApp has all 24 screens with final design, functional navigation and i18n. Next phase is real integration.

---

## PHASE B. Real integration (H5 to H9)

### Milestone 5. Production contracts + frontend client ✅ CODE COMPLETE 2026-07 (Amoy deploy pending user key)

Part A. Contracts: official Semaphore verifier, new functions (`cancelElection`, `closeEnrollmentEarly`, `closeVotingEarly`, `publishResults`, `markVoided`), `VotingType` enum (`SIMPLE_PLURALITY`, `ABSOLUTE_MAJORITY`, `SUPERMAJORITY_TWO_THIRDS`, `WITNESS_THRESHOLD`) + `thresholdValue` field on `ElectionV4` + per-type winner-determination logic in `publishResults`, coverage ≥80%, Amoy deploy + PolygonScan verify.
Part B. Frontend: `src/lib/contracts.ts`, `src/lib/zerodev.ts`, `src/hooks/usePasskeys.ts`, `src/lib/semaphore.ts`, `src/lib/paillier.ts`.

### Milestone 6. Complete backend issuer ✅ COMPLETE 2026-07

Status List 2021, SD-JWT presentation endpoint, tests, rate limiting. **Selective disclosure is delegated to World ID Credentials** (no need to implement passport NFC reading or PKI verification ourselves). Backend integrates IDKit's credential flow and keeps the demo issuer for users without a supported passport. SD-JWT VC schema (`country`, `ageOver18`, `region`) is normalised across both sources so the rest of the stack is identity-source agnostic.

### Milestone 7. Voter flow real integration ✅ COMPLETE 2026-07

World ID + Enrollment + real ZK Proof + Vote + History.

### Milestone 8. Organizer flow real integration ✅ COMPLETE 2026-07

Real WebAuthn Passkey + Create Election tx + phase-gated controls.

### Milestone 9. Tally script + IPFS results ✅ COMPLETE 2026-07

`tally-votes.ts`, Pinata, `publishResults`, Privacy Quorum. After the Paillier homomorphic sum is decrypted, branch on `VotingType` to compute the winner or Approved/Rejected verdict (most-votes / >50% / ≥2/3 / ≥N) and embed it in the published JSON.

---

## PHASE C. Decentralized deployments (H10 to H11)

### Milestone 10. Frontend on IPFS + Fleek CD (1 to 2 days)

### Milestone 11. Backend on Phala TEE (4 to 6 days)

---

## PHASE D. Thesis + Defense (H12 to H13)

### Milestone 12. LaTeX thesis (~80 to 120 pp.), parallel from H0

- H12.1 (parallel H0 to H2): template + chapters 1 and 2.
- H12.2 (parallel H3 to H5): chapters 3 and 4.
- H12.3 (parallel H6 to H8): chapter 5 + start of 6.
- H12.4 (parallel H9 to H11): chapters 6 and 7.
- H12.5 (post H11): chapters 8 to 10 + appendices.

### Milestone 13. Defense (4 to 5 days, final week)

Slides Beamer/Slidev 15 to 20 slides, demo video, timed rehearsals.

---

## Agent operating rules (BINDING)

1. **NEVER `git commit` / `git push`**. Only list changes for the user to commit.
2. **Phase A**. Hardcoded data. NO technical mocks.
3. **Phase B**. Real integration. No mocks.
4. **Always latest versions**. Run `npm-check-updates` before each milestone.
5. **Always free tier**. Evaluate an alternative before using any paid service.
6. **After each milestone**. Update `docs/dev/state.md`.
7. **Each new screen in Phase A**. Playwright at 3 viewports. Screenshots in `docs/progress/H<n>/screens/<name>/`.
8. **All code comments and `.md` files must be in English**. No Spanish (or other language) in source code or developer docs.
9. **No em dashes (`, `) or hyphens as clause separators in documentation**. Use periods, commas or colons. Hyphens are only allowed inside compound words (e.g. "end-to-end"), technical identifiers (e.g. "ERC-4337"), version numbers, file paths and command flags.
10. **Each milestone gets its own git branch**. Before committing any work for milestone N, create branch `hN/<slug>` from the current state (e.g. `h0/bootstrap`, `h1/design-system`, `h2/voter-screens`). The user creates the branch and commits. The agent only lists the changes.
11. **Explicit TypeScript typing at all times**. Every function parameter must have an explicit type annotation. Async functions declare `: Promise<void>` (or the correct generic). Catch bindings use `(error: unknown)`. `res.json()` is cast at the source (`as Promise<MyType>`), not in a downstream `.then`. `useMemo<T[]>` and `useState<T>` generics are written out when the inferred type is ambiguous. No `any`, implicit or explicit. Full rules in `docs/dev/conventions.md`.
