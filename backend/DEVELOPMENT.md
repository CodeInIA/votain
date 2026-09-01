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
| POST | `/api/relay/enroll` | Relay a voter's enrollment (session required). Carries `deadline` + `signature` for a restricted election, which routes it to `relayEnrollAttested` |
| GET | `/api/eligibility/attester` | Address that signs enrollment attestations, and whether the provider is reachable |
| GET | `/api/eligibility/:election` | The attribute policy an election declares, if any |
| POST | `/api/eligibility/:election/session` | Open an attribute challenge (session required) |
| POST | `/api/eligibility/verify` | Callback for the Self relayer. **Unauthenticated on purpose**, see below |
| GET | `/api/eligibility/session/:sessionId` | Poll a challenge (session required) |
| POST | `/api/eligibility/:election/attestation` | Collect the signed attestation for a passed challenge (session required) |
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

### Attribute eligibility (age, nationality)

`eligibility/` holds three layers, and only the innermost knows Self exists.

- `policy.ts`. The `EligibilityPolicy` type, its canonical serialisation and its
  `keccak256`. Provider agnostic. An EUDI Wallet connector would sit beside the
  Self adapter without touching this.
- `self.ts`. Turns a policy into a Self verification request and a Self proof
  back into a pass or fail, through the open-source `@selfxyz/core` verifier. No
  managed service and no third party in the enrollment path.
- `attester.ts`. Signs the EIP-712 attestation the contract verifies.

**What we ask for, and what we refuse to ask for.** Age is always a predicate:
`minimumAge` yields a yes or no and the date of birth stays on the voter's phone.
Nationality is a predicate too when the policy blocks countries, because Self
expresses that natively as an exclusion list. It becomes a reveal only when the
policy names allowed countries, because an exclusion list cannot express an
allowlist and the circuit carries the forbidden list as `uint256[4]`, far too
small for "everyone except Spain". Nothing else is ever requested: not the name,
not the document number, not the gender, not the expiry date. A revealed
nationality is compared against the list and dropped, never stored.

That reveal leaks less than it looks. In an election whose published policy
already says "ESP only", learning that an enrolled voter is Spanish adds nothing
an observer could not read off the policy itself.

**Passport or national identity card.** `ALLOWED_DOCUMENT_IDS` accepts
attestation 1 (biometric passport) and 2 (EU identity card), and Self offers no
per-request document selection: the voter presents whichever they hold. Spain
appears on Self's full-support list, with both Document Signer Certificates and
the Country Signing Certificate Authority covered, so a Spanish DNI is expected
to work alongside the passport. The user-facing copy therefore says "document",
never "passport": telling a Spanish voter to find a passport they may not own,
when the card in their wallet would do, would turn a supported case into an
apparent exclusion.

**Self supplies attributes, not uniqueness.** `ElectionV4.enroll` already
deduplicates by human through the World ID nullifier, so Self's two weak spots
stop mattering here: a dual national's second passport buys no second ballot, and
a borrowed passport is still bound to somebody else's World ID.

**The scope is per election.** The scope is what Self derives its nullifier from.
One app-wide scope would hand this server a stable pseudonym per voter across
every election they verify for. `scopeForElection` derives it from the election
address instead, capped at Self's 25-character limit.

**Sessions live in memory.** A challenge is a round trip through a phone, so
something has to remember between two requests which challenge belonged to whom.
`sessions.ts` keeps that in a `Map` with a 15-minute TTL. This backend has no
database and here that costs nothing: a restart only makes a voter mid-scan scan
again, and persisting it would write a durable record linking a World ID
nullifier to an in-flight passport check.

`/eligibility/verify` is unauthenticated because it has to be: the request comes
from Self's infrastructure after the voter's phone produced the proof, not from
the voter's browser. It cannot obtain an attestation. Only the voter who opened
the session can claim one, holding their own cookie and naming their own
commitment. A submission that does not verify leaves the session untouched, so
learning a session id does not let anyone cancel a scan in progress.

**`SELF_ENDPOINT` must be publicly reachable.** The Self relayer POSTs to it and
the SDK rejects localhost outright, so development needs a tunnel. It is also
baked into the QR the voter scans, so a code generated before the URL changed
carries the old one: regenerate the challenge after touching it.

**The public signals arrive as `publicSignals`.** Confirmed against the official
endpoint reference, which also documents the body as `attestationId`, `proof`,
`publicSignals`, `userContextData`. The route accepts `pubSignals` too, since
Self's own migration note uses that name, and reports a missing field under the
name the sender used rather than our internal one. A rejected body logs the keys
it did carry, never their values.

