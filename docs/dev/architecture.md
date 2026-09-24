# Votain. System Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                            USER                                 │
│  Browser (IPFS gateway / 4EVERLAND CDN)                        │
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
                               │  6. publishResults(+ proof)     │
                               └──────────────────────────────────┘
```

## Full voting flow

```
1. IDENTITY REGISTRATION
   User → World ID App (Orb/Device)
   → Backend: POST /api/verify-human
   → Backend verifies World ID v4 proof (on-chain / off-chain)
   → Backend issues SD-JWT (`__Host-` httpOnly cookie, Secure, SameSite=strict,
     7 days). See "The voter's session" below
   → SD-JWT claims: nullifier_hash, verification_level, issued_at

2. VOTING IDENTITY
   Frontend, on the device
   → a twelve-word recovery phrase is minted; the Semaphore identity is a
     pure function of it, so the same words rebuild the same voter anywhere
   → POST /api/identity/vault {commitment} → PlatformRegistry.registerMember
   → WebAuthn (Passkey) → PRF secret → the phrase sealed under it
     → POST /api/identity/vault {commitment, credentialId, blob}
       → PlatformRegistry.addVaultEntry
   → REGISTRATION AND THE PASSKEY ARE TWO WRITES, on purpose. An
     authenticator that creates a credential and then refuses to evaluate it
     (Windows Hello, measured 2026-09-15) must still leave a registered
     voter, holding their phrase. Welding the two together meant such a voter
     was never on chain at all, and their next device read the empty vault as
     "new" and minted a second identity for one human.
   → the voter never holds an address: transactions go through the
     issuer relayer, because a per-voter address would link their
     enrolment to their ballot on chain

3. ELECTION ENROLLMENT
   Frontend reads SD-JWT cookie
   → Verifies eligibility criteria
   → ElectionV4 adds the already-registered commitment to the Semaphore group
   → `enroll` refuses a commitment PlatformRegistry has not verified, which is
     what step 2 wrote

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
   votes < Privacy Quorum → Voided; else publishResults(cid, tally, invalid, proof).
