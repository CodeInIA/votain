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

### What the tally guarantees, and what it does not

Three separate things protect a published result. They are worth keeping apart,
because each stops a different attack and none of them stops all three.

**The counters have to account for every ballot.** A ballot for option i is the
Paillier plaintext B^i, so summing ciphertexts sums per-option counters in base
B, and every ballot adds exactly one to exactly one counter. `decryptTally`
therefore checks that the unpacked counters total the ballots that went in. The
check it replaces only looked for a leftover past the LAST counter, which an
overflow from option 0 into option 1 never produces: the tally came out quietly
wrong with nothing to show for it. B is a trillion, and `MAX_OPTIONS` in the
contract is 50 because 51 counters of 12 digits is as much as a 2048-bit modulus
can carry. The base is recorded per election in `metadataJson.counterBase`,
since it is fixed into each ballot when it is encrypted and cannot be changed
underneath an election already running.

**A result may not rest on too few voters.** `publishResults` reverts below
`privacyQuorum`, leaving `markVoided` as the only way the election can end.
This bounds PUBLICATION, not knowledge: the organizer holds the decryption key
and the ciphertexts are public, so they can always compute the result privately
and no contract can prevent it. Only threshold decryption, splitting the key so
no single party can decrypt alone, would. Note also that a small tally leaks by
itself, whoever decrypts it: three voters and a 3-0 result identifies everyone.

**Anyone can check the totals without a key.** The results screen compares the
published counters against `distinctVoters`, which the contract counts and
anyone can read, so invented or dropped ballots are visible to every reader
rather than only to someone who runs the CLI.

#### Not guaranteed

The contract does NOT require the published counters to sum to
`distinctVoters`, though every honest tally does. It never validates a
ciphertext, only the membership proof around one, so an enrolled voter can cast
arbitrary bytes as their ballot; with that rule in place, one voter could make
any election permanently unpublishable. It would also buy little, since an
organizer inclined to falsify moves votes BETWEEN options and leaves the total
alone.

Closing that needs two pieces this project does not have. A **ballot validity
proof**, so a ciphertext is provably one of the allowed plaintexts, which is
what would make the sum rule safe to enforce. And a **proof of correct
decryption**, so the organizer must show the published numbers really are the
decryption of the aggregate anyone can recompute from chain. With both, a false
tally could not be posted at all. Without them it can be posted and then
contradicted, which is weaker, and saying so is more useful than implying
otherwise.

#### Threshold decryption, and why it is not here

The organizer holding the whole decryption key is the one limit none of the
above reaches. The standard answer is threshold decryption: split the private
key into k shares so that any t of them can decrypt together and t-1 learn
nothing. Each trustee produces a partial decryption of the aggregate and the
partials combine into the result, so the complete key never exists anywhere.
That is what would make "not even the organizer can see the result early" a
property rather than a promise.

It is not here, and the reason is the primitive. With Paillier the hard part is
not decrypting, it is GENERATING: the trustees would have to jointly produce an
RSA modulus n = p*q without any of them learning p or q, which is a serious
multi-party protocol. The usual shortcut is a trusted dealer who generates the
key, splits it and deletes the original, but then that party held the whole key
for a moment, which is precisely the assumption threshold decryption exists to
remove.

Comparable systems avoid this by not choosing Paillier. Helios and Belenios use
exponential ElGamal, where distributed key generation is almost free: each
trustee picks x_i and publishes g^x_i, and the public key is the product. No
factoring, no dealer. The cost is that decryption ends in a discrete log, which
is fine because the result is bounded by the number of voters and can simply be
searched. The honest summary is that the clean route to a threshold ran through
choosing ElGamal at the start.

There is also a product cost, separate from the cryptography. Trustees are
people who hold shares and have to turn up to decrypt. An organizer creating an
election in two minutes is part of what this is; requiring three parties to
coordinate before anyone sees a result is a different system.

**A tempting non-solution, recorded so nobody proposes it again.** Publishing
the private key once the election closes looks like it buys full verifiability:
anyone could then repeat the decryption and confirm the published numbers. It
does, and it simultaneously lets anyone decrypt INDIVIDUAL ballots. Paired with
the receipts voters already hold, that destroys coercion resistance completely.
Verifiability bought at the price of the secret ballot is not a trade worth
making.

#### Why the contract does not tally by itself

