# Votain Phase 2: ZK Identity and VC Issuer

This directory implements the central "Issuer" for the Votain e-voting system. It bridges real-world identities (via World ID biometric proofs) with cryptographic pseudonyms (Semaphore V4 Identity Commitments), ensuring strict privacy bounds.

## Objective

In an end-to-end verifiable system, the entity validating the proof-of-personhood should not be the same tracing the final vote.
The backend handles the verification of the World ID payload directly with Worldcoin APIs. If valid, it issues a **Selective Disclosure JSON Web Token (SD-JWT)** Verifiable Credential.

The generated SD-JWT wraps the user's `identityCommitment` inside the `sub` claim. 

## Structure

```text
src/
├── env.ts                # Environment variable initializer
├── index.ts              # Express Server entry point
├── routes/verify.ts      # World ID callback and SD-JWT generation via `@sd-jwt/core`
└── utils/keys.ts         # Issuer Keypair management (EdDSA / Ed25519)
```

## Tech Stack
- **Framework:** Node.js + Express
- **Language:** TypeScript
- **Crypto / VC:** `@sd-jwt/core`, `crypto` (Ed25519 implementation)

## Setup and Execution

1. Build dependencies:
```bash
npm install
```

2. Generate an `.env` file (see `.env.example` equivalent, provided inside `src` by default):
```text
PORT=3000
WORLD_ID_APP_ID=app_staging_X
WORLD_ID_ACTION=vote_registration
ISSUER_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
NODE_ENV=development
```

3. Run for dev:
```bash
npm run dev
```

4. Build for prod:
```bash
npm run build
npm start
```