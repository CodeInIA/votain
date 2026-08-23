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
| ElectionV4.sol | Single election. On-chain Semaphore V4 group (LeanIMT/PoseidonT3), `enroll` gated to PlatformRegistry members, `castVote` (bytes Paillier ciphertext) with merkle-root validation + coercion resistance (nullifier+nonce), `VotingType` enum + `thresholdValue`, lifecycle (cancel/closeEarly/void/publishResults with per-type outcome). ERC-2771 meta-tx. |
| ElectionFactory.sol | Deploys ElectionV4 from a `Config` struct, routes MATIC deposit to the paymaster, enumerable `getElections(offset, limit)`. |
| ElectionPaymaster.sol | Gas tank **and relay hub**. `relayEnroll` / `relayVote` call the election and reimburse the caller from `gasBalance[organizerOf[election]]` in the same tx. `depositFor` / `withdraw`; `setFactory` and `setRelayParams` are onlyOwner. |
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

## Commands

```bash
npx hardhat test                    # 66 tests, including the E2E suite
npx hardhat test --coverage         # line coverage report -> coverage/
npx hardhat test test/E2E.test.ts   # full election with REAL Groth16 proofs
npx hardhat compile
npm run deploy:local                # in-process network
npm run deploy:amoy                 # Polygon Amoy (needs .env PRIVATE_KEY)
```

The deploy script writes `deployments/<network>.json` AND mirrors it into
`frontend/src/lib/deployments/` so the frontend client picks up the addresses automatically.

## Config

`hardhat.config.ts` (ESM TypeScript, HH3 format):

- `defineConfig({ plugins: [hardhatToolboxMochaEthers], ... })`
- Solidity 0.8.36, profiles `default` and `production` (with optimizer).
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
