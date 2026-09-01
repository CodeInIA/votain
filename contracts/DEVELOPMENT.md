# contracts/. Developer Guide

## Stack (versions as of 2026-07-15)

- Solidity 0.8.36
- Hardhat 3.9 (`hardhat.config.ts`, `defineConfig`, `plugins` array)
- `@nomicfoundation/hardhat-toolbox-mocha-ethers` 3.0.7 (HH3 toolbox with mocha + ethers)
- ethers v6 (native BigInt, NO BigNumber)
- chai v6 (ESM-only, compatible with HH3)
- TypeScript 7.0.2 (native compiler)
- `@openzeppelin/contracts` ^5.6.1
- `@semaphore-protocol/contracts` ^4.14.3

## Contracts (Phase B, production-ready)

| Contract | Description |
|----------|-------------|
| ElectionV4.sol | Single election. On-chain Semaphore V4 group (LeanIMT/PoseidonT3), `enroll` gated to PlatformRegistry members plus an optional attribute policy (`enrollAttested`), `castVote` (bytes Paillier ciphertext) with merkle-root validation + coercion resistance (nullifier+nonce), `VotingType` enum + `thresholdValue`, lifecycle (cancel/closeEarly/void/publishResults with per-type outcome). ERC-2771 meta-tx. |
| ElectionFactory.sol | Deploys ElectionV4 from a `Config` struct, routes MATIC deposit to the paymaster, enumerable `getElections(offset, limit)`. |
| ElectionPaymaster.sol | Gas tank **and relay hub**. `relayEnroll` / `relayEnrollAttested` / `relayVote` call the election and reimburse the caller from `gasBalance[organizerOf[election]]` in the same tx. `depositFor` / `withdraw`; `setFactory` and `setRelayParams` are onlyOwner. |
| PlatformRegistry.sol | Identity-commitment registry (issuer-owned). Gates enrollment. Binds one World ID nullifier to exactly one active commitment; `rotateMember` is the recovery path and revokes the old commitment atomically. `nullifierOf` resolves a commitment (even a revoked one) back to its human. |
| vendor/SemaphoreVerifierVendor.sol | `SemaphoreVerifierV4`: official Groth16 verifier (production). |
| mocks/MockVerifier.sol | Always-true verifier, unit tests only. |

**External library**: `PoseidonT3` (poseidon-solidity) is linked into ElectionV4/Factory. The
deploy script deploys it deterministically (CREATE2) so it lands at the same address on every chain.

### Why enrollment dedupes by human, not by commitment

`ElectionV4.enroll` resolves the commitment to its World ID nullifier and records
that human in `enrolledHumans`. Deduplicating by commitment alone would let a voter
who rotates mid-election add a second leaf to the tree; each identity produces its
own Semaphore nullifier, so the election would count both ballots with no way to
link them. Multi-device voting is solved off-chain instead, by sealing one identity
under several passkeys (see `frontend/src/lib/identityVault.ts`).

### Attribute eligibility: why enrollment needs a signature

An election may restrict enrollment to voters who prove a minimum age or a
nationality from their passport chip. That proof cannot be checked on chain: it
is anchored on another network, and a contract that went looking for it would
break consensus for the same reason it cannot resolve a DNS record. So the relay
checks the proof off chain and signs an EIP-712 attestation, which the contract
verifies. A signature is the one attestation a contract can check on its own.

Two fields carry it, both immutable and set at creation:

- `eligibilityAttester`. The address whose signature `enrollAttested` accepts.
  `address(0)` means the election is open and behaves exactly as before.
- `eligibilityPolicyHash`. `keccak256` of the canonical policy JSON published
  inside `metadataJson`. Enforcement is off chain, so this is what keeps the
  rules auditable: anyone can recompute it from the metadata and confirm the
  organizer did not move the goalposts after voters enrolled.

The constructor rejects one without the other. An attester with no policy hash
gates enrollment on rules nobody can read; a policy hash with no attester
publishes rules nothing enforces.