The obvious fix to the organizer seeing the result early is to have the contract
compute it at close. It cannot, and the reason is worth stating precisely,
because it is the first thing anyone asks.

A contract HAS NO SECRETS. Everything in its storage is readable by anyone;
`private` in Solidity means other contracts cannot read it through Solidity,
not that it is hidden, and `eth_getStorageAt` returns it to whoever asks. A
decryption key stored in the contract is a decryption key everyone has, and with
it anyone decrypts INDIVIDUAL ballots rather than just the total. That is
strictly worse than what we have.

The homomorphic sum is a different matter: adding ciphertexts needs only the
public key, so the contract could maintain the aggregate itself. With a 2048-bit
key the modulus n^2 is 4096 bits and the EVM can only do that through the MODEXP
precompile, at real cost per ballot. It would also buy very little. That sum is
already deterministic and public: anyone can read the VoteCast events and
recompute the identical aggregate on their own machine. Putting it on chain
moves where a public computation happens without adding any assurance. The trust
gap is not in the addition. It is entirely in the decryption.

Timelock encryption (encrypting the key to a future drand round, say) looks like
it closes this: nobody could decrypt before the deadline, everybody could after.
But the ciphertexts stay on chain forever, so releasing the key at any point
lets anyone decrypt individual ballots retroactively. Same trap as above.

What would actually give a contract-computed result is a chain where the
contract can operate on encrypted data with a validator committee holding the
key in threshold, such as an FHE rollup. That is a real answer, and its price is
deploying there and trusting that committee. There is a lighter one that needs
no change of chain, described under **An auto-tally that gives nothing up**
below. Notice the pattern across every option: none removes trust, they
redistribute it.

#### Who would hold the shares

Threshold decryption only means anything if the shareholders would not collude,
and that is a property of people, not of cryptography. Three arrangements were
considered.

**Split among the organizer's own members**, enabled for organizers who have
verified a domain through `OrganizerDomains`. Sound where the organizer is an
institution: it turns "the mayor can look" into "three of five board members
must act", which has a direct real-world analogue. It does nothing where the
organizer is one person, and a system should not pretend otherwise: a wedding
with four witnesses gains nothing from splitting a key four ways among one
household. The property is opt-in by nature.

**Sampled randomly among enrolled voters.** Appealing, and used elsewhere
(Ethereum samples validator committees this way), but it fails here on liveness.
Decryption would need t voters to COME BACK after the close, and voters vote and
leave. Set t high and an election that nobody returns to has no result, ever,
with no recourse. Set t low and collusion needs fewer people than the board you
distrusted. Worse, it creates an attack that does not exist today: the aggregate
is recomputable at any moment, so a small coalition of voters holding shares
could decrypt the RUNNING tally during voting and campaign on it. The organizer
seeing the final result once is a smaller problem than a faction watching the
scoreboard live.

**A declared electoral board.** The arrangement that survives the objections to
the other two, and the one that matches how the domain actually works. The board
is fixed when the election is created, committed on chain the way
`eligibilityPolicyHash` already commits the rules, so it cannot be swapped
afterwards. Members are identified, which lets a voter evaluate the trust model
BEFORE casting a ballot rather than discovering it afterwards. It exchanges a
cryptographic guarantee for an accountable one, deliberately, which is what a
real electoral board is: not people who cannot cheat, but people who can be
named if they do.

Three things constrain it, and all three are why it would be per-election and
opt-in rather than the default:

- **Naming people is itself a risk.** In a contested election a named board is a
  target. Real boards have legal protection behind them; a board in a dApp may
  not, and in a repressive setting publishing who holds the keys publishes who
  to arrest. It fits high-stakes elections with institutional backing, which is
  exactly where it is worth having, and fits nothing else.
- **Names are personal data, and this chain forgets nothing.** The terms already
  tell organizers not to put third-party personal data on chain, precisely
  because it is public, permanent and unerasable. A roster would have to follow
  the pattern the eligibility policy already uses: the names served off chain,
  only a hash committed, so the contract proves the board did not change without
  making the members' data indelible. Board members consent as part of accepting
  the role, which is a different legal position from a third party who was never
  asked.
- **Accountability is not prevention.** A board that colludes still sees the
  result early. What changes is that the misuse is attributable rather than
  impossible, which is the same trade real elections make and is worth making
  knowingly.

