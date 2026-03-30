# Votain Phase 1: Smart Contracts

This directory contains the foundational smart contracts for the Votain E2E Voting System. The architecture revolves around providing maximum anonymity (Zero-Knowledge Proofs), protecting voters against bribery (Coercion Resistance), and abstracting EVM complexities from the final user (Gasless Transactions).

## Core Contracts

1. **`ElectionV4.sol`**
   The core voting instance. Validates Semaphore V4 zero-knowledge proofs (`verifier.verifyProof`). Uses an incrementing nonce mapped over the `nullifier` to allow voters to overwrite their vote secretly, proving robust coercion resistance.
   
2. **`ElectionFactory.sol`**
   A factory utilizing the Factory Pattern to deploy standalone `ElectionV4` instances. Integrates native value routes to directly fund the `ElectionPaymaster` when an organizer provisions an election.

3. **`ElectionPaymaster.sol`**
   Implements the `IPaymaster` interface (Account Abstraction ERC-4337). Holds gas balances for specific organizers, allowing them to sponsor the network fees for their registered voters via Meta-Transactions / Biconomy Forwarders.

4. **`PlatformRegistry.sol`**
   The global registry avoiding Sybil attacks. Separately stores `registeredNullifiers` (e.g., real-world identities like World ID) and `verifiedMembers` (cryptographic identities like Semaphore Commitments), decoupling biometric proofs from network addresses.

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
