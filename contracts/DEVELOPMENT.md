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

## Contracts (Phase B — production-ready)

| Contract | Description |
|----------|-------------|
| ElectionV4.sol | Single election. On-chain Semaphore V4 group (LeanIMT/PoseidonT3), `enroll` gated to PlatformRegistry members, `castVote` (bytes Paillier ciphertext) with merkle-root validation + coercion resistance (nullifier+nonce), `VotingType` enum + `thresholdValue`, lifecycle (cancel/closeEarly/void/publishResults with per-type outcome). ERC-2771 meta-tx. |
| ElectionFactory.sol | Deploys ElectionV4 from a `Config` struct, routes MATIC deposit to the paymaster, enumerable `getElections(offset, limit)`. |
| ElectionPaymaster.sol | Gas tank. `sponsorVote` locked to configured EntryPoint v0.7 + trusted forwarder (`setSponsors`, onlyOwner); `depositFor` / `withdraw`. |
| PlatformRegistry.sol | Identity-commitment registry (issuer-owned). Gates enrollment. |
| vendor/SemaphoreVerifierVendor.sol | `SemaphoreVerifierV4` — official Groth16 verifier (production). |
| mocks/MockVerifier.sol | Always-true verifier, unit tests only. |

**External library**: `PoseidonT3` (poseidon-solidity) is linked into ElectionV4/Factory. The
deploy script deploys it deterministically (CREATE2) so it lands at the same address on every chain.

## Commands

```bash
npx hardhat test                    # 28 tests
npx hardhat test --coverage         # 94.4% line coverage report → coverage/
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
AMOY_RPC_URL=https://rpc-amoy.polygon.technology
PRIVATE_KEY=0x...          # deployer key (also PlatformRegistry owner). Never commit.
TRUSTED_FORWARDER=0x...    # ZeroDev ERC-2771 forwarder on Amoy (else falls back to deployer)
ENTRYPOINT_ADDRESS=        # optional, defaults to canonical EntryPoint v0.7
USE_REAL_VERIFIER=true     # optional, use SemaphoreVerifierV4 on a local net too
```

## Remaining (needs user)

- Live Amoy deploy + PolygonScan verification (needs a funded `PRIVATE_KEY` and the ZeroDev
  `TRUSTED_FORWARDER`). Everything else is done.