```

## Module breakdown

### contracts/

| Contract | Purpose |
|----------|---------|
| `ElectionV4.sol` | Single election: Semaphore V4, Paillier, coercion resistance |
| `ElectionFactory.sol` | ElectionV4 deployment, paymaster fund management |
| `ElectionPaymaster.sol` | Relay hub and gas tank: sponsors every enrolment and ballot, with gas reserved per election so it cannot be withdrawn from under the voters |
| `PlatformRegistry.sol` | Identity commitment registry with owner access control, plus two sealed stores it cannot read: the identity vault and each voter's preferences |

### backend/

| Route | Purpose |
|-------|---------|
| `POST /api/verify-human` | Verify World ID proof, issue SD-JWT, register voter on-chain |
| `POST /api/worldid/request` | Open a World ID verification (signs the RP request itself) and name it in an httpOnly cookie |
| `GET /api/worldid/request` | What became of it; `?wait=1` holds for up to 25s |
| `DELETE /api/worldid/request` | Abandon the one in flight |
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

## Who pays for a vote, and who can stop paying

Voters here hold no wallet, by design: an address of their own would tie their
enrolment to their ballot. So every enrolment and every ballot is relayed and
reimbursed out of the organizer's deposit, and a relay nobody can reimburse is
not a delay. The vote does not happen.

That made the deposit a control surface, and for a while it was an unguarded
one. The paymaster held one balance per ORGANIZER and `withdraw` had no
conditions, so an organizer could empty it while their own election was open.
Turnout is public while an election runs, and in plenty of real settings turnout
correlates with the outcome, so that was a shutdown switch in the hands of the
one party with a reason to use it. Ballot secrecy does not help: they do not need
to know who is voting, only how many.

It also made an honest statement to the voter impossible. A balance shared
between elections cannot be reported per election, because two of them would
each claim the same money, and "enough for 300 votes" would be a false statement
made twice.

**Gas is reserved per election.** `reservedFor[election]` holds money committed
to one election, which cannot be withdrawn. Anything attached to
`createElection` lands there, `depositForElection` adds to it, relays spend it
before touching anything else, and `releaseReserve` returns what is left once the
election can no longer take a vote: past `voteEnd`, or at once if it was
cancelled or voided, because neither will ever relay again and holding the money
would punish stopping an election that ought to be stopped.

The organizer's free balance still exists and is still withdrawable. It is spent
when a reserve runs out, which costs nothing and buys liveness, and it breaks no
promise because it was never promised to anyone. That is why the two are reported
apart and never added together: only the first kind is a guarantee.

**One door to the wallet.** Money enters the paymaster at `depositFor` and leaves
at `withdraw`, both on the gas screen, and nowhere else. Everything in between
moves between the two columns of the same tank: `reserveFromBalance` sends some
of the free balance into an election, `releaseReserve` brings the unspent part
back. Creating an election takes both at once, through a second argument on
`createElection`, so funding it from the balance and topping up the difference
from the wallet is one signature: creating first and reserving second would leave
the election unfunded whenever the second transaction was rejected, at the moment
an organizer is most likely to give up.

That symmetry was missing at first, and the gap is worth recording. The release
path existed from the start while nothing could send a balance the other way, so
an organizer holding five and wanting to commit two had to send two more from the
wallet and withdraw two afterwards.

**Only the organizer may fund their own election**, though `depositForElection`
was open to anyone at first, on the reasoning that a third party might want an
election to go ahead. Where the money goes afterwards is what shows that to be
wrong: the leftovers are released to the ORGANIZER, so a stranger funding an
election was making them a gift of everything the voters did not spend, with no
way to ask for it back. Paying for an election is not a donation to the election;
it is taking on the organizer's obligation, and the refund proves it. Someone who
does want to help sends a plain transfer to the organizer's wallet, which leaves
them to decide whether it enters a contract at all.

`deposit` fills the caller's own tank and nobody else's, for the same reason it
took an address before and no longer does: nothing ever called it with somebody
else's, the interface never offered it, and what it did offer was money appearing
in a balance its owner never chose to hold.

**What a ballot costs is measured, not assumed.** Every figure quoted in ballots
used to rest on a constant of 0.03, written once in a source file and a second
time into the deposit hint of all thirteen locales. On the development chain the
real figure is 0.000129, so "about 66 ballots are reserved" was wrong by a factor
of two hundred, and it was wrong in the one place a voter reads it as a promise.
`lib/voteCost.ts` reads it instead: `VoteSponsored` carries the exact
reimbursement, each sample is divided by the gas price of its own transaction to
recover the gas UNITS a ballot takes, and those are repriced at today's rate.
Enrolments are excluded, since the same event covers both kinds of relay and an
enrolment is a fraction of a vote. The median is used rather than the mean, and
the contract's own two ceilings are applied, so an estimate can never promise
more ballots than a relayer would be reimbursed for.

**The voter is told before they commit.** `electionFunding` answers what is
behind one election, and the enrolment screen asks before the voter starts.
Being turned away before enrolling is recoverable, since they can come back when
the organizer has topped up; being enrolled and then unable to vote, possibly on
the last day, is a vote lost. At the ballot itself it warns rather than blocks: a
balance read when the page loaded may have changed, and refusing a vote that
would have gone through is its own kind of failure.

What is NOT solved: an organizer who simply never funds an election, or funds it
too thinly, can still leave voters unable to vote. No contract can make someone
spend money. What the reserve removes is the ability to promise and then take it
back, and what the interface adds is that the voter can see which of the two
they are being offered.

## A power an organizer can give up

Closing enrolment or voting early reads as an ordinary convenience until you
notice what the organizer can see while doing it. `memberCount` and
`distinctVoters` are public and rise in real time, so the roll can be cut off at
the moment it suits and the vote ended at the moment the result does, and neither
leaves any trace of why. Ballot secrecy does not help here: nobody needs to know
who voted, only how many.

`ElectionV4` therefore carries an immutable `fixedSchedule`, chosen once when the
election is created. With it set, `openEnrollmentEarly`, `closeEnrollmentEarly`
and `closeVotingEarly` all revert, and the dates published at creation are the
dates it runs to. Immutable because a flag the organizer could turn off when it
became inconvenient would promise exactly what they can already promise in words,
which is nothing anyone can check.

**Cancelling is a second switch, not part of the first.** It is a weaker lever
than closing early, since it publishes no result and so cannot shape one, but it
is still a veto: an organizer watching the turnout rise against them can deny the
outcome by ending the election rather than losing it. So `cancellable` is its own
immutable flag, on by default, and both of its answers are shown and filterable
exactly like the schedule's. Showing only the promise was tried first, on the
grounds that keeping the power is the ordinary state and a line saying so would
be noise; that is equally true of movable dates, which are shown, so it was an
inconsistency rather than a rule.

Kept apart from `fixedSchedule` rather than folded into it, because coupling them
would price the cheaper promise out of reach. An organizer who wanted fixed dates
would have to surrender their only way out of an election that should not go
ahead, and most would then fix nothing at all: the more valuable promise lost in
order to protect the lesser one. With both given up, an election with a mistake in
its dates runs to the end regardless, which is the point, and the wizard says so
before it is signed.

**All four boundaries move, which was not true at first.** `openEnrollmentEarly`
reaches UPCOMING, `closeEnrollmentEarly` reaches ENROLLING and pulls `voteStart`
with it, `closeVotingEarly` reaches ACTIVE, and PENDING_VOTE, the gap between
enrolment closing and voting opening, could not be reached at all: an election
advertising dates the organizer can shorten could not shorten that one.
`openVotingEarly` closes it.

**`createdAt` is the one date the organizer did not choose.** Every other
timestamp on an election came out of the wizard and can be set to anything the
validation allows, including dates in the past. This one is written by the chain
at deployment, as a third immutable, so nobody can offer a different answer
later. It answers a question none of the scheduled dates can: an election
announced today for next March and one deployed last March that opens tomorrow
are a year apart in age and adjacent in every date a list shows. That makes it
part of the same job the domain badge does, deciding whether to believe the
thing, since "this was created an hour ago" is the most useful fact about a
convincing copy of somebody else's election. It is shown on the cards and in all
three election views, and both ends of a creation range can be filtered on.

**Both answers are shown to the voter**, for both promises, on the card, on the
public preview and on the election itself. Showing only the reassuring one would make its absence
unreadable, since nobody can tell a missing badge from a badge they have never
seen, and keeping the power is a reasonable and common choice that deserves to be
visible rather than hidden. Nothing at all is shown for an election deployed
before the flag existed: it made no promise and declined none.

`openEnrollmentEarly` is the counterpart added at the same time, and the safer of
the pair, since opening only adds a chance to take part while closing takes one
away. Adding it surfaced a reachable bad state: `closeEnrollmentEarly` used to be
callable from UPCOMING, which set `enrollEnd` while `enrollStart` stayed in the
future and pinned the election in UPCOMING for good, with an enrolment window
that had closed before it opened.

## How a list is read

Every screen that shows more than one election used to call one function, which
read every election the platform had ever created: one cheap call for the
addresses, then about eighteen calls per address to turn each one into something
a card could draw. The cost grew with the age of the platform rather than with
what anyone was looking at, and the cap that existed (fifty) was silent, so
election fifty-one simply did not exist for the interface.

Three different questions were being answered with that one function, and they
have three different answers.

**Which elections exist.** Discover, and nothing else. Unbounded by anyone's own
activity, so it is the one list that genuinely has to be paged:
`useElectionPages` reads a page and one page beyond it, keeps the reader's
filters inside the fetch loop so a search that matches nothing further down
still finds it, and offers a "load more" control. Its count says "so far" until
the chain is exhausted, because a figure that looks final and is not is the kind
of number people quote back at you.

**Which elections are mine.** The organizer's dashboard and the member list. The
factory's `ElectionCreated` event indexes the organizer, so their elections can
be asked for by name in one log query rather than found by reading everyone's
and discarding the rest. The set is then read completely, on purpose: the
dashboard adds these up, and a total over the first page is a wrong number that
looks right. What is paged there is only what gets drawn.

**Which elections am I in.** The voter's list and their history. `MemberEnrolled`
indexes the identity commitment, so one topic query across all contracts answers
it. The commitment is public on chain already, so this reveals nothing new. The
addresses that come back are intersected with the factory's own list, because a
topic query names no contract and anything at all can emit an event with that
shape.

Two screens cannot be paged at all, and say so: the receipt verifier searches for
one ballot among every election, and a missing election there produces "not
found", which is what the page says about a forgery. The vote history has the
same problem in reverse, since a ballot in an unread election is a vote the voter
would reasonably believe was lost. Both read digests instead (address, title,
phase, whether results are published), which is three calls per election rather
than eighteen, so staying complete is affordable.

Both log queries fall back to reading the full list if an endpoint refuses them.
A provider that will not answer must not be able to tell an organizer they have
no elections, and the address filter is applied either way.

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

### What enrolment reveals, and what it does not

> This section described the platform before 2026-09-16 and said so in the
> present tense for four days after it stopped being true, while the section
> that fixed it sat four hundred lines below. It was rewritten on 2026-09-20.
> What it used to say, kept because a privacy claim that was once made should
> not simply disappear: a voter had ONE commitment for the whole platform, the
> same value went into every election's tree, and **which elections a voter
> joined was public and linkable across all of them, permanently**.

A voter still has one identity commitment in the registry, bound to their World
ID nullifier (`commitmentOf` in `PlatformRegistry`), and that is what enforces
one identity per human. It is no longer what enrols them. What goes into an
election's tree is derived from the voter's secret AND that election's address
(`lib/electionIdentity`), so it appears in exactly one tree and matches nothing
anywhere else. See `Who joined what, and why the chain no longer says it` for
the mechanism, the authorisation that replaced the registry lookup, and the
measurement: eight commitments across thirty-eight elections became sixty-nine,
each in one.

The ballot was never linkable and still is not. The nullifier in `VoteCast` is
`poseidon2(scope, secret)`, and every election is created with its own random
scope (31 random bytes, `lib/organizer.ts`), so two ballots cast by the same
voter in two elections share nothing, and no ballot can be tied back to the
commitment that enrolled.

The honest summary, which is now shorter than it was: the chain shows that
someone took part in a given election, never what they said, never that two
things they said came from the same person, and no longer that the person who
took part in this one also took part in that one.

The member list draws each commitment as a colour and a pattern rather than as
two hex characters. That was first justified by making an existing property,
the same commitment recurring across an organizer's elections, easy to see
rather than tedious to check. THAT PROPERTY IS GONE, and the drawing is now
simply a legible handle for a 77-digit number: two rows of the same election are
still told apart at a glance, and two rows of different elections no longer have
anything to say to each other. The list is grouped by election for the same
reason, and its search by commitment was removed, since the only question such a
search could answer is the one the derivation exists to refuse.

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
- **It binds a stable handle to the verified person.** `sessions.create` takes a
  stable `externalUuid` for the user, stores it in an activity log and echoes it
  on every webhook. Enrolment here already carries a stable commitment across
  elections (see `What enrolment reveals`), but an anonymous one: no name, no
  document, no wallet. An `externalUuid` would sit in a third party's log beside
  the passport data Self has just read, which is the binding the whole design
  exists to avoid, and the per-election scope cannot undo it.
- **On-chain mode is on the wrong chain and needs a voter wallet.** It verifies
  on Celo, not on our deployment chain, and mints a non-transferable SBT into
  the voter's wallet. Voters here hold no address by design, because one would
  link enrolment to ballot. It is also one verification per person per flow,
  where we need a fresh nullifier per election.
- **It bills per verification.**

Worth noting that the replacement is at 0.x while the SDK it replaces is at
1.2.0. Revisit if Self announces an end-of-life date for the open-source
verifier, or if flows become API-creatable with per-session rules.

## Two roles, two anchors

A voter and an organizer recover their secrets by different means, and that is
not an inconsistency. It follows from one constraint the rest of the design
rests on: **a voter must not have a wallet**, because an address of their own
would tie their enrolment to their ballot on chain. So the two roles have
different material to work with, and the honest answer is different in each.

| | Anchor | Recovered by |
|---|---|---|
| **Voter** | A twelve-word recovery phrase | Typing the words, or a passkey that holds them |
| **Organizer** | A deterministic wallet signature | Signing again, on any device with the wallet |

### Why not the passkey alone

The passkey PRF extension was the only anchor for both roles, and it failed at
the one thing an anchor exists for: being there on the second device. Chrome and
Firefox on Windows return the PRF secret when a credential is CREATED and refuse
to evaluate it on an assertion. Measured directly, outside this codebase, across
seven combinations of residency, allowCredentials and user verification, over
`http://localhost` and over HTTPS, always `NotAllowedError`. It is the
platform: `webauthn.dll` supports hmac-secret at MakeCredential and not at
GetAssertion, which is why both browsers behave the same.