One thing a named board buys that nothing else does: a documented key ceremony
becomes meaningful. The distributed-keygen problem above can be answered the way
certificate authorities answer it, with a recorded procedure and witnesses, but
only when the witnesses have names.

#### An auto-tally that gives nothing up

Every arrangement above needs people: an organizer, a board, a committee of
members. The question that follows is whether a result can be produced with
nobody acting at all, and whether that can be had without giving up a property
Votain already has. Five candidates were looked at, and the last one works.

**Functional encryption is the right primitive and has no usable library.** In
functional encryption a key is issued FOR A FUNCTION: `sk_f` reveals `f(x)`
and nothing else about `x`. With `f` = sum that is inner-product functional
encryption, which is precisely a key that opens the total and cannot open the
parts, and its multi-client variants (MCFE, DMCFE) decentralise the authority so
no single party issues it. A 2025 scheme, FTMCFE-IP, even adds the property this
would need most: clients encrypt independently with no interaction, and
decryption succeeds once a threshold of them has contributed, so the key
material would arrive as a side effect of voting and abstention would be the
"dropout" the scheme tolerates. The blocker is not the mathematics. The two
reference implementations, CiFEr in C and GoFE in Go, both state in their own
READMEs that they exist for research and must not be used in production, and
there is no JavaScript or TypeScript implementation at all.

**Timelock encryption is production-ready and unusable here on its own.** drand's
`tlock` is a TypeScript library, security-assessed by Kudelski, running against
a mainnet the League of Entropy has operated since 2019: exactly this stack.
Sealing the tally key until `voteEnd` would remove the organizer's early access
and let anyone tally afterwards. It cannot be used as it stands because the key
becomes PUBLIC at the deadline, and the ciphertexts stay on chain forever, so
every individual ballot becomes decryptable retroactively.

**And that points at the real obstacle, which is not cryptographic.** Releasing
the key is only dangerous because voters hold receipts. As the coercion section
records, the key alone yields an anonymous table of votes and deanonymises
nobody; it is the pairing with a receipt that reads a vote. So auto-tally by key
release and individual verifiability are not both available: Votain chose
individual verifiability, and that choice, not a missing library, is what ruled
out the simplest path.

**FHE coprocessors work but arrive too late.** Zama's fhEVM coprocessor reaches
EVM chains including Polygon without changing the underlying protocol, and
decryption runs through a 13-node MPC committee under an honest-majority
assumption. Mainnet integration lands in Q3 2026, which makes it a moving target
for a system being finished, and adopting it would mean rewriting the ballot and
tally layers around someone else's protocol.

**The one that gives nothing up: compute where the key lives.** The assumption
buried in all of the above is that decrypting requires the key to reach
somebody. It does not, if the computation happens where the key already is. Lit
Protocol is a key-management network whose nodes hold shares from a distributed
key generation, so no node ever has a whole key, and whose Lit Actions run
JavaScript inside each node's trusted execution environment. `decryptAndCombine`
decrypts inside that enclave, and only what the action chooses to return ever
leaves it.

The shape that follows:

- At election creation a Lit Action generates the Paillier keypair INSIDE the
  enclave, returns only the public `n` and `g`, and stores the private key
  sealed under an access condition that reads this election's `phase()` on
  Polygon. The organizer never holds it, so there is nothing to take on trust
  about deleting it.
- Before the close nobody can decrypt: the condition is not met.
- After it anyone can trigger the tally action, which decrypts the key inside the
  enclave, reads the VoteCast events, keeps the highest nonce per nullifier,
  aggregates, decrypts THE AGGREGATE ONLY, and returns the counts. The key never
  leaves and no individual ballot is ever decrypted.

Receipts keep working, ballot secrecy is stronger than today because not even
the organizer can read a ballot, coercion resistance is untouched, and the
Paillier pipeline is unchanged. What it buys is that no party can see the result
early and anybody can produce it.

What it costs, stated plainly:

- **It is still a committee.** Lit's nodes, thresholded and with distributed
  keygen, but a committee. The gain is moving trust from a party with an
  interest in the outcome to a network that does not know the election exists,
  which is a real gain and not the same as removing trust.
- **It trusts hardware.** Enclaves have a long history of side-channel breaks.
- **It adds an external dependency.** An election sealed to a network that later
  disappears can never be tallied, and every contingency plan for that
  reintroduces somebody holding a copy.