**The route always answers 200.** That is the documented contract for this
endpoint: the status code says the callback arrived, and the body
(`{ status, result, reason }`) says whether the proof passed. Answering 4xx makes
the relayer read a verdict as a transport failure, so a voter whose document
merely misses the age rule would see a network error instead of the reason.

**Rejections are logged with the SDK's own diagnosis.** `ConfigMismatchError`
names what failed: `InvalidScope` when the proof was built for another election,
`InvalidRoot` when the document is absent from the tree that hub serves (what a
real document verified in mock mode looks like), `InvalidTimestamp` on clock
drift. Flattening those into "proof_invalid" discards the only actionable part.

**The scope is a SEED, and the endpoint is part of it.** Self names the field
`scope`, but the value bound into the proof is Poseidon(seed, endpoint). Changing
`SELF_ENDPOINT`, a fresh development tunnel for instance, therefore changes the
effective scope and invalidates every QR generated before it. A per-election seed
is what keeps nullifiers unlinkable between elections, and it is also why a
verifier is built per election rather than kept as one long-lived instance:
`DefaultConfigStore` is the single-config kind, and each verifier serves exactly
one election's rules. `InMemoryConfigStore` would be the alternative, but it
selects among configs for ONE scope, which is the design this deliberately
avoids.

**`@selfxyz/qrcode` is not a dependency, and the deep link is built here.** That
package is a React wrapper that draws a QR and holds a websocket open. The
drawing is three lines in the frontend with a library it already has, and the
websocket is redundant because Self's relayer posts the proof to this server
directly while the browser polls the session. The link itself comes from the
official `SelfAppBuilder` plus `getUniversalLink` (via `@selfxyz/common`, the
same `utils/appType` subpath `@selfxyz/core` uses), never assembled by hand: a
hand-copied version of those defaults went stale within two releases, missing
`selfDefinedData` and carrying a staging chain id that had changed. Building it
here also runs the builder's validation before a voter sees anything, so a
localhost endpoint or an over-long scope fails with a clear message.

**Two links, because the two ways in end differently.** The session route
returns `universalLink` for the QR and `mobileLink` for the tappable link, and
they differ only in `deeplinkCallback`. A voter scanning the QR is looking at a
desktop while the Self app runs on their phone, so a callback would redirect the
wrong screen and leave the one they are watching untouched. A voter who tapped
the link left Votain on that same device and has no reason to find their way back
by hand.

The return address comes from the browser, because only it knows the origin that
served the page: a LAN address in development, whatever is deployed in
production. `sanitiseCallbackUrl` treats it as untrusted, since it is written
into a payload the Self app navigates to and displays during its countdown. Only
http and https pass, and in production the origin must match `FRONTEND_URL`, so
this endpoint cannot be talked into minting a Self link that sends voters
somewhere else.

**The session id comes from `userContextData`, not from the public signals.**
The obvious-looking slot, `pubSignals[userIdentifierIndex]`, holds a SHA-256 hash
of the whole `userContextData` that the SDK recomputes as an integrity check, not
the identifier. Reading it as one yields a value matching no session. The
identifier sits in `userContextData` itself: 32 bytes of destination chain id,
32 bytes of identifier, then the caller's data. That also keeps circuit indices,
which belong to a circuit version and can move under an SDK upgrade, out of our
code entirely.

**Sign-in takes any credential; elections ask for more.**
`verifyWorldIdProof(payload, minimum)` ranks credentials as `any` < `document` <
`orb` and defaults to `any`. Demanding personhood at the door would lock out
every voter in a country with no Orbs and no document credential yet, so it is
demanded at enrollment instead, where a refusal costs one election rather than
the whole account. Selfie Check ranks at the floor on purpose: World ID documents
it as carrying no one-person-one-account guarantee, so for personhood it is worth
exactly what a device is.

What sign-in no longer establishes is that the account is a person. That comes
from the document nullifier `verifyProof` returns and the contract records; see
`usedPersonhoodNullifiers` in the contracts guide.

**The level a session records is the level that was PROVED.** The verify API
answers "at least one of these verified", so a payload declaring an Orb
credential alongside a real device one earns its 200 from the device proof.
Reading the level off the declaration would record that session as Orb verified
on the strength of an entry nothing checked, which matters now that the level
gates elections: `verifiedLevel` reads the entries the API says succeeded, and
where the API itemises nothing it records the LOWEST declared level. Understating
costs a voter one more verification; overstating hands them an election they were
never entitled to enter. `payloadLevel` still reports the claim, and is only what
the pre-call refusal reads.

