# Votain — System Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                            USER                                 │
│  Browser (IPFS gateway / Fleek CDN)                            │
│  React 19 + Vite + Tailwind 4 + ZeroDev v5 + Semaphore v4     │
└─────────────────┬───────────────────────────┬───────────────────┘
                  │ World ID QR / deep link    │ RPC (ZeroDev Bundler)
                  ▼                            ▼
┌─────────────────────────┐    ┌──────────────────────────────────┐
│   BACKEND ISSUER (TEE)  │    │   BLOCKCHAIN (Polygon Amoy)      │
│   Node.js Express       │    │                                   │
│   Phala Network TEE     │    │  ElectionFactory.sol             │
│   (Intel TDX)           │    │  ElectionV4.sol                  │
│                         │    │  ElectionPaymaster.sol           │
│  POST /verify-human     │    │  PlatformRegistry.sol            │
│  ← World ID proof       │    │                                   │
│  → SD-JWT cookie        │    │  ERC-4337 EntryPoint (Amoy)      │
│                         │    │  ZeroDev Bundler + Paymaster     │
│  /attestation           │    │                                   │
│  → Intel TDX report     │    │  Semaphore V4 Verifier           │
└─────────────────────────┘    └──────────────────────────────────┘
                                              │
                                              │ queryFilter(VoteCast)
                                              ▼
                               ┌──────────────────────────────────┐
                               │   TALLY SCRIPT (off-chain)       │
                               │   scripts-tally/tally-votes.ts   │
                               │                                   │
                               │  1. Filter VoteCast by nonce     │
                               │  2. Sum ciphertexts (Paillier)   │
                               │  3. Decrypt with organizer key   │
                               │  4. Generate auditable JSON      │
                               │  5. Pin to IPFS (Pinata free)    │
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

2. SMART ACCOUNT CREATION
   Frontend → ZeroDev SDK
   → WebAuthn (Passkey) → KernelAccount v3
   → Smart Account (AA, ERC-4337) on Amoy

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
   → Paymaster sponsors gas (ZeroDev / ElectionPaymaster)
   → Tx on Amoy

5. COERCION RESISTANCE (vote change)
   Same nullifier, nonce+1
   → Contract only counts the vote with the highest nonce per nullifier
   → Coerced user can vote again "under pressure" without revealing the previous vote

6. TALLY
   Organizer runs scripts-tally/tally-votes.ts
   → Filters VoteCast events, keeps max nonce per nullifier
   → Homomorphic sum of ciphertexts (Paillier)
   → Decrypts with organizer's private key (stored with passkey)
   → If votes < Privacy Quorum → Voided
   → Publishes JSON to IPFS (Pinata)
   → Calls ElectionV4.publishResults(cid, tally)
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
| `POST /api/verify-human` | Verify World ID proof + issue SD-JWT |
| `POST /api/rp-signature` | Sign World ID request (DEVELOPER_KEY) |
| `GET /api/me` | Return active session from cookie |
| `POST /api/logout` | Invalidate cookie |
| `GET /health` | Health check |

### frontend/ (stich.md screens)

**Public flow** (no auth):
- Screen 1: Discovery — browse elections
- Screen 2: Public Preview — election detail without auth
- Screen 3: Public Results — verifiable results
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

```
Draft → Enrollment → Active → Tallying → Closed
                  ↓          ↓
               Cancelled   Voided (quorum not reached)
```

## Deployment targets

| Component | Solution | Reason |
|-----------|----------|--------|
| Frontend | Fleek IPFS + GitHub CD | Immutable, decentralized, IPFS badge |
| Backend | Phala Network TEE | Signs VCs — requires trusted environment |
| Contracts | Polygon Amoy (testnet) | Free EVM, Semaphore available |
| IPFS tally | Pinata free (1 GB) | Immutable audit trail |
| CI/CD | GitHub Actions (2000 min/month) | Free, automated |