- **Two limits are unmeasured and would decide it.** Whether generating a
  2048-bit Paillier keypair fits inside a Lit Action's time and memory budget,
  and whether some thousands of 4096-bit modular multiplications fit in its
  execution budget. Both are answered by measuring, not by reasoning, and a
  proof of concept over twenty ballots would settle them before any of this is
  worth building.

##### Where this was checked

The claims above are someone else's work, and a reader should be able to go and
disagree with them.

- Functional encryption, the primitive that separates "read the sum" from "read
  a ballot": [DMCFE for inner product](https://eprint.iacr.org/2017/989.pdf),
  [verifiable DMCFE](https://eprint.iacr.org/2023/268.pdf), and
  [FTMCFE-IP](https://arxiv.org/abs/2510.15367) for the threshold-and-dropout
  variant that would suit an electorate.
- That its implementations are not production software, in their own words:
  [GoFE](https://github.com/fentec-project/gofe) and
  [CiFEr](https://github.com/fentec-project/CiFEr).
- Timelock: [tlock-js](https://github.com/drand/tlock-js), the
  [scheme](https://eprint.iacr.org/2023/189.pdf) and its
  [security assessment](https://docs.drand.love/blog/2023/05/26/tlock-security-assessment/).
- FHE on an existing EVM chain:
  [the fhEVM coprocessor](https://www.zama.org/post/fhevm-coprocessor) and the
  [protocol litepaper](https://docs.zama.org/protocol/zama-protocol-litepaper)
  for the decryption committee.
- Decrypting inside an enclave without releasing the key:
  [decryptAndCombine](https://developer.litprotocol.com/sdk/serverless-signing/combining-decryption-shares),
  the [Lit Actions SDK](https://actions-docs.litprotocol.com/), and
  [wrapped keys](https://developer.litprotocol.com/user-wallets/wrapped-keys/exporting-wrapped-key),
  which is the mechanism for a key that is generated where it will be used and
  never exists anywhere else.
- Secure aggregation, the mask-cancelling approach that needs no key at all and
  founders on dropouts:
  [information-theoretic secure aggregation with user dropouts](https://arxiv.org/pdf/2101.07750).

### Why Self Pass and not Self Enterprise

Self marks the open-source SDK we use (`@selfxyz/core`) as legacy and points new
integrations at Self Enterprise (`@selfxyz/enterprise-sdk`). We stay on the
open-source one deliberately. The legacy docs are explicit that they remain for
existing integrations, and no end-of-life date has been announced.

Enterprise is a managed service, and every one of these is on its own enough to
rule it out here:

- **Rules live in a dashboard flow, one active per workspace.** A flow is
  immutable once deployed and carries the predicate config (`minimumAge`,
  `excludedCountries`, `ofac`). Votain builds that config per election, at run
  time, from what the organizer chose in the wizard. The one workspace that
  allows several active flows at once, Custom Config, has no age or country
  predicates at all.
- **There is no API to create a flow.** The SDK exposes `sessions.create`,
  `sessions.get` and webhook verification. Flows are dashboard-only, so an
  election cannot provision its own rules even if the limit above did not exist.
- **It reintroduces the handle the per-election scope exists to avoid.**
  `sessions.create` takes a stable `externalUuid` for the user, stores it in an
  activity log and echoes it on every webhook. Our scope is derived per election
  precisely so no party holds one pseudonym per voter across elections. Moving
  that correlation to a third party does not remove it.
- **On-chain mode is on the wrong chain and needs a voter wallet.** It verifies
  on Celo, not on our deployment chain, and mints a non-transferable SBT into
  the voter's wallet. Voters here hold no address by design, because one would
  link enrolment to ballot. It is also one verification per person per flow,
  where we need a fresh nullifier per election.
- **It bills per verification.**

Worth noting that the replacement is at 0.x while the SDK it replaces is at
1.2.0. Revisit if Self announces an end-of-life date for the open-source
verifier, or if flows become API-creatable with per-session rules.

## Deployment targets

| Component | Solution | Reason |
|-----------|----------|--------|
| Frontend | Fleek IPFS + GitHub CD | Immutable, decentralized, IPFS badge |
| Backend | Phala Network TEE | Signs VCs, requires trusted environment |
| Contracts | Polygon Amoy (testnet) | Free EVM, Semaphore available |
| IPFS tally | Pinata free (1 GB) | Immutable audit trail |
| CI/CD | GitHub Actions (2000 min/month) | Free, automated |
