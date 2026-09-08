# Votain. System Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                            USER                                 │
│  Browser (IPFS gateway / Fleek CDN)                            │
│  React 19 + Vite + Tailwind 4 + Semaphore v4 + Paillier        │
└─────────────────┬───────────────────────────┬───────────────────┘
                  │ World ID QR + relayed tx   │ RPC (read only)
                  ▼                            ▼
┌─────────────────────────┐    ┌──────────────────────────────────┐
│   BACKEND ISSUER (TEE)  │    │   BLOCKCHAIN (Polygon Amoy)      │
│   Node.js Express       │    │                                   │
│   Phala Network TEE     │    │  ElectionFactory.sol             │
│   (Intel TDX)           │    │  ElectionV4.sol                  │
│                         │    │  ElectionPaymaster.sol           │
│  POST /verify-human     │    │  PlatformRegistry.sol            │
│  ← World ID proof       │    │                                   │
│  → SD-JWT cookie        │    │                                   │
│  POST /relay/vote       │───▶│  relayed through                  │
│  (unauthenticated)      │    │  ElectionPaymaster                │
│  /attestation           │    │                                   │
│  → Intel TDX report     │    │  Semaphore V4 Verifier           │
└─────────────────────────┘    └──────────────────────────────────┘
                                              │
                                              │ queryFilter(VoteCast)
                                              ▼
                               ┌──────────────────────────────────┐
                               │   TALLY (in-app or off-chain CLI) │
                               │   in browser · scripts-tally/     │
                               │                                   │
                               │  1. Filter VoteCast by nonce     │
                               │  2. Sum ciphertexts (Paillier)   │
                               │  3. Decrypt w/ passkey-derived key│
                               │  4. Generate auditable JSON      │
                               │  5. Pin to IPFS (CLI only)       │
                               │  6. publishResults(cid, tally)  │
                               └──────────────────────────────────┘
```

## Full voting flow

```
1. IDENTITY REGISTRATION
   User → World ID App (Orb/Device)
   → Backend: POST /api/verify-human
   → Backend verifies World ID v4 proof (on-chain / off-chain)
   → Backend issues SD-JWT (httpOnly cookie, 7 days)
   → SD-JWT claims: nullifier_hash, verification_level, issued_at

2. VOTING IDENTITY
   Frontend, on the device
   → WebAuthn (Passkey) → PRF secret → Semaphore identity
   → the voter never holds an address: transactions go through the
     issuer relayer, because a per-voter address would link their
     enrolment to their ballot on chain

3. ELECTION ENROLLMENT
   Frontend reads SD-JWT cookie
   → Verifies eligibility criteria
   → Identity commitment = poseidon(nullifier_hash + secret)
   → PlatformRegistry.registerMember(identityCommitment) via UserOp
   → ElectionV4 adds member to Semaphore group

4. VOTING
   Frontend: user selects candidate
   → Paillier encrypt(candidate_index, publicKey)
   → ZK Proof: Semaphore V4 circuit
     input: identity, group, scope (electionId), signal (encrypted_vote)
     output: proof, nullifier, merkleRoot
   → UserOp: ElectionV4.castVote(nullifier, nonce, proof, voteCiphertext)
   -> ElectionPaymaster relays the call and reimburses the relayer from the
     organizer gas tank, in the same transaction
   → Tx on Amoy

5. COERCION RESISTANCE (vote change)
   Same nullifier, nonce+1
   → Contract only counts the vote with the highest nonce per nullifier
   → Coerced user can vote again "under pressure" without revealing the previous vote

6. TALLY (two interchangeable paths, same pipeline)
   a) In-app (default): organizer opens the election → Compute tally → Publish.
      Decryption runs in the browser; the Paillier key is DERIVED on demand from
      the organizer's passkey PRF (public per-election keyNonce in metadata),
      never stored at rest. Publishing is a wallet-signed publishResults tx.
   b) Offline CLI (auditor path): scripts-tally/tally-votes.ts recomputes the
      same result independently and pins the audit JSON to IPFS (Pinata).
   Both: keep max nonce per nullifier → homomorphic sum → decrypt → if
   votes < Privacy Quorum → Voided; else publishResults(cid, tally).
