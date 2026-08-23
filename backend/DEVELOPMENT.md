# backend/. Developer Guide

## Stack (versions as of 2026-07-15)

- **Node.js** v24+ (ESM)
- **Express** v5.2.1
- **tsx** v4.23. Runs TypeScript directly, no compile step.
- **`@sd-jwt/core`** v0.20. Selective Disclosure JWT (EdDSA signer). Project moved to
  OpenWallet Foundation: `SDJWTConfig`/`JwtPayload` types import from `@sd-jwt/core`
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
| POST | `/api/verify-human` | Verify World ID proof, issue SD-JWT (selective disclosure + revocation status) and set the session cookie |
| GET | `/api/identity/vault` | This voter's wrapped identity secrets, one per passkey |
| POST | `/api/identity/vault` | Register a passkey for the voter's identity; the first entry triggers on-chain registration. 409 if a different commitment already exists |
| DELETE | `/api/identity/vault/:credentialId` | Unlink a passkey. 409 when it is the last one |
| POST | `/api/relay/enroll` | Relay a voter's enrollment (session required) |
| POST | `/api/relay/vote` | Relay a ballot. **Unauthenticated on purpose**, see below |
| GET | `/api/credentials/status/:listId` | Status List 2021 revocation credential |
| POST | `/api/credentials/status/:listId/revoke` | Admin-only revocation (Bearer `ADMIN_TOKEN`) |
| GET | `/api/issuer/public-key` | Ed25519 SPKI PEM for verifiers |
| POST | `/api/present` | Verify an SD-JWT presentation (disclosed claims + revocation/expiry) |

Rate limits: global 120/min on `/api`, 10/min on `/api/verify-human`.

### Relaying

Voters never send their own transaction. A per-voter sending address would appear on both
their `enroll` and their `castVote`, letting anyone link commitment to nullifier and, through
`PlatformRegistry`, back to the human. `chain/relayer.ts` submits everything through
`ElectionPaymaster`, which reimburses the gas from the organizer's tank in the same
transaction, so the relayer only fronts a small float.

`/relay/vote` takes **no session cookie by design**: requiring one would tell this server
which voter cast which ballot, which is precisely the link the system exists to destroy. The
zero-knowledge proof is the authorisation and the contract verifies it. `/relay/enroll` does
require a session, because enrollment is already public and it keeps the endpoint from being
free spam surface.

A compromised relayer can delay or withhold a transaction, never forge one. Relaying is
permissionless at the contract level, so a censored voter can always submit their own.

### Identity vault

A voter has exactly ONE Semaphore identity. Two active identities for one human
would yield two independently countable ballots that no contract could correlate,
so multi-device support means the SAME secret unlockable from each passkey, not a
new identity per device. Each entry holds that secret encrypted under
HKDF-SHA256(passkey PRF) with AES-256-GCM. The PRF output never leaves the
authenticator, so this server holds ciphertext only and cannot compute a voter's
per-election nullifiers. Recovery from a genuinely lost secret is
`PlatformRegistry.rotateMember`, never a second vault commitment.

`verify-human` deliberately no longer takes an `identityCommitment`: the client
must read the vault first (which needs the session cookie this endpoint sets), or a
returning voter would be handed a brand new identity on every device.

## Issuer architecture

```
User → POST /api/rp-signature (sign request)
     → World ID QR / deep link (verify in WLD app)
     → POST /api/verify-human { ...worldIdProof }
        ├── verify World ID proof
        └── issue SD-JWT VC (sub=nullifier; _sd: country/ageOver18/region;
              credentialStatus → Status List 2021 entry) → httpOnly cookie (7d)
     → GET  /api/identity/vault   (unlock the existing identity, or find none)
     → POST /api/identity/vault { credentialId, blob, commitment }
        └── PlatformRegistry.registerMember(nullifier, commitment)  [on-chain]
```

Source layout: `sd/issuer.ts` (shared SD-JWT instance + disclosure frame),
`status/statusList.ts` (gzip bitstring revocation), `chain/registrar.ts` (on-chain registrar),
`chain/relayer.ts` (voter transaction relaying), `auth/session.ts` (cookie signature checks),
`identity/vault.ts` (encrypted per-passkey identity store), `routes/{verify,credentials,identity,relay}.ts`.

## Commands

```bash
npm run dev    # tsx watch src/index.ts (hot-reload)
npm test       # node --test (session, identity vault, SD-JWT, Status List): 17 tests
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
CHAIN_RPC_URL=https://polygon-amoy.drpc.org  # rpc-amoy.polygon.technology is dead
REGISTRY_ADDRESS=      # PlatformRegistry address (from deployments/amoy.json)
REGISTRAR_PRIVATE_KEY= # must OWN PlatformRegistry; skipped if unset
# ── Relayer ──
PAYMASTER_ADDRESS=     # ElectionPaymaster (from deployments/amoy.json)
RELAYER_PRIVATE_KEY=   # hot wallet with a small POL float; no on-chain permission needed
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