Two explanations were checked and ruled out, because both would have made this
a bug rather than a platform:

- **A credential minted without the extension.** An authenticator refuses to
  evaluate PRF for a credential that was not created with hmac-secret, and this
  codebase has a retry chain that can fall back to creating one without
  extensions. Ruled out by measuring on a credential created seconds earlier
  that HAD returned a PRF secret at creation. The assertion still refused.
- **The user-verification method.** Face, fingerprint and PIN are how the person
  is verified, not what the authenticator can compute. Measured both ways on the
  same machine: with a PIN, and again after enrolling Windows Hello face
  recognition on a new camera. Creation returned a secret and the assertion
  refused, identically. Worth recording because it is the first thing anyone
  suggests trying.
- **A missing update.** Windows Hello gained hmac-secret in the February 2026
  cumulative update, KB5077181, for 25H2 from build 26200.7840. Ruled out on
  26200.9445 with Chrome 153, which is past both that build and the Chrome
  release that turned on PRF-at-creation by default.

The second one is worth stating precisely, because it is the shape of the
problem: creation works, and only creation. The two user verifications Windows
asks for while creating such a credential are the same fact seen from the other
side. It implements hmac-secret (CTAP 2.1), where deriving the secret is a
second operation with its own verification, rather than hmac-secret-mc (FIDO
2.2), which derives it inside the creation in one interaction.

Reports from other machines say assertion-time PRF works there, so the
capability is not merely missing, it is INCONSISTENT. That is the stronger
argument: a design may not rest on something that is present or absent
depending on a cumulative update.

So the passkey is asked for once and then only where it can do its job. A device
that fails the read-back is recorded as such and never prompted again: creating
a credential there costs two verifications and produces a vault entry nothing on
that device can open, which is worse than not offering it at all.

### The voter: a phrase, with the passkey as a shortcut

The identity is a pure function of the phrase, so the same twelve words rebuild
the same voter anywhere, with no server, no network and no platform capability
involved. Where an authenticator can evaluate PRF, the phrase is sealed under it
and nobody ever types anything. Where it cannot, they type it.

This inverts what was there before, where the passkey was the root and the
phrase did not exist, and it removes the failure mode that came with it: a voter
could enrol and then be unable to vote after a page reload, because in PRF mode
the identity is held in memory and nowhere else.

The cost is a voter now has something to keep. For a system meant for people who
do not hold seed phrases that is real friction, and it is the right trade only
because the alternative was losing the vote silently.

### The organizer: the wallet they already need

An organizer cannot act without a wallet: elections are owned by the address and
every lifecycle call is a transaction from it. Deterministic ECDSA (RFC 6979)
makes a signature over a fixed EIP-712 payload reproducible, so it is a secret
that is available wherever they can work at all. Verified against MetaMask:
three signatures of one message, byte identical.

EIP-712 rather than `personal_sign` because a wallet renders typed data as
named fields instead of a wall of text, and the domain separator binds the
derivation to a chain id.

**What this costs, and it is not nothing.** Whoever holds the wallet can now
also decrypt the ballots. Before, a stolen wallet could cancel an election and
publish a false result, both detectable and reversible, but could not read how
anyone voted, which is neither. Two factors became one.

That separation was restorable, and the next section is about why it is not
restored.

### The organizer's passkey, and why there is not one

It was built. An organizer could turn on a setting that mixed a passkey's PRF
output into the derivation, so elections created from then on needed the wallet
AND that passkey to decrypt. A stolen wallet could still cancel an election and
publish a false result, both visible and reversible, but could not read a single
ballot. It was removed before it shipped, and the reasons are worth keeping,
because the feature sounds obviously good until each one is followed through.

**It could never be a second factor for anything else.** Every organizer action
is a transaction that `ElectionV4` gates on `onlyOrganizer`, which is a check
on `msg.sender`. A passkey cannot condition that: whoever holds the wallet
sends the transaction from a script and never sees this application. A passkey
prompt in front of a button would be theatre. The only place it buys anything
real is a derivation the chain does not arbitrate, which is why it ended up on
the tally key and nowhere else, and a second factor that covers exactly one of
an organizer's powers is a strange thing to ask someone to maintain.

