# contracts/. Developer Guide

## Stack (versions as of 2026-07-15)

- Solidity 0.8.35
- Hardhat 3.9 (`hardhat.config.ts`, `defineConfig`, `plugins` array)
- `@nomicfoundation/hardhat-toolbox-mocha-ethers` 3.0.7 (HH3 toolbox with mocha + ethers)
- ethers v6 (native BigInt, NO BigNumber)
- chai v6 (ESM-only, compatible with HH3)
- TypeScript 7.0.2 (native compiler)
- `@openzeppelin/contracts` ^5.6.1
- `@semaphore-protocol/contracts` ^4.14.3

## Contracts

| Contract | Description |
|----------|-------------|
| ElectionV4.sol | Single election: ERC-2771, Semaphore V4, Paillier vote, coercion resistance via nullifier+nonce |
| ElectionFactory.sol | Deploys ElectionV4, manages MATIC deposit for Paymaster |
| ElectionPaymaster.sol | ERC-4337 Paymaster. Sponsors gas for verified voters |
| PlatformRegistry.sol | Identity commitment registry with owner access control |
| mocks/MockVerifier.sol | Fake verifier for local tests. Replace with official Semaphore in H5 |

## Commands

```bash
npx hardhat test
npx hardhat compile
npx hardhat run scripts/deploy.ts --network hardhat
npx hardhat run scripts/deploy.ts --network amoy
```

## Config

`hardhat.config.ts` (ESM TypeScript, HH3 format):

- `defineConfig({ plugins: [hardhatToolboxMochaEthers], ... })`
- Solidity 0.8.35, profiles `default` and `production` (with optimizer).
- Network `amoy`: uses `AMOY_RPC_URL` and `PRIVATE_KEY` from `.env`.

## Required environment variables

```
AMOY_RPC_URL=https://rpc-amoy.polygon.technology
PRIVATE_KEY=0x...    # deployer key. Never commit.
```

## Technical debt (see `docs/dev/state.md`)

- Replace `MockVerifier` with official Semaphore V4 verifier (H5).
- Add missing functions: `cancelElection`, `closeEnrollmentEarly`, `closeVotingEarly`, `publishResults`, `markVoided` (H5).
- Coverage >= 80% with `solidity-coverage` (H5).
- Deploy and verify on PolygonScan Amoy (H5).
- Lock down `ElectionPaymaster.sponsorVote` to ERC-4337 EntryPoint + ZeroDev forwarder (H5).