**The bypass this closes.** `enroll` was `external` with no access control,
protected only by `registry.verifiedMembers`. Any eligibility check living purely
in the backend would have been decorative: a voter the relay refused could call
`enroll` from their own wallet and land in the tree anyway. A gated election now
reverts `AttestationRequired` on that path.

Attestations carry a deadline and are bound to one election through the EIP-712
domain, so one cannot be replayed into another. Replay within the same election
is stopped by the per-human deduplication that was already there.

The domain separator is built by hand rather than inherited from OpenZeppelin's
`EIP712`. That helper reaches `ShortStrings` and `Bytes`, which use `mcopy` and
need a Cancun target, and retargeting the whole codebase to get a domain
separator would be a deployment decision taken for a formatting convenience.

### The personhood nullifier, and why `enrolledHumans` was not enough

`enrolledHumans` deduplicates on the World ID nullifier. That means one HUMAN
only while sign-in demands an Orb. It no longer does: Orbs were withdrawn from
Spain and World ID's document credential is not issued there yet, so sign-in
accepts whatever a voter has and that nullifier now identifies an ACCOUNT.
Somebody with two of them holds two.

A gated election therefore carries a second nullifier through
`enrollAttested(commitment, personhoodNullifier, deadline, signature)`, recorded
in `usedPersonhoodNullifiers`. It comes from a document read by the voter's own
phone, so one person yields one value however many accounts they hold, and it is
scoped to the election, so it says nothing about that voter anywhere else.

Four properties the contract enforces rather than trusts:

- **Zero is refused.** `MissingPersonhoodNullifier`. Otherwise a relay bug, or a
  relay under pressure, could enroll everyone under "none available".
- **Reuse is refused.** `PersonhoodNullifierUsed`, checked before `_enroll`, so
  a second account belonging to the same person is turned away.
- **The signature covers it.** It is in the EIP-712 typehash, so a relay cannot
  present a different nullifier than the attester approved.
- **It is stored, not merely checked.** The relay has no durable memory, and a
  restart must not reopen a closed door.

### The optimizer now runs in the default profile too

`ElectionFactory` embeds `ElectionV4`'s creation code. Unoptimized it sits past
the 24576-byte Spurious Dragon limit, which the test network enforces, so an
unoptimized build cannot deploy the stack at all. It was already within a few
hundred bytes of that ceiling before `enrollAttested` existed. Building tests the
same way the deployment builds also stops the suite passing on bytecode nobody
will ever run.

## Commands

```bash
npx hardhat test                    # 84 tests, including the E2E suite

# Restricted-election walkthrough against a running local node. Covers every leg
# of the eligibility flow except the Self app reading a passport, which needs a
# phone: creates a gated election, proves plain enroll() is refused, signs an
# attestation the way the backend does, enrolls through the paymaster, and
# checks the rejections (forged signer, expired deadline, swapped commitment,
# second enrollment, unverified voter, attestation on an open election).
ATTESTER_FILE=path/to/attester.json   npx hardhat run scripts/e2e-eligibility.ts --network localhost
npx hardhat test --coverage         # line coverage report -> coverage/
npx hardhat test test/E2E.test.ts   # full election with REAL Groth16 proofs
npx hardhat compile
npm run deploy:local                # in-process network
npm run deploy:amoy                 # Polygon Amoy (needs .env PRIVATE_KEY)
npm run node:local                  # standalone node on 127.0.0.1:8545
npm run seed:local                  # demo data against that node
```

**Seeding moves the chain clock, permanently.** Finished elections have to be created
live, voted on, and only then advanced past their voteEnd so a tally can be published,
and those jumps add up to roughly two days. A chain clock only goes forward, so the node
stays ahead of the wall clock and the create wizard, which validates against
`block.timestamp`, refuses every date an organizer would naturally pick.

Most of that drift is gone. The window of an election that is already closed carries no
information, so those specs are compressed to seconds, and the two live elections that
opened their vote window three days out are compressed the same way. A full seed now lands
roughly an hour ahead of the wall clock rather than a week, with every phase present.

The remaining hour is the floor: the advances step 60 seconds into each window to land
safely inside it, and every transaction mines a block at least a second after its parent,
so enrolling five voters spends five seconds of chain time however fast the machine is.