**There is no real multi-device.** This is the one that settles it. The PRF is a
function of a specific credential, so a second passkey is a different secret and
opens nothing the first sealed. Where the credential syncs (Google Password
Manager across a person's own Chrome and Android) a second device works; where
it does not (Windows Hello is bound to the machine) the organizer simply cannot
tally, from anywhere else, ever. That is the same wall that removed
`OrganizerVault`, reached from the other side: sharing the secret requires
storing it, and storing it is what the derivation existed to avoid.

**The setting could not be shared either.** It lived in one browser's local
storage, so the same organizer with the same wallet saw it on and off depending
on the device, and created elections under different rules without being told.

**The failure mode is worse than the risk.** Losing access to the passkey leaves
those results encrypted for good, with no attacker involved and no way back: a
cleared password manager, a replaced phone, a reinstalled system. The risk it
covers, someone stealing the wallet and reading ballots, needs an attacker. A
feature whose accidental failure is worse than the attack it prevents, and which
is opt-in so that almost nobody has it when the attack comes, does not earn its
place.

**And the platform never behaved consistently.** Measured across three
combinations in one week: Chrome on Android evaluated PRF on an assertion and
worked; Chrome and Firefox on Windows returned the secret at creation and
refused on assertion; Firefox on Android needed a second, separate gesture
because `credentials.get()` wants transient user activation that the creation
had already spent. Building a guarantee on that is building on sand.

So the tally key comes from the wallet, and only from the wallet. What that
costs is stated above and not hidden: an organizer's wallet decrypts their
ballots. The honest mitigation is the one the rest of the system already
provides, which is that everything else an organizer does is public and
reversible, plus the privacy quorum that stops a result being revealed at all
when there are too few voters to hide among.

### What this removed

`OrganizerVault` existed to store the tally master sealed once per passkey, so
a second passkey could open what the first had sealed. A master that is derived
rather than stored has nothing to seal, so the contract, its tests and the
interface for adding a second passkey are gone rather than left deployed and
unused.


## The voter's session, and what holding it lets somebody do

**The session IS the credential.** There is no session table and no session id:
the SD-JWT issued after World ID verification is itself what the browser sends
back, and `verifySession` checks its Ed25519 signature before trusting a single
claim in it. Decoding is not authentication, and the trap is worth naming: a
JWT is three base64url segments, so `header.{"sub":"<anybody>","exp":<future>}.
garbage` is trivial to write, and since the vault path registers the resulting
commitment in `PlatformRegistry`, accepting one would let an attacker mint
identities and end the Sybil resistance outright.

**No server state, for the same reason as everything else here.** The issuer has
no database. The identity vault and the preferences blob live on chain for that
reason, and a session store would be the one stateful component in the system,
bought in exchange for something the status list already provides.

**How it is carried.**

| Attribute | Why |
|---|---|
| `httpOnly` | Script cannot read it, so an XSS cannot carry the session off the machine |
| `Secure`, in development too | The development tunnel is HTTPS, so the deployed path is the one exercised daily rather than a production-only branch nobody runs until launch. `COOKIE_INSECURE=1` covers plain HTTP |
| `SameSite=strict` | No cross-site request carries it, so there is no CSRF to defend against and no token to manage. Free here because the frontend and the backend share a domain |
| `__Host-` prefix | The browser refuses to store the cookie unless it is `Secure`, `Path=/` and carries no `Domain`, and those three are what stop a sibling subdomain writing a session for the parent domain. With one domain serving both halves, that was the vector left |
| 7 days | Long enough not to be a re-verification treadmill, and bounded by revocation below |

The name and attributes live in `backend/src/auth/cookie.ts`, which also clears
them: a `clearCookie` whose attributes do not match the ones it was set with
leaves the cookie in place, which is the classic way a "sign out" leaves
somebody signed in.

**It is revocable, which a stateless JWT usually is not.** Each human gets a
StatusList2021 slot at registration, published in `PlatformRegistry`, and
`verifySession` consults it on every authenticated request. That is what makes
a seven day token defensible: the way to end a session early exists and does
not depend on this server remembering anything.

Two questions, two reads, and conflating them was a scaling bug worth recording:
publishing the credential needs every bit of the list, a session check needs
one. Both went through the whole-list read, which asks the chain once per
registered human, so a platform with sixty nine thousand voters paid sixty nine
thousand calls every time a thirty second cache expired under traffic. The
request path now reads the single slot it is asking about.

**What the cookie actually grants, stated plainly.** Being a platform-verified
human, and nothing else. Somebody holding it can enrol or relay in that voter's
name and fetch their vault and preferences blobs, which are ciphertext they
cannot open. They cannot cast a ballot: that needs the Semaphore secret, which
lives in the browser and in the authenticator and never in a cookie.

### Future work: binding the session to a key

`cnf` is in the credential payload type and is deliberately empty. Filling it
would name the holder's public key, and every sensitive request would carry a
fresh signature over method, path and a nonce, made with a private key that is
non-extractable in the browser or held by the passkey.

**What it would buy.** A stolen cookie stops being a session. A copied browser
profile, a device backup, an extension that reads cookies, a proxy that
terminates TLS, a shared machine: today each of those is seven days of access,
and with binding each is an inert string without a key that never left the
device. It narrows XSS too, though it does not close it: injected script could
still sign while the page is open, but nothing it exfiltrates would be reusable
afterwards.

**Why it is not urgent.** The paragraph above, about what the cookie grants. A
session is not a ballot and not a decryption key, so what a theft yields is
enrolling as somebody and reading ciphertext.

**What it costs.** A signature on every request, nonce and clock-skew handling
on the server, and an answer for the key being lost, which today is simply
verifying again. That is the trade, written down so the decision not to take it
is a decision rather than an oversight.

## Signing in on a phone, where the page does not survive the trip

Both roles sign in by LEAVING. A voter goes to World App to produce a proof; an
organizer goes to their wallet to approve a session. On a phone that means
backgrounding the browser, and a backgrounded tab is something the system is
free to discard. What comes back is not the page that left: it is a cold start
with an empty heap.

That broke both flows in the same way and for the same reason, since the thing being
waited on lived in a JavaScript variable, but the two needed different repairs,
because only one of them had somewhere else to put it.

### The voter: the request moved to the server

The proof request is a live object whose bridge decryption key sits inside the
SDK's WASM instance. `@worldcoin/idkit-core` 4.2.4 exposes no way to rebuild
one: an `IDKitRequest` offers `connectorURI`, `requestId`, `pollOnce`,
`pollUntilCompletion` and `getDebugReport`, and nothing that takes any of those
back. Persisting the id across the reload buys nothing, because the id alone
cannot decrypt the answer. So a verification that had **already succeeded** was
thrown away by the reload, and the voter was shown the sign-in screen again.

It is opened by the backend now (`auth/worldIdBridge.ts`). The browser gets a
connector URI to render and an httpOnly cookie naming the pending verification;
this process holds the live object and polls the bridge itself. A reloaded page
asks `GET /api/worldid/request` and is handed the proof, or the connector URI to
put the QR back, or nothing at all. Three answers, because a page acts
differently on each and collapsing them into a boolean is how somebody
mid-verification gets told to start one.

| Decision | Why |
|---|---|
| httpOnly cookie, not a value the page keeps | The whole problem is that the page does not survive. A cookie does, and the browser resends it without being asked |
| `SameSite=lax`, unlike the session cookie | This one has to survive a cross-site top-level navigation back to this origin, which `strict` withholds on exactly the load that needs it |
| Handed over once, then deleted | The proof is a bearer credential: whoever presents it to `/verify-human` is signed in as that human, so a cookie that leaks afterwards is worth nothing |
| Long polling, 25s holds | A one-second poll for five minutes is 300 requests against a 120/min budget. Holding the connection answers the instant the bridge does, so it is both cheaper and *quicker* than polling |
| Five-minute TTL, in-memory | Matches what the browser used to poll for. A restart forgets everything in flight and a second replica would not see the first one's. Both mean "start again", which is where this was before, and both are why the store would have to move if the backend is ever run as more than one instance |

`WORLD_ID_APP_ID`, `WORLD_ID_RP_ID` and `WORLD_ID_ACTION` are read by the
backend now. The `VITE_WORLD_ID_*` copies are gone: setting them does nothing.
`FRONTEND_URL` gained a second job. It is what the return links are validated
against, and it must be set in production, or no way back is offered at all.

### The organizer: the session was already there, nobody asked

Nothing was lost on this side. WalletConnect persists its session, and
`restoreWalletConnect` hands it straight back. The bug was that the one place
that never asked for it was the page the organizer landed on: the mount effect
in `useOrganizerWallet` read `activeProvider()`, which on a phone is a module
variable a reload had just emptied, found nothing and returned. It resumes
instead, restore-only, so no QR can appear in front of somebody who did not ask
for one, and the sign-in screen finishes a login the wallet had already
approved rather than asking for it twice.

Two guards on that, both found by measuring rather than by reasoning:

- **A remembered address is not a session.** `address` starts from local storage
  so read-only pages can draw themselves before any prompt. Treating that as
  proof of a connection would make the sign-in screen let everybody through.
  `live` is set only where a provider actually answered for an account.
- **Only over WalletConnect.** An extension injects itself into every document,
  so a reload there costs one prompt-free press and nothing was ever lost.
  Auto-finishing for an injected wallet breaks something else: signing out
  clears this app's flags but cannot un-authorise MetaMask, so the screen would
  recognise the still-authorised account and go straight back in, leaving no way
  to reach it at all.

### `return_to`, and what finally made it safe

World App can offer the voter a way back, and now does, from a phone. The field
had been left out for a long time on one argument: coming back that way is a
cold start, and a cold start LOST the verification, so the way back was worse
than the inconvenience it removed. Moving the request to the server is exactly
what retires that argument.

It is worth more than a saved tap. Without it a voter finishes in World App and
is simply left there, and a green tick reads as "done", so they never return to
the browser at all. That is not a lost tap, it is a lost sign-in, and it is the
thing that was actually making people give up.

| Decision | Why |
|---|---|
| Phone only, decided in the browser | A desktop shows a QR that a PHONE scans, so `return_to` would send that phone to this page: a second copy of the app on the wrong screen while the real one waits on the desk. Same reasoning as `openWalletApp` |
| The current URL, not the origin | They come back to the screen they left rather than to the front door |
| Validated against `FRONTEND_URL` server-side | World App navigates to this on Votain's behalf. Accepting any URL makes the endpoint an open redirect wearing Votain's name, and the voter has no way to tell |
| Shared with Self's callback | Both are "another app navigates here for us", one rule, one `sanitiseCallbackUrl` in `utils/callbackUrl.ts` |

**Where it lands, stated honestly.** `return_to` is an https address and Android
resolves one as an app link, so a voter with this installed as a PWA is handed
the installed copy. That only differs from where they started for somebody who
has the PWA installed AND is verifying in a browser tab anyway, which is not the normal
case, since a voter has one or the other open, and whichever they started in is
where the link goes. Even then nothing is lost now: a WebAPK shares Chrome's
cookie jar, so the cookie is present and the proof is collected wherever they
land. On iOS a home-screen PWA does not claim https URLs without a native app,
so the link opens Safari, which is where they were.

**Not verified on a real device.** The reasoning above about WebAPK cookie
sharing and iOS app-link behaviour is from documented platform behaviour, not
from a measurement on hardware. The parts that were measured are the resumption
itself and the origin check.

## The organizer's badge is a domain, not a checkmark

A voter looking at an election has to answer a question no cryptography answers
for them: is this the real town hall, or somebody who registered a similar name?
The obvious answer is a verified badge, and it is the wrong one. A checkmark is
an opaque claim that means whatever the party granting it decided it means, and
it only helps if you already trust that party. Ours would be us.

A domain carries its own evidence. `elecciones.gob.es` says what it is, and
`votacion-oficial-gob.com` looks exactly as suspicious as it deserves, where a
checkmark beside that same name would launder it. Anyone can repeat the check.

### Two directions, and neither is enough alone

**DNS says the domain names the wallet.** The organizer publishes a TXT record
at `_votain.<domain>` whose value is `v=votain1; address=0x...`. Publishing it
requires control of the domain, which is the thing being proven.

**The chain says the wallet claims the domain.** `OrganizerDomains.claim` is a
transaction from the organizer's own address, recording which domains to go and
ask about.

Forging one half gets an attacker nothing. Publishing a TXT record that names
somebody else's wallet does not let them sign as that wallet; claiming a domain
they do not control fails the lookup that follows. The contract's own comment
puts it plainly: it stores a claim, not a credential, because domain control is
whatever DNS answers right now and cannot be read off a chain.

### Why the organizer signs, and what does not need a signature

VERIFYING COSTS NO SIGNATURE. `POST /api/organizer/domains` resolves the record
and answers; `addOrganizerDomain` returns early on anything other than
`verified`, so a voter-facing organizer whose DNS has not propagated is told so
without their wallet being touched. The signature happens only after the proof
has already passed, and what it writes is the claim.

It has to be their signature rather than a row our server writes, and that is
the whole point rather than an implementation detail. Our backend can prove a
TXT record exists; only the wallet that owns the elections can state where it
publishes. A server able to write claims could attach any domain to any
organizer, and the badge would rest on trusting us again, which is the thing the
domain was chosen to avoid. It also means an auditor reads a past election's
claim from the chain instead of asking a server what it remembers.

The lookup runs on our backend rather than in the voter's browser, so the
organization's own DNS never learns who is reading their election.

**What it costs**: one transaction per domain, paid by the organizer. Once per
domain, for a badge that needs no trusted issuer, which is a fair price, but it
is not free and the interface should not pretend otherwise.

## Candidate photographs, and what they would cost

A ballot with a face on it is not a decoration. India's voting machines carry
candidate photographs precisely so a voter can recognise who they are choosing,
and for a residents' association or a union a face is how most members know who
is standing at all. `Candidate` has no image field and probably should.

It is not implemented because of where the image would have to live, not because
of the interface work.

**A photograph of a person is personal data, and this chain does not forget.**
The terms already tell organizers that names, descriptions and candidate lists
are public, permanent and uneditable, and ask them to keep third parties'
personal data out of them. A face is a stronger claim on a person than a name,
under the same permanence, and the right to erasure has nowhere to go. The
resolution is the same as for an electoral board roster: the candidate consents
as part of standing, which is a different position from a third party nobody
asked.

**It cannot go in `metadataJson`.** That field is capped at 16000 bytes for the
description, every candidate, the eligibility policy and the tags together. Not
even a thumbnail fits.

**A URL would break the commitment.** This design turns on what was declared at
creation staying declared, which is why `eligibilityPolicyHash` exists. A URL
can be repointed the day after the count, so the picture a voter saw and the
picture the record shows would not have to be the same one.

### The shape it would take

An optional `imageCid` per candidate inside `metadataJson`, which the existing
commitment already covers. The image goes to IPFS and only the content
identifier reaches the chain, about sixty bytes per candidate. Content
addressing is what makes it safe: the CID IS the hash of the image, so it cannot
be swapped for another one, and an unpinned image simply stops loading rather
than turning into something else. IPFS is already how results are published, so
this reuses a decision rather than adding one.

What it would take beyond the schema: an upload path from the browser, which
does not exist today (`PINATA_JWT` is noted as postponed), the create wizard,
the candidate cards, the results view and its chart, alt text for anything a
screen reader has to describe, and the strings in all thirteen locales.

One thing worth deciding rather than discovering: images are a far larger abuse
surface than text on a platform with no moderation, and what lands on IPFS under
a committed CID cannot be taken back.

## Deployment targets

Deployed on 2026-09-21. What is actually running, rather than what was planned:

| Component | Where | Notes |
|-----------|-------|-------|
| Frontend | **4EVERLAND**, IPFS, at `votain.app` | **Fleek shut its hosting down on 2026-01-31** and the plan named it until this deploy. 6 GB and 10 GB of transfer a month, free |
| Backend | **Heroku** container dyno at `api.votain.app` for now; **Phala Cloud** Intel TDX CVM for the verifiable deployment | Two homes on one hostname, see below. Phala is NOT a free tier: $42.34/month plus $2 for 20 GB of disk, against $20 of credit, so it is stopped between sessions. Heroku's Basic dyno is $7/month, covered by the student pack |
| Contracts | Local Hardhat, reached over a named Cloudflare tunnel at `rpc.votain.app` | Amoy deliberately deferred: the whole stack is exercised against a throwaway chain first |
| DNS | Cloudflare, **proxied** | Required by `dstack-ingress` for DNS-01, and what makes the subdomain layout below work. Behind the proxy the API answers `cf-cache-status: DYNAMIC`, so nothing dynamic is cached, and `_redirects` still resolves deep links through the extra hop |
| Image build | GitHub Actions to GHCR, with signed SLSA provenance | See "Why the image is built in CI" |
| IPFS tally | Pinata free (1 GB) | Still the plan; unbuilt, see H9 |

**THE SUBDOMAIN LAYOUT IS NOT COSMETIC.** The session cookie is `__Host-`
prefixed and `SameSite=strict`, so it is sent only on same-SITE requests.
`votain.app` and `api.votain.app` share a registrable domain and therefore are
same-site, and the cookie crosses. Had the backend landed on a different domain,
whether `something.phala.network`, a tunnel address or anything else, there would be **no
voter session at all**, and no amount of CORS would fix it, because CORS and
SameSite answer different questions. Every other choice here can be revisited;
this one is load-bearing.

**Costs, stated plainly.** The frontend is free. The backend is not: $20 of
credit is about two weeks of continuous running, which is why it is stopped
between sessions. Stopping ends the compute charge immediately and leaves the
disk at $2/month; only deleting ends that too.

## Why the image is built in CI, and what that closes

A TEE attestation proves WHICH IMAGE is running. On its own that is half a
guarantee: somebody still has to believe the image corresponds to the source
they read, and an image built on a laptop breaks the chain right there.

Built by `.github/workflows/backend-image.yml`, every link is public:

```
public commit -> public build log -> signed provenance -> image digest
              -> TEE attestation of that digest
```

`actions/attest-build-provenance` signs the middle. Anyone can check it:

```
gh attestation verify oci://ghcr.io/codeinia/votain-backend:0.1.0   --repo CodeInIA/votain
```

which returns the commit, the workflow and the runner that produced the digest,
signed through `token.actions.githubusercontent.com`. Measured on the first
deploy: commit `a8306863` -> `sha256:4621da1a…`, and the CVM's own attestation
reports that same digest.

**THE COMPOSE PINS THE DIGEST, NOT THE TAG,** and that is the part people get
wrong. A tag can be moved to other content, so "the TEE runs 0.1.0" would still
require trusting that 0.1.0 is what it was when it was built. A digest cannot
move. The consequence is deliberate: publishing a new image does NOT update a
running CVM. Updating means editing the compose and redeploying, because the
compose is part of what is measured.

The image must also be PUBLIC. A private one would mean nobody could pull the
digest to check it against the attestation, and the last link would break.

### Two homes on one hostname

`api.votain.app` points at whichever backend is meant to be answering, and the
frontend never knows. That is the whole reason the backend got a subdomain of
its own rather than a hostname belonging to a provider: switching hosts is a
DNS edit, and `VITE_BACKEND_URL` is baked at build time, so anything else would
mean rebuilding the frontend to change where the API lives.

| | Phala | Heroku |
|---|---|---|
| Verifiable | **Yes**: attestation ties the running digest to a public commit | No |
| Cost | $42.34/month running, $2 stopped | $7/month, covered by the student pack |
| TLS | Let's Encrypt, key held inside the enclave | Heroku ACM, key held by Heroku |
| Purpose | The claim the thesis makes | Staying up for free in between |

**The images are not the same artifact**, and the docs should not pretend
otherwise. Heroku's registry rejects OCI manifests, which is exactly what the
GHCR push produces alongside its signed provenance, so the Heroku image is a
second build of the same commit with Docker media types, and its digest
differs. Only the GHCR one carries the attestation.

**Switching back costs two DNS edits, and they are not automatic.** Restoring
`api.votain.app` to Phala means recreating the CNAME and the CAA, whose exact
values live beside the `.env` backup. The CAA is the one that bites in the
other direction too: it restricts issuance to DNS-01 and to the enclave's ACME
account, and **Heroku validates by HTTP-01**, so it has to be removed before
Heroku can get a certificate at all. Otherwise ACM sits at "DNS Verified"
forever without saying why.

**And with the Cloudflare proxy on, Heroku's certificate RENEWAL is at risk.**
HTTP-01 needs to reach the origin on port 80, and the proxy intercepts it. The
certificate already issued is good for 90 days, which covers the window this
deployment is meant to cover, but a long stay on Heroku behind the proxy would
eventually fail quietly. The symptom would be `heroku certs:auto` leaving the
`Cert issued` state.

### `dstack-ingress`, and why not the default gateway

The default gateway serves `<id>.<phala-domain>` and terminates TLS OUTSIDE the
VM: traffic enters the enclave already decrypted, and whoever operates that
layer could read it. `dstack-ingress` obtains a Let's Encrypt certificate by
DNS-01, holds the private key INSIDE the enclave, and publishes evidence of it.
It also writes a CAA record restricting issuance for this name to Let's Encrypt
by DNS-01 and to the enclave's own ACME account, so a second certificate from
anywhere else would be visible in the transparency logs as a violation.

That is the difference between "the issuer runs in a TEE, trust me" and "what
answers on this domain is the TEE, here is the proof".

**It configures DNS only on FIRST provisioning.** Measured, because the guess
went the other way: with the CNAME and CAA deleted and the CVM restarted, five
minutes of polling showed neither recreated. On restart the ingress finds its
certificate in the `cert-data` volume, concludes the work is done, and never
touches Cloudflare. **Anything that repoints `api.votain.app` elsewhere has to
be undone by hand**, and the two records are recorded beside the `.env` backup.

### What survives what

| | Restart | Stop / start | Delete |
|---|---|---|---|
| Certificate (`cert-data` volume) | kept | kept | gone, reissued on recreate |
| DNS records | kept | kept | kept, nothing removes them |
| Sealed secrets | kept | kept | resupplied from the encrypted store |
| In-flight World ID verifications and Self sessions | lost | lost | lost |

The last row is the only state the backend holds, it lives in memory by design,
and losing it costs somebody a retry. Nothing is written to disk: verified by
grep, there is not a single `writeFile` in `backend/src`.

### The trap: contract addresses

Locally the backend reads `contracts/deployments/*.json` and `REGISTRY_ADDRESS`
can stay blank. A container has no `contracts/` beside it, and
`chain/deployments.ts` treats that as normal and falls back to the environment.
So a blank address in a container is not an error. It is a backend calling
addresses that do not exist. They are set explicitly in the compose.

### The trap: binding to loopback

In production the server bound to `127.0.0.1`, which is right behind a reverse
proxy on the same machine. A container's loopback is its own: the process came
up, logged "Server running in PRODUCTION mode", and answered nobody: not the
published port, not `dstack-ingress` next door. `BIND_ADDRESS` exists for this
and the compose sets `0.0.0.0`. Found by running the image locally before
publishing it, which is the entire reason for doing that.

## "Only from our dApp" is not a thing a contract can check

A recurring question about a deployed system: can the contracts be made to
accept calls only from the Votain frontend? No, and it is worth writing down
why, because the answer shapes where the real defences have to live.

A transaction carries a sender, a target, calldata and a signature. It does not
carry an origin: nothing in it says which page, wallet or script produced it,
and there is nothing for a contract to compare against, since the frontend is
public code served from IPFS and the RPC endpoints are public too. Anyone can
replay the same call from a terminal. `tx.origin` does not help either. It names
the externally owned account that started the transaction, not the software that
built it, and using it for authorisation is a documented anti-pattern.

So the question becomes a different one, which does have an answer: **what can
somebody achieve by calling these contracts directly that they could not achieve
through the dApp?** Function by function:

| Entry point | Open to | What stops abuse |
|---|---|---|
| `PlatformRegistry.registerMember` / `rotateMember` / vault writes / `setPreferences` | the platform backend only | `onlyOwner`. A person becomes a member of the platform only through the World ID flow, so an outside caller cannot mint an identity. The two blob stores are written by the same owner and readable by nobody: both hold ciphertext under keys derived from the voter's own secret |
| `ElectionV4.enroll` | anyone | The commitment must already be a registered member, the human behind it must not be enrolled yet, and an election with an attribute policy refuses this path outright (`AttestationRequired`) |
| `ElectionV4.enrollAttested` | anyone holding an attestation | An EIP-712 signature from the election's attester over (commitment, personhood nullifier, deadline), bound to that election and chain. Submitting it is deliberately open, so a voter can pay their own gas or hand it to the relayer |
| `ElectionV4.castVote` | anyone holding a valid proof | A Semaphore membership proof against a current or recently valid root. Deliberately open: requiring our relayer would mean a voter we refuse to relay for cannot vote, which is exactly the power this design exists to remove |
| `ElectionV4` organizer actions | the organizer | `onlyOrganizer`, plus the immutable promises (`fixedSchedule`, `cancellable`) that the contract enforces whatever any frontend says |
| `ElectionPaymaster.relayEnroll` / `relayVote` | anyone | Reimbursement only happens if the underlying call succeeds, so relaying an invalid action costs the caller and pays nothing |
| `ElectionPaymaster.withdraw` / `reserveFromBalance` | the organizer of that election | Ownership checks per election |
| `OrganizerDomains.claim` | anyone | A claim is a statement, not a verification: the badge is drawn only when a DNS TXT record under that domain names the claiming wallet |
| `ElectionFactory.createElection` | **anyone** | Nothing |

That last row is the only door that is genuinely open, and what it opens is not
the integrity of any election: an election created outside the dApp is still
bound by the same contract, still needs platform-verified members to enrol, and
still cannot produce a result its counters do not support. What it affects is
the LIST. `Discover` pages `ElectionFactory.elections`, so anything deployed
through the factory appears in the platform's own feed with whatever title and
description its creator chose.

Closing it is possible and cheap: the factory would take a platform attester,
`createElection` would refuse when one is configured, and a
`createElectionAttested` would take an EIP-712 voucher over (organizer, config
hash, nonce, deadline), exactly as `enrollAttested` already does for enrolment.
The dApp would fetch the voucher for an authenticated organizer and pass it
through; anybody who wants to run an election without us could still deploy
`ElectionV4` themselves, and simply would not be listed by us.

It is not done, because it is a trade rather than a fix: it makes creating a
listed election depend on our backend being up and willing, which is a form of
censorship this project otherwise spends a lot of effort removing. Recorded here
as a decision waiting for an owner rather than as an oversight.

Sources for the impossibility above: [tx.origin, Consensys smart contract best
practices](https://consensysdiligence.github.io/smart-contract-best-practices/development-recommendations/solidity-specific/tx-origin/),
[Use of tx.origin, Smart Contract Security Field Guide](https://scsfg.io/hackers/tx-origin/),
[How to only allow the dapp to call a function, OpenZeppelin
forum](https://forum.openzeppelin.com/t/how-to-only-allow-the-dapp-to-call-a-function/16189).

## Who joined what, and why the chain no longer says it

An anonymous ballot was never the whole promise. Until this change the chain
also published, for anyone who cared to read it, the list of elections each
person had taken part in.

The mechanism was simple enough to miss. A voter holds one Semaphore identity;
`PlatformRegistry` binds its commitment to their World ID nullifier and exposes
`nullifierOf` as a public view; and enrolling put THAT commitment into the
election's merkle tree, in every election they joined. So the same number
appeared in several trees, and the registry named the human behind it. Measured
on the seeded local chain before the fix: one commitment appeared in 17 of the
38 elections, and the registry answered with its World ID nullifier for each.
Nobody could tell how any of those ballots were cast. Everybody could tell who
had shown up, and where.

### What enrolling does now

The commitment that lands in an election's tree is derived from the voter's own
secret and that election's address (`frontend/src/lib/electionIdentity.ts`,
HKDF-SHA256, domain-separated per address). It is theirs, nobody else can
produce it, it is reproducible from the recovery phrase on any device, and it
looks like an unrelated stranger in every other election. The platform identity
appears on chain exactly once, at registration, and never again.

Nothing in the registry vouches for a commitment nobody has ever seen, so the
contract takes a signature instead. `ElectionV4.enrollPrivate` requires an
EIP-712 attestation from a `platformAttester` frozen into the election by the
factory, saying two things and no more: a verified human is behind this
commitment, and they have not already enrolled here. The second half rides on a
`humanTag` derived by the server from the voter's World ID nullifier, the
election's address AND a key only the server holds. The key is what makes it
work: those nullifiers are public, so a plain hash would let anyone recompute
every tag for every election and match the same person across all of them.

The old doors are shut on any election that has this one. `enroll` and
`enrollAttested` revert with `PrivateEnrollmentRequired` when a platform
attester is set, because a human able to use both would hold two leaves and
therefore two votes. Elections deployed before this existed answer zero and keep
the public paths; the frontend reads `platformAttester()` and follows whichever
the election has.

Gated elections keep their organizer's gatekeeper. `enrollPrivate` takes a
second signature and checks it against `eligibilityAttester` whenever the
election named one, over the same digest, so a third-party attester keeps
exactly the say it had. Where the platform is also that attester, which is the
normal deployment, the two signatures are the same bytes.

### What it costs, stated plainly

The platform can link a voter to an enrolment, because it signs both halves.
Nobody else can, where before everybody could.

That is not new trust. The same party owns `PlatformRegistry`, so it could
always register a commitment of its own making and enrol it; what the registry
check bought was never protection from the platform, only from everyone else,
and the signature buys exactly the same thing. What changed is that the link is
no longer PUBLISHED.

### The tag key, and how it is allowed to be forgotten

The tag is `keccak256(tagKey, worldIdNullifier, electionAddress)`, and the whole
privacy of the scheme rests on that key. Two properties of it were wrong until
2026-09-21.

IT WAS THE SIGNING KEY. `tagKey` was an HMAC of
`ELIGIBILITY_ATTESTER_PRIVATE_KEY`, on the argument that one platform secret is
easier to deploy than two and cannot be half-configured. It welded two risks
that are nothing alike. A leaked SIGNING key is bad and bounded: forged
enrolments from that moment, noticed, rotated, and elections created afterwards
name the new attester. A leaked TAG key is retroactive and silent: World ID
nullifiers are public and the tags sit on chain, so it reconstructs who joined
what across every election ever held, and rotating repairs nothing already
published. Welded, the two could not be rotated apart, and rotating to recover
from a forged signature would have changed every tag, so anybody mid-enrolment
would have been handed a second one and the contract would have taken a second
leaf. Recovering from one incident would have caused another.

IT COULD NOT BE FORGOTTEN. Forward secrecy cannot be derived, only thrown away,
and there was one permanent key derived from another. There is now one key per EPOCH,
the UTC month the election was deployed in, and they are independent random
values so that deleting one is final.

The epoch comes from `ElectionV4.createdAt`, which is `immutable`. `enrollEnd`
reads better, since it says when the tag stops being needed, but
`closeEnrollmentEarly` pulls it backwards: the key would change under a live
enrolment, which is the double-leaf bug again.

An election created in epoch E enrols only while its own window is open, and
afterwards nothing recomputes its tags, because the contract already holds the ones it
accepted. So once every election created in E has closed enrolment, E's key can
be deleted, and those enrolments pass beyond the reach of everyone, this
platform included. That is the difference between a secret nobody may leak and
a secret that does not exist. `backend/scripts/mint-tag-key.ts` mints one; the
retirement is an operator deleting a line.

A missing epoch makes the server REFUSE, loudly, rather than fall back to
another key. Substituting would issue a second, different tag for an election
that already has one on chain, which is precisely what the tag exists to stop.

What this does not fix: while an epoch's key is alive, the platform can link
the enrolments of that epoch, and a leak during it exposes them. The TEE (H11)
is where that key should live. The reduction is in blast radius and in time,
not in trust, and the trust was already argued for above.

### Why not the version with no trusted party

The obvious improvement is to remove the signature: keep the platform's members
in their own Semaphore group and have the voter PROVE membership at enrolment,
revealing a per-election nullifier derived from their secret. No server would
know anything. It does not work here, and the reason is worth writing down.

Recovery. A voter who loses their phrase and every passkey is re-issued an
identity by `rotateMember`, which is the only way back. A re-issued identity is
a new secret, so it produces a different nullifier in every election, including
the ones the old identity had already enrolled in. Nothing on chain could
recognise the two as one person, and the human would be able to enrol and vote
a second time wherever they had already voted. Today `nullifierOf` prevents
exactly that, publicly, which is the cost this whole section is about.

Unlinkability, recovery after total loss of the secret, and one-human-one-vote
cannot all hold without some party that keeps the link. The choice is where to
put it. This design puts it in the one party that already decides who becomes a
member, and takes it off the public record.

## Known limits, stated plainly

The pre-Amoy review closed what could be closed in code. These remain, and are
written down so that nobody reads their absence as a guarantee.

- **Re-votes are visible per nullifier.** Only the last ballot counts, and a
  coerced voter can always override later, but `VoteCast` carries the
  nullifier and nonce, so someone who learns a voter's nullifier can see that
  they re-voted (never how). Hiding it needs a MACI-style design where ballots
  are encrypted to a coordinator and keys can be changed silently.
- **Sponsored re-votes wait an hour.** `ElectionPaymaster.REVOTE_COOLDOWN`
  bounds how fast one enrolled voter can spend the organizer's tank. The honest
  override is delayed, never refused, and a voter can still submit a re-vote
  themselves, unsponsored, at any time.
- **The organizer can read individual ballots.** Whoever holds the Paillier key
  can decrypt any ciphertext on chain; the tally proof reveals nothing new, but
  it does not take that away. Threshold decryption would.
- **The issuer sees network metadata.** `/relay/vote` carries no session, but a
  voter reaching it from the same address as their authenticated requests can be
  correlated by an operator who logs addresses. The server does not log them;
  a voter who needs more should reach it over Tor or a VPN.
- **One backend instance.** Rate limits, eligibility sessions and World ID
  requests in flight live in process memory, which is what a single TEE
  deployment is. Running several instances behind a balancer would need that
  state moved to a shared store first.
- **No indexer.** The browser reads events in 10,000-block windows from the
  deployment block, with bounded concurrency. That is fine for a thesis-sized
  deployment and grows with the chain; a public platform would add an indexer
  (a subgraph or the issuer itself) and keep the browser path for auditors.
- **A wallet signature is the organizer's tally key.** Any site that persuades
  an organizer to sign the same typed data obtains it, since EIP-712 cannot
  bind a signature to an origin. Wallets whose signatures are not deterministic
  are detected and given a random, exportable key instead.
