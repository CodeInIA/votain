# Votain Phase 1: Smart Contracts

This directory contains the foundational smart contracts for the Votain E2E Voting System. The architecture revolves around providing maximum anonymity (Zero-Knowledge Proofs), protecting voters against bribery (Coercion Resistance), and abstracting EVM complexities from the final user (Gasless Transactions).

## Core Contracts

1. **`ElectionV4.sol`**
   The core voting instance. Validates Semaphore V4 zero-knowledge proofs (`verifier.verifyProof`). Uses an incrementing nonce mapped over the `nullifier` to allow voters to overwrite their vote secretly, proving robust coercion resistance.
   
2. **`ElectionFactory.sol`**
   A factory utilizing the Factory Pattern to deploy standalone `ElectionV4` instances. Integrates native value routes to directly fund the `ElectionPaymaster` when an organizer provisions an election.

3. **`ElectionPaymaster.sol`**
   Implements a custom paymaster accounting logic for Account Abstraction. Holds gas balances for specific organizers, allowing them to sponsor the network fees for their registered voters via Meta-Transactions / Biconomy Forwarders.

4. **`PlatformRegistry.sol`**
   The global registry avoiding Sybil attacks. Separately stores `registeredNullifiers` (e.g., real-world identities like World ID) and `verifiedMembers` (cryptographic identities like Semaphore Commitments), decoupling biometric proofs from network addresses.

## Known Limitations (Phase 1)

- **Paymaster Access Control:** The `sponsorVote` function inside `ElectionPaymaster.sol` currently lacks strict `msg.sender` checking (as noted in its comments). In a production environment (or Phase 3), it must be restricted to be only callable by the official ERC-4337 EntryPoint or the Biconomy Trusted Forwarder to prevent malicious actors from maliciously draining an organizer's `gasBalance`.
- **On-chain Factory Registry:** `ElectionFactory.sol` strictly routes deployments and emits the `ElectionCreated` event but does not store an on-chain array or mapping of the deployed addresses. In a production environment, DApps must rely on off-chain indexing (graphs or event parsing) to list elections of an organizer.
- **ERC2771Context usage:** While `ElectionV4` inherits `ERC2771Context` for meta-transactions, `_msgSender()` is not actively evaluated inside `castVote` since authorization is fully handled mathematically by the ZK Proof via the `nullifier`. It's kept structurally ready to decouple sender limits when bridging to Phase 2 and 3 payload wrappers.

## Development Stack

- **Solidity**: `^0.8.34`
- **Framework**: Hardhat v2.22.0
- **Testing**: Chai v4 + Ethers v6 (Forced CommonJS target to resolve ESM cross-compatibility)
- **Tooling**: `@nomicfoundation/hardhat-toolbox`

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Compile Contracts
```bash
npx hardhat compile
```

### 3. Run Test Suite
The test framework includes detailed validation for the Zero-Knowledge structures, temporal block logic, and Paymaster funding.
```bash
npx hardhat test
```

### 4. Local Deployment script
Deploys the `PlatformRegistry`, `ElectionPaymaster`, `MockVerifier` (for local setup), and finally the `ElectionFactory`.
```bash
npx hardhat run scripts/deploy.ts
```