`SEED_LIVE_ONLY=1` still skips the finished elections entirely, for a clock within minutes
of the wall at the cost of having nothing closed, tallying or cancelled to look at.
`SEED_ONLY` builds only the elections whose name contains one of a comma-separated list,
which is how a new election is added to a chain that is already seeded: the seed is not
idempotent, so running it again produces a second copy of everything, and the alternative
is destroying the chain along with every registration on it.

Resyncing a drifted clock afterwards is impossible: restart the node and redeploy.

```bash
SEED_LIVE_ONLY=1 npm run seed:local                      # bash
$env:SEED_LIVE_ONLY=1; npm run seed:local                # PowerShell
SEED_ONLY="Orb Verified Board" npm run seed:local        # just one election
```

The deploy script writes `deployments/<network>.json` AND mirrors it into
`frontend/src/lib/deployments/` so the frontend client picks up the addresses automatically.

## Input bounds

`ElectionV4` rejects a name under 3 or over 200 BYTES, and a `metadataJson` over 16 KB.
Bytes, not characters: Solidity cannot count code points affordably, so this is a coarse
backstop against the absurd (an empty election, a pasted document that would blow past
the block gas limit) and NOT the meaningful rule. A three-byte floor is one CJK
ideograph and passes here by design; the create wizard applies the character-aware
minimum, where a candidate floor of two exists because CJK personal names commonly have
exactly two characters.

The description and candidates travel inside `metadataJson` and live on chain in full,
which is why the ceiling matters more than the floor.

## Config

`hardhat.config.ts` (ESM TypeScript, HH3 format):

- `defineConfig({ plugins: [hardhatToolboxMochaEthers], ... })`
- Solidity 0.8.36, profiles `default` and `production`, both with the optimizer
  enabled (see "The optimizer now runs in the default profile too" above).
- Network `amoy`: uses `AMOY_RPC_URL` and `PRIVATE_KEY` from `.env`.

## Required environment variables

```
AMOY_RPC_URL=https://polygon-amoy.drpc.org
PRIVATE_KEY=0x...          # deployer key (also PlatformRegistry owner). Never commit.
TRUSTED_FORWARDER=0x...dEaD # burn address, see below
USE_REAL_VERIFIER=true     # optional, use SemaphoreVerifierV4 on a local net too
```

`https://rpc-amoy.polygon.technology` is dead (no DNS record since 2026). Working free
endpoints: `polygon-amoy.drpc.org`, `polygon-amoy-bor-rpc.publicnode.com`,
`polygon-amoy.gateway.tenderly.co`. Deployment sends transactions only, so any of them works
here, but the frontend and the tally need Tenderly (the others cap `eth_getLogs` at 10000
blocks).

### On TRUSTED_FORWARDER

There is no forwarder to point at. Voter calls arrive through `ElectionPaymaster`, and neither
`enroll` nor `castVote` reads `msg.sender` anyway, so `ERC2771Context._msgSender()` only
affects the organizer-only functions, where organizers sign with MetaMask directly. Set it to
`0x000000000000000000000000000000000000dEaD` so `_msgSender()` always equals `msg.sender`.
Leaving it unset makes `deploy.ts` fall back to the deployer address, which would let that key
impersonate any organizer.

## Deployment cost

`scripts/estimate-deploy-cost.ts` replays the `deploy.ts` sequence on the in-process network,
measures the gas of each step and prices it against the live Amoy gas price:

```bash
npm run estimate:amoy
```

At Amoy's 25 to 30 gwei floor the full deploy is ~0.32 to 0.38 POL with the `production`
profile, plus ~0.075 POL per election created. Voter enrollments and ballots come out of the
organizer's gas tank, not the deployer's balance. Fund the deployer with 1 to 1.5 POL to cover
a deploy plus a demo election with margin, and run `npm run estimate:amoy` for a live figure
including the current shortfall.

## Remaining (needs user)

- Live Amoy deploy + PolygonScan verification (needs a funded `PRIVATE_KEY`).
