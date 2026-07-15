# backend/. Developer Guide

## Stack (versions as of 2026-07-15)

- **Node.js** v24+ (ESM)
- **Express** v5.2.1
- **tsx** v4.23. Runs TypeScript directly, no compile step.
- **`@sd-jwt/core`** v0.20. Selective Disclosure JWT (EdDSA signer). Project moved to
  OpenWallet Foundation — `SDJWTConfig`/`JwtPayload` types import from `@sd-jwt/core`
  directly (the old `@sd-jwt/types` package is dead, do not re-add it).
- **`@worldcoin/idkit-core`** v4.2.1. World ID v4 proof verification.
- **TypeScript** 7.0.2 (native compiler)

## Current endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | Server health check |
| GET | `/api/me` | Active session from `voter_vc` cookie |
| POST | `/api/logout` | Clear `voter_vc` cookie |
| POST | `/api/rp-signature` | Sign World ID request with `DEVELOPER_KEY` |
| POST | `/api/verify-human` | Verify World ID v4 proof, issue SD-JWT as httpOnly cookie (7 days) |

## Issuer architecture

```
User → POST /api/rp-signature (sign request)
     → World ID QR / deep link (verify in WLD app)
     → POST /api/verify-human (verify proof + issue VC)
        └── SD-JWT claims: nullifier_hash, verification_level, issued_at
        └── httpOnly cookie "voter_vc" (7 days)
```

## Commands

```bash
npm run dev    # tsx watch src/index.ts (hot-reload)
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
```

## Technical debt (see `docs/dev/state.md`)

- Selective disclosure attributes in SD-JWT: `country`, `ageOver18`, `region` as `_sd` array (H6).
- Status List 2021 endpoint `/credentials/status/:listId` (H6).
- SD-JWT presentation endpoint with `@sd-jwt/present` (H6).
- Tests: World ID v4 verification, replay rejection, SD-JWT round-trip (H6).
- Rate limiting with `express-rate-limit` (H6).
- Deployment on Phala Network TEE (H11).

## Target deployment

**Phala Network free tier** (Intel TDX TEE with on-chain attestation). Private key is generated inside the enclave and never leaves. Plan B: AWS Nitro Enclaves Free Tier 12 months.
