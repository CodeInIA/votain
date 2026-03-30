# Votain: End-to-End Verifiable Voting System

Votain is a next-generation electoral platform designed to provide an end-to-end verifiable, anonymous, and coercion-resistant voting environment. Built as the final degree project (TFG), it integrates advanced cryptography and blockchain tech to ensure absolute transparency and user privacy.

## Project Architecture

The system is being built in multiple phases to ensure robust architecture and scalability:

- **Phase 1: Smart Contracts (Current State)**
  Core blockchain infrastructure deployed on an EVM-compatible network. Includes Zero-Knowledge proof validation (Semaphore V4), coercion resistance mechanics, and gasless voting support via Account Abstraction (ERC-4337). Located in the `contracts/` directory.

- **Phase 2: ZK Identity and VC Issuer (Upcoming)**
  The backend service responsible for issuing Verifiable Credentials (VCs). It will bridge systems like World ID or traditional KYC into a Semaphore identity commitment ensuring strict Sybil-resistance before allowing a user to register to an election.

- **Phase 3: Frontend Application (Upcoming)**
  A React (TypeScript) based client interface where voters can generate their ZK proofs locally, verify their ballots, and submit metadata-stripped cast votes through a relayer network.

## Key Technologies

- **Zero-Knowledge Proofs**: [Semaphore V4](https://semaphore.pse.dev/) for anonymous membership and exact proof-of-vote without revealing identity.
- **Account Abstraction & Meta-Transactions**: [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) and [ERC-2771](https://eips.ethereum.org/EIPS/eip-2771) (Biconomy) for sponsoring voter gas fees.
- **Smart Contracts**: Solidity 0.8.34, Hardhat, Ethers v6, and Chai v4.
- **Sybil Resistance**: Integration blueprints with World ID and custom registry mapping.

## Monorepo Structure

```text
votain/
├── contracts/        # Phase 1: Solidity Smart contracts, tests, and deployment scripts
├── issuer-backend/   # Phase 2: (To be implemented) ZK identity and credentials
└── frontend/         # Phase 3: (To be implemented) Web application
```

## Setup & Execution

For detailed instructions on the smart contract environments, navigate to the `contracts/` directory and observe its specific `README.md`.

```bash
cd contracts
npm install
npx hardhat test
```

## License

MIT
