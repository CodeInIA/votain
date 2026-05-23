# contracts/ — Developer Guide

## Stack

- Solidity 0.8.35
- Hardhat 3.x (`hardhat.config.ts`, `defineConfig`, `plugins` array)
- @nomicfoundation/hardhat-toolbox-mocha-ethers (HH3 toolbox with mocha + ethers)
- ethers v6 (native BigInt, NO BigNumber)
- chai v6 (ESM-only, compatible with HH3)
- @openzeppelin/contracts ^5.6.1
- @semaphore-protocol/contracts ^4.14.2

## Contracts

| Contract | Description |
|----------|-------------|
| ElectionV4.sol | Single election: ERC-2771, Semaphore V4, Paillier vote, coercion resistance via nullifier+nonce |
| ElectionFactory.sol | Deploys ElectionV4, manages MATIC deposit for Paymaster |
| ElectionPaymaster.sol | ERC-4337 Paymaster — sponsors gas for verified voters |
| PlatformRegistry.sol | Identity commitment registry with owner access control |
| mocks/MockVerifier.sol | Fake verifier for local tests — replace with Semaphore official in H5 |

## Commands

```bash
npx hardhat test
npx hardhat compile
npx hardhat run scripts/deploy.ts --network hardhat
npx hardhat run scripts/deploy.ts --network amoy
```

## Config

hardhat.config.ts (ESM TypeScript, HH3 format):
- `defineConfig({ plugins: [hardhatToolboxMochaEthers], ... })`
- Solidity: 0.8.35, profiles: default + production (with optimizer)
- Network amoy: uses AMOY_RPC_URL + PRIVATE_KEY from .env

## Required environment variables

```
AMOY_RPC_URL=https://rpc-amoy.polygon.technology
PRIVATE_KEY=0x...    # deployer key — never commit
```

## Technical debt (see docs/dev/state.md)

- Replace MockVerifier with official Semaphore V4 verifier (H5)
- Add missing functions: cancelElection, closeEnrollmentEarly, closeVotingEarly, publishResults, markVoided (H5)
- Coverage >= 80% with solidity-coverage (H5)
- Deploy + verify on PolygonScan Amoy (H5)
- Lock down ElectionPaymaster.sponsorVote to ERC-4337 EntryPoint + ZeroDev forwarder (H5)