**The election's level comes from the chain, never from the caller.**
`effectivePersonhood(policy)` on the policy `readElectionEligibility` returns,
which is refused outright unless it matches the hash published on chain. Only
`orb` needs an answer beyond the Self scan, and that answer is the `personhood`
claim in the voter's own SD-JWT: the session is keyed by the nullifier that
credential was issued against, so the claim is bound to the holder. A proof
presented at enrollment instead would prove only that somebody has an Orb. A
credential issued before the claim existed carries no level and is treated as
unmet, which sends the voter through sign-in again rather than waving them
through.

**Attestation deadlines are measured in CHAIN time.** `ElectionV4` compares the
deadline it is given against `block.timestamp`, so `attestationBaseTime()` takes
the later of this server's clock and the latest block's. Measuring from the wall
clock alone is correct only while the two agree: on a local chain advanced past a
run of finished elections, every attestation was born a week expired and no retry
could produce a valid one. Taking the chain alone would be wrong the other way,
since an idle node's last block can be hours old. The later of the two can only
move the deadline outwards, and on a network minting blocks every few seconds it
picks the wall clock and changes nothing.

**`SELF_MOCK` picks one world or the other.** With `1` the verifier checks the
staging identity trees and only mock documents pass; with `0` it checks
production and only real ones do. Nothing accepts both, and the rejection does
not say which side the mismatch is on. Set it to `0` as soon as a real document
is available.

Both variables are read once at startup through `dotenv`, and `tsx watch` only
follows source files, so editing `.env` alone changes nothing. `npm run dev`
therefore passes `--include .env` and restarts on it.

**The SDK is on `@selfxyz/core@1.2.0-beta.2`, and the floor is not optional.**
Self documents a hard minimum of 1.1.0-beta.1: earlier versions point at Celo
Alfajores for mock documents and will not verify correctly. The newest release
that merely looks stable, 1.0.8, sits below that floor, so "the last non-beta"
was the wrong thing to pin to.

**Git dependencies are allowed, not overridden.** `@selfxyz/common` declares
`node-forge` as `github:remicolin/forge`, and the 1.2.x line reaches a forked
`snarkjs` the same way. npm 12 disables git dependencies by default
(`allow-git=none`), so a plain `npm install` refuses them with `EALLOWGIT`. The
project `.npmrc` sets `allow-git=all`, which installs exactly what Self declared.

The alternative, an `overrides` entry pointing those names back at the registry,
was tried and then removed. It silently swaps a dependency the author
deliberately forked: for `node-forge` that is a guess about why the fork exists,
and for `snarkjs` it would replace the library that verifies the proofs. `root`
is not enough either, because the git dependency is transitive rather than
declared here.

The tradeoff is real: `allow-git=all` relaxes npm's supply-chain protection for
every dependency of this package. It is scoped to this workspace, and it is the
price of using this SDK at all.

**`@selfxyz/core` is the Self Pass SDK, which Self now labels Legacy** and steers
new integrations away from, towards the managed `@selfxyz/enterprise-sdk`. That
is deliberate here: the managed path bills per verification and puts a third
party on the enrollment hot path, which is the opposite of what this project
argues for. Recorded so the deviation is visible rather than accidental.

### The World ID credential level is checked, and it has to be

`auth/worldId.ts` rejects anything below Proof of Human before it spends the API
call, and `verify-human` goes through it rather than keeping its own copy of the
fetch.

The API confirms that a proof is VALID, not that it is the KIND of proof the app
asked for. The frontend requests `orbLegacy`, but the request is the client's to
build, so until this checked, a device-level or selfie proof verified and was
accepted exactly like an Orb.

That is not cosmetic. `ElectionV4.enroll` deduplicates on this nullifier and
treats it as one human; only Proof of Human carries that guarantee. A weaker
credential turns one-person-one-vote into one-account-one-vote with no visible
sign.

Three details worth keeping:

- **The schema id wins over the identifier.** `issuer_schema_id` is a number the
  protocol assigns; the identifier is a label a caller can write. Only 3.0
  proofs, which have no schema id, fall back to matching `orb`.
- **Every response is checked, not the first.** A 200 means "at least one proof
  verified", so a payload mixing an Orb proof with a weaker one would otherwise
  pass on the strength of the one that happened to be looked at.
- **Orb is spelled three ways** across versions: `orb` (3.0), `proof_of_human`
  (4.0), `poh` (authenticator). All three are the same credential.

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
