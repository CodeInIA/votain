# Votain

> End-to-end verifiable, anonymous, coercion-resistant voting dApp on Polygon Amoy.

Votain is a Bachelor's thesis project (TFG) demonstrating how modern cryptographic primitives (Zero-Knowledge Proofs, Verifiable Credentials, Homomorphic Encryption and meta-transaction relaying) can be combined into a voting system where every voter can verify their ballot is counted, a coerced ballot can always be overridden, and no organizer can publish a result the ballots do not support.

## Why Votain

| Property | How it is achieved |
|----------|--------------------|
| **End-to-end verifiable** | Every ballot is an ElGamal ciphertext on chain with a zero-knowledge proof that it is exactly one valid option, so a stuffed or malformed ballot never gets in. The election adds every ballot into an aggregate itself, and publishes a result only with a proof that the counts are that aggregate's decryption. Anyone can re-add the ballots and re-check the proof with no key, in the results screen or with `npm run tally -- <election> --verify`. The auditor CLI additionally pins a result JSON to IPFS; the in-app tally does not pin yet |
| **Anonymous** | Semaphore V4 zero-knowledge proofs hide voter identity inside the eligible-voters group |
| **Coercion resistant** | A coerced voter can vote again, and nobody watching can tell they did. Every ballot silently cancels the voter's previous one, proved in zero knowledge without saying which, and a first vote and a re-vote look the same on chain. One ballot per voter per hour bounds how fast anyone can spend the organizer's gas, through tags that link nothing. The limit, stated plainly: the organizer's key could open a single ballot and see that it replaced one, though never whose it is (see [Known limits](#known-limits)) |
| **Sybil resistant** | World ID v4 proof of personhood under one action fixed by the server, so one person holds one platform identity. Elections that require a document also refuse the same passport or ID card twice, whatever World ID account it arrives with |
| **Eligible without identifying** | Age and nationality come from the chip in a passport or national identity card, read over NFC by the [Self](https://self.xyz) app and proved in zero knowledge. The document never leaves the phone, and age is asked as a predicate: the answer is "over 18", never a date of birth |
| **Gasless for voters** | Ballots are relayed through `ElectionPaymaster`, reimbursed from the organizer's own gas tank; voters never hold tokens |
| **Unlinkable on chain** | Every voter's call arrives from the same relay contract, so the sender address cannot tie an enrollment to a ballot |
| **Decentralized deployment** | Frontend on IPFS (4EVERLAND) at `votain.app`, issuer in an Intel TDX enclave (Phala) at `api.votain.app` with its image built in public CI and pinned by digest, contracts on Polygon Amoy |

## Screenshots

<p align="center">
  <img src="docs/screenshots/pc/discover.webp" alt="The public election catalogue: twelve elections across the lifecycle, each card showing its rule, deadline, enrolment and turnout" width="900">
</p>

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/pc/election.webp" alt="An election: phase timeline, enrolment and turnout counters, quorum, and an on-chain verification badge"></td>
    <td width="50%"><img src="docs/screenshots/pc/results.webp" alt="Published results, per option, decrypted from the homomorphic sum"></td>
  </tr>
  <tr>
    <td>An election, with its phases dated and the quorum it has to clear.</td>
    <td>Results, once the homomorphic sum has been decrypted and written back.</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/pc/organizer-gas.webp" alt="The organizer's gas tank: deposits, reserves, and what each relayed ballot cost"></td>
    <td><img src="docs/screenshots/pc/voter-profile.webp" alt="Voter profile: anonymous identifier, generated pattern, recovery phrase and linked passkeys"></td>
  </tr>
  <tr>
    <td>The gas tank voters spend from, priced from past relays rather than assumed.</td>
    <td>The voter's profile: their identifier, recovery phrase and passkeys.</td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/mobile/discover.webp" alt="The election catalogue on a phone" width="270">
  &nbsp;
  <img src="docs/screenshots/mobile/voter-profile.webp" alt="The voter profile on a phone" width="270">
  &nbsp;
  <img src="docs/screenshots/mobile/organizer-dashboard.webp" alt="The organizer dashboard on a phone" width="270">
</p>

**[Every screen, desktop and mobile →](docs/SCREENS.md)**

<p align="center"><em>Built for a phone first. 13 languages, including right-to-left Arabic.</em></p>

> Captured against a local Hardhat node with the contracts deployed on it: real elections,
> real enrolments, real ballots. Nothing is on Polygon Amoy yet, so none of it has faced a
> public chain. The app also ships a demo dataset for when no contracts are configured, and
> says so in a banner on every screen while it is in use.

## Architecture overview

```
User (recovery phrase + World ID)
    ├── React 19 + Vite + Tailwind 4             ◄──── IPFS (4EVERLAND)
    │
    ├── SD-JWT issuance ── Backend (Node + Express)  ◄──── Phala TEE
    │                      Verifies World ID (personhood) and
    │                      Self proofs (age, nationality), issues VC
    │
    └── relayed tx ─────── Polygon Amoy
                           ElectionFactory · ElectionV4
                           ElectionPaymaster · PlatformRegistry
                           Ballot + tally Groth16 verifiers
                           ElectionV4 keeps the ElGamal aggregate
                                                  │
                                                  ▼
                           Tally (decrypt the aggregate, prove it): in-app
                           in the browser, or the off-chain CLI
                           → Result JSON pinned on IPFS (Pinata, CLI)
                           → publishResults(cid, counts, proof), verified on chain
```

Full diagram in [`docs/dev/architecture.md`](docs/dev/architecture.md).

## Monorepo layout

```
votain/
├── circuits/          # ballot + tally circuits (circom), trusted setup, verifier generation
├── contracts/         # Solidity 0.8.37 + Hardhat 3
├── backend/           # Node.js Express SD-JWT issuer (target: Phala TEE)
├── frontend/          # React 19 + Vite (deployed: IPFS / 4EVERLAND)
├── scripts-tally/     # off-chain tally, proof, IPFS publication and --verify (auditor CLI)
├── docs/
│   ├── PLAN.md        # iterative milestone plan (source of truth)
│   ├── dev/           # developer documentation
│   │   ├── architecture.md
│   │   ├── conventions.md
│   │   ├── glossary.md
│   │   └── state.md   # current milestone, versions, technical debt
│   └── screenshots/   # the images this README shows
└── memoria/           # LaTeX thesis (parallel track)
```

## Tech stack

**Circuits**: circom 2 (WASM build), circomlib, Groth16 via [`snarkjs`](https://github.com/iden3/snarkjs); Semaphore V4 identities and LeanIMT trees.

**Contracts**: Solidity 0.8.37, Hardhat 3, ethers v6, OpenZeppelin 5, LeanIMT and Poseidon from [zk-kit](https://github.com/privacy-scaling-explorations/zk-kit).

**Backend**: Node.js 24, Express 5, [`@sd-jwt/core`](https://github.com/openwallet-foundation-labs/sd-jwt-js) (EdDSA / Ed25519), [`@worldcoin/idkit-core`](https://docs.world.org/) v4, [`@selfxyz/core`](https://self.xyz) for document-backed eligibility, tsx.

**Two identity sources, two different jobs.** World ID answers *are you a distinct human*, once per election scope. Self answers *do you meet this election's rules* (a minimum age, a nationality inside or outside a named set) from a real document, without disclosing the values behind the answers. Only `backend/src/eligibility/self.ts` knows Self exists: the rest of `eligibility/` speaks in policies and attestations, so an EUDI Wallet connector can be added beside it without touching them.

**Frontend**: React 19, Vite (Rolldown), Tailwind CSS 4, [`@semaphore-protocol/{identity,group}`](https://semaphore.pse.dev/), `snarkjs` (proving in the browser), [`@worldcoin/idkit`](https://docs.world.org/), i18next (13 languages), framer-motion.

Pinned versions live in [`docs/dev/state.md`](docs/dev/state.md).

## Quick start

```bash
# Circuits: witness tests, then the trusted setup and the generated verifiers.
# The first build spends ~15 minutes on a local phase 1 (cached afterwards);
# PTAU=<path to a public powers-of-tau file> skips it.
cd circuits
npm install
npm test
npm run build

# Contracts (Hardhat 3; the E2E suite proves for real, so build circuits first)
cd contracts
npm install
npx hardhat test
npx hardhat compile

# Backend (requires .env with ISSUER_PRIVATE_KEY, see backend/.env.example)
cd backend
npm install
npm test                             # 144 tests, node:test
npm run dev                          # http://localhost:3000

# Frontend
cd frontend
npm install
npm test                             # 562 tests, vitest
npm run dev                          # http://localhost:5173
npm run build
```

> **Windows / corporate network**: prepend `NODE_OPTIONS="--use-system-ca"` to any `npm install` or `npm-check-updates` command to avoid SSL chain errors.

## Project status

Contracts, backend issuer and both user flows are written, wired together and green.
What is NOT done is the last mile: nothing is deployed to Amoy yet, so none of it has
been exercised against a live chain, and the IPFS audit trail is produced only by the
auditor CLI. See [`docs/PLAN.md`](docs/PLAN.md) for the plan and
[`docs/dev/state.md`](docs/dev/state.md) for what is pinned and what is owed.

| Milestone | Description | Status |
|-----------|-------------|--------|
| H0 | Bootstrap, dependency upgrade, dev docs | ✅ |
| H1 | Design system and base components | ✅ |
| H2 to H4 | 24 screens, 13 languages | ✅ |
| H5 | Production contracts + chain client | ✅ code complete, Amoy deploy pending |
| H6 | Backend issuer feature complete | ✅ |
| H7, H8 | Real voter and organizer integration | ✅ |
| H9 | Tally + IPFS results | 🟡 tally done in-app and in the CLI; IPFS pinning only in the CLI |
| H10 | Frontend on IPFS (4EVERLAND) | ✅ live at `votain.app` |
| H11 | Backend in a TEE | ✅ verified on Phala (Intel TDX): image pinned by digest, signed provenance, attestation reports that digest. Served from Heroku between sessions, since Phala is $42/month; one workflow switches either way |
| H12, H13 | Thesis and defense | ⏳ |

**891 tests pass**: 185 on the contracts, 144 on the backend, 562 on the frontend.

## Known limits

Stated here so that nobody reads their absence as a guarantee; the full list is
in [`docs/dev/architecture.md`](docs/dev/architecture.md#known-limits-stated-plainly).

- **The organizer's key could open a single ballot.** The app only ever decrypts
  the aggregate, but the keys could open any one ballot, and its cancellation
  shows whether it replaced an earlier vote. Never whose ballot it is, nor which
  it replaced. Splitting the key among trustees (threshold decryption) would
  remove the power; on ElGamal that is now a protocol to add, not a primitive to
  change.
- **The trusted setup is the deployment's to run.** The default circuit build
  uses a public development ceremony, which `deploy.ts` refuses off the local
  chain.
- **One backend instance, no indexer.** Rate limits and sessions live in process
  memory, and browsers read events straight from the RPC in windows. Fine at
  thesis scale; a public platform needs a shared store and an indexer.
- **The issuer sees network metadata** of the requests it relays.

## Documentation

- [`CONTRIBUTING.md`](CONTRIBUTING.md). Developer guide, monorepo conventions.
- [`docs/PLAN.md`](docs/PLAN.md). Milestone plan and operating rules.
- [`docs/SCREENS.md`](docs/SCREENS.md). Every screen, desktop and mobile, both roles.
- [`docs/dev/architecture.md`](docs/dev/architecture.md). Full system architecture.
- [`docs/dev/conventions.md`](docs/dev/conventions.md). Coding conventions, color tokens, i18n keys.
- [`docs/dev/deployment.md`](docs/dev/deployment.md). CI pipeline, the two backend hosts, and how to verify either from outside.
- [`docs/dev/world-id-listing.md`](docs/dev/world-id-listing.md). App store text for the World ID Developer Portal, in all thirteen languages.
- [`docs/dev/glossary.md`](docs/dev/glossary.md). Semaphore, nullifier, SD-JWT, relaying, ElGamal, TEE.
- [`docs/dev/state.md`](docs/dev/state.md). Current state, pinned versions, technical debt.
- Per-module guides: [`contracts/DEVELOPMENT.md`](contracts/DEVELOPMENT.md), [`backend/DEVELOPMENT.md`](backend/DEVELOPMENT.md), [`frontend/DEVELOPMENT.md`](frontend/DEVELOPMENT.md).

## License

Votain is released under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [`LICENSE`](LICENSE) for the full text.

This means you are free to use, modify and redistribute Votain, but if you run a modified version as a network-accessible service you must publish your source. **Commercial licenses without AGPL obligations are available**. Contact the author.

## Author

Sergio Barrios Paz. Bachelor's thesis (TFG), Universidad Rey Juan Carlos (ETSII), 2026.