```

## Module breakdown

### contracts/

| Contract | Purpose |
|----------|---------|
| `ElectionV4.sol` | Single election: ERC-2771, Semaphore V4, Paillier, coercion resistance |
| `ElectionFactory.sol` | ElectionV4 deployment, paymaster fund management |
| `ElectionPaymaster.sol` | ERC-4337 Paymaster: sponsors gas for verified voters |
| `PlatformRegistry.sol` | Identity commitment registry with owner access control |

### backend/

| Route | Purpose |
|-------|---------|
| `POST /api/verify-human` | Verify World ID proof, issue SD-JWT, register voter on-chain |
| `POST /api/rp-signature` | Sign World ID request (DEVELOPER_KEY) |
| `GET /api/me` | Return active session from cookie |
| `POST /api/logout` | Invalidate cookie |
| `GET /api/credentials/status/:listId` | Publish the Status List 2021 revocation credential |
| `POST /api/credentials/status/:listId/revoke` | Revoke a credential by index (admin) |
| `GET /api/issuer/public-key` | Issuer public key (for verifiers) |
| `POST /api/present` | Verify an SD-JWT selective-disclosure presentation |
| `GET /health` | Health check |

Backend modules: `sd/issuer.ts` (SD-JWT issue/verify), `status/statusList.ts`
(revocation bitstring), `chain/registrar.ts` (on-chain member registration).

### frontend/ (stich.md screens)

**Public flow** (no auth):
- Screen 1. Discovery. Browse elections.
- Screen 2. Public Preview. Election detail without auth.
- Screen 3. Public Results. Verifiable results.
- Screen 23: How It Works

**Voter flow** (authenticated via World ID):
- Screen 4: Onboarding (5 steps)
- Screen 5: World ID Verification
- Screen 6: Re-verification
- Screen 7: Voter Election List
- Screen 8: Election Detail (Enrollment)
- Screen 9: Election Detail (Active, vote)
- Screen 10: ZK Proof Generation
- Screen 11: Vote Confirmation
- Screen 12: Change Vote
- Screen 13: Voter History
- Screen 24: Verify Receipt

**Organizer flow**:
- Screen 14: Passkey + Wallet Setup
- Screen 15: Organizer Dashboard
- Screen 16: Create Election (4-step wizard)
- Screen 17: Election Detail (phase-gated controls)
- Screen 18: Gas Management
- Screen 19: Registered Members
- Screen 20: Organizer Profile

**Shared**:
- Screen 21: Error & Empty States (14 variants)
- Screen 22: Transaction Pending Modal

## Election state machine

`ElectionV4.phase()` derives the phase from the timestamps (plus the terminal
flags). `PENDING_VOTE` only occurs when a separate enrollment window leaves a gap
(`enrollEnd < voteStart`); with no gap it collapses away.

```
Upcoming → Enrolling → PendingVote → Active → Tallying → Closed (Approved / Rejected)
└──────────── any pre-decision phase ────────┘    │
                     ↓                             ↓
                 Cancelled                       Voided (Privacy Quorum not reached)
```

- **Upcoming**: deployed, enrollment not open yet (`now < enrollStart`).
- **Enrolling**: enrollment open (`enrollStart ≤ now < enrollEnd`).
- **PendingVote**: enrollment closed, voting not open (`enrollEnd ≤ now < voteStart`).
- **Active / Tallying**: voting open / ended, awaiting results.
- **Closed / Voided / Cancelled**: terminal (results published / quorum unmet / cancelled).

## Voting types

Each election declares one of four winner-determination rules. The cryptographic primitive (Paillier homomorphic sum of Semaphore-proof-anchored ciphertexts) is identical across all four; only the post-decryption check differs.

| `VotingType` | Approval rule | Example |
|--------------|---------------|---------|
| `SIMPLE_PLURALITY` | Candidate with most votes wins (margin can be a single vote) | Local elections, club president |
| `ABSOLUTE_MAJORITY` | yes-votes > 50% of total eligible voters | Public elections with majority requirement |
| `SUPERMAJORITY_TWO_THIRDS` | yes-votes ≥ ⌈2/3⌉ of total eligible voters | Bylaw changes |
| `WITNESS_THRESHOLD` | yes-votes ≥ N (absolute number) | Wedding (N=4 testigos), multi-sig |

The `ElectionV4` contract stores `VotingType votingType` and `uint thresholdValue` (used only for `WITNESS_THRESHOLD`). `publishResults` enforces the rule on chain after the tally (in-app or CLI) decrypts the homomorphic sum.

## Identity sources for selective disclosure

Eligibility attributes (age, nationality, region) are carried in SD-JWT VCs. Votain supports three plug-in sources that all emit the same schema, so the rest of the stack is source-agnostic.

| Source | What it does | Trust model |
|--------|--------------|-------------|
| **World ID Credentials** | World App reads the user's passport NFC chip locally, verifies ICAO 9303 PKI, generates ZK proofs for requested attributes | Trust the chip issuer (national passport authority) and Worldcoin's verifier. No raw document data leaves the device |
| **EUDI Wallet (eIDAS 2.0)** | User's national digital identity wallet emits an SD-JWT VC against a requested presentation definition | Trust the national eID PKI. Future work, mandatory in EU late 2026 to 2027 |
| **Demo issuer** | Votain's backend signs an SD-JWT with user-declared attributes (used during TFG demo) | No real verification. UI shows `evidence: "self-declared"` disclaimer. Not for production |

The frontend onboarding flow lets the user pick the source. The backend SD-JWT issuer acts as a thin connector layer rather than implementing document reading itself.

## Deployment targets

| Component | Solution | Reason |
|-----------|----------|--------|
| Frontend | Fleek IPFS + GitHub CD | Immutable, decentralized, IPFS badge |
| Backend | Phala Network TEE | Signs VCs, requires trusted environment |
| Contracts | Polygon Amoy (testnet) | Free EVM, Semaphore available |
| IPFS tally | Pinata free (1 GB) | Immutable audit trail |
| CI/CD | GitHub Actions (2000 min/month) | Free, automated |
