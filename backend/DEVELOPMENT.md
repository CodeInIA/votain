# backend/. Developer Guide

## Stack (versions as of 2026-07-15)

- **Node.js** v24+ (ESM)
- **Express** v5.2.1
- **tsx** v4.23. Runs TypeScript directly, no compile step.
- **`@sd-jwt/core`** v0.20. Selective Disclosure JWT (EdDSA signer). Project moved to
  OpenWallet Foundation — `SDJWTConfig`/`JwtPayload` types import from `@sd-jwt/core`
  directly (the old `@sd-jwt/types` package is dead, do not re-add it).
- **`@worldcoin/idkit-core`** v4.2.1. World ID v4 proof verification.
- **`ethers`** v6.17. On-chain registrar (PlatformRegistry).
- **`express-rate-limit`** v8. API throttling.
- **TypeScript** 7.0.2 (native compiler)

## Current endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | Server health check |
| GET | `/api/me` | Active session from `voter_vc` cookie |
| POST | `/api/logout` | Clear `voter_vc` cookie |
| POST | `/api/rp-signature` | Sign World ID request with `DEVELOPER_KEY` |
| POST | `/api/verify-human` | Verify World ID proof, issue SD-JWT (selective disclosure + revocation status), register the voter's Semaphore commitment on-chain |
| GET | `/api/credentials/status/:listId` | Status List 2021 revocation credential |
| POST | `/api/credentials/status/:listId/revoke` | Admin-only revocation (Bearer `ADMIN_TOKEN`) |
| GET | `/api/issuer/public-key` | Ed25519 SPKI PEM for verifiers |
| POST | `/api/present` | Verify an SD-JWT presentation (disclosed claims + revocation/expiry) |

Rate limits: global 120/min on `/api`, 10/min on `/api/verify-human`.

## Issuer architecture

```
User → POST /api/rp-signature (sign request)
     → World ID QR / deep link (verify in WLD app)
     → POST /api/verify-human { ...worldIdProof, identityCommitment }
        ├── verify World ID proof
        ├── issue SD-JWT VC (sub=nullifier; _sd: country/ageOver18/region;
        │     credentialStatus → Status List 2021 entry) → httpOnly cookie (7d)
        └── PlatformRegistry.registerMember(nullifier, commitment)  [on-chain]
```

Source layout: `sd/issuer.ts` (shared SD-JWT instance + disclosure frame),
`status/statusList.ts` (gzip bitstring revocation), `chain/registrar.ts` (on-chain registrar),
`routes/{verify,credentials}.ts`.

## Commands

```bash
npm run dev    # tsx watch src/index.ts (hot-reload)
npm test       # node --test (SD-JWT issue→present→verify, Status List) — 5 tests
```

## Required environment variables

```bash
# Copy from .env.example.
ISSUER_PRIVATE_KEY=    # Ed25519 PKCS8 base64. Generate with:
                       # node -e "const {generateKeyPairSync}=require('crypto'); const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'der'}}); console.log(privateKey.toString('base64'))"
WORLD_ID_APP_ID=       # App ID from World ID Developer Portal
DEVELOPER_KEY=         # API key from World ID Developer Portal
WORLD_ID_RP_ID=        # RP ID (same as App ID in staging)
WORLD_ID_ACTION=       # Action name registered in the Developer Portal (e.g. vote-registration)
FRONTEND_URL=          # Allowed origin in production
NODE_ENV=development
PORT=3000
# ── On-chain registrar (H6) ──
CHAIN_RPC_URL=https://rpc-amoy.polygon.technology
REGISTRY_ADDRESS=      # PlatformRegistry address (from deployments/amoy.json)
REGISTRAR_PRIVATE_KEY= # must OWN PlatformRegistry; skipped if unset
ADMIN_TOKEN=           # protects the revocation endpoint
PUBLIC_URL=http://localhost:3000  # base for credentialStatus URLs
```

## Technical debt (see `docs/dev/state.md`)

- Wire World ID Credentials selective disclosure (passport NFC) to replace the demo attribute
  values (`DEMO_VC_*`). Schema is already source-agnostic.
- Deployment on Phala Network TEE (H11): private key generated inside the enclave, `/attestation`
  endpoint, image hash referenced from PlatformRegistry.

## Target deployment

**Phala Network free tier** (Intel TDX TEE with on-chain attestation). Private key is generated inside the enclave and never leaves. Plan B: AWS Nitro Enclaves Free Tier 12 months.
