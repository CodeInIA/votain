# Votain. Technical Glossary

## Cryptography and ZK

**ZKP (Zero-Knowledge Proof)**: cryptographic proof that demonstrates knowledge of a secret without revealing it. In Votain: the voter proves they belong to the election group without revealing their identity.

**Groth16**: ZK proof system used by Semaphore V4. Generates small proofs (~288 bytes) with cheap on-chain verification.

**Identity Commitment**: Poseidon hash of the user's nullifier and secret. This is what gets registered publicly in the Merkle tree of the group; reveals nothing about the user.

**Nullifier**: value derived from the identity secret and the election scope. Detects double voting without revealing identity. In Votain, extended with `nonce` to implement coercion resistance.

**Nonce (coercion resistance)**: per-nullifier counter. Only the vote with the highest `nonce` per nullifier counts in the tally. Allows a coerced user to cast a new vote (nonce+1) that overrides the previous one.

**Scope**: election identifier within Semaphore. Nullifiers are scope-specific. The same user has different nullifiers in different elections.

**Merkle Tree**: data structure used by Semaphore for the set of enrolled voters. The root is public; each voter proves membership without revealing their leaf.

**Paillier Homomorphic Encryption**: partially homomorphic (additive) encryption scheme. Allows summing ciphertexts without decrypting: Enc(a) · Enc(b) = Enc(a+b). Votain encrypts each vote; the tally decrypts the sum.

## Blockchain and Smart Contracts

**ERC-4337 (Account Abstraction)**: Ethereum standard for programmable wallets, giving each user a smart-account address. **Not used in Votain** (dropped 2026-08): one account per voter makes the public `sender` a link between that voter's enrollment and their ballot, which defeats the Semaphore proof. See `ElectionPaymaster.sol`.

**Relaying**: voters do not send their own transactions. They post the call to the issuer's relayer, which submits it through `ElectionPaymaster`. Every voter therefore reaches the chain from the same address, so the sender reveals nothing.

**Paymaster (gas tank)**: `ElectionPaymaster.sol`. Organizers deposit POL; `relayEnroll` / `relayVote` call the election and reimburse whoever relayed, out of that election's organizer's balance, in the same transaction.

**ERC-2771 (Meta-transactions / Trusted Forwarder)**: allows a relay to submit on behalf of a user while preserving the real `msg.sender`. In Votain the forwarder is set to a burn address: voter calls go through `ElectionPaymaster` and neither `enroll` nor `castVote` reads `msg.sender`, so `_msgSender()` only affects organizer-only functions.

**Domain claim (`OrganizerDomains`)**: the badge a voter sees on an election is a DOMAIN, not a checkmark, because a checkmark only means something if you trust whoever granted it while a domain carries its own evidence. Proof runs in two directions and needs both: DNS says the domain names the wallet (a TXT record at `_votain.<domain>` with the value `v=votain1; address=0x...`), and the chain says the wallet claims the domain (`claim`, a transaction from the organizer's own address). Verifying costs no signature; the signature records the claim, and only once DNS already agrees. The contract stores a claim and not a credential, since domain control is whatever DNS answers right now. See `docs/dev/architecture.md`.

**Semaphore V4**: ZK-based anonymity protocol (PSE/Ethereum Foundation). Allows a group of users to make anonymous signals (votes) without revealing who voted. V4 introduces circuit efficiency improvements.

**PolygonScan (Amoy)**: block explorer for Polygon Amoy testnet. Used to verify contracts and transactions publicly.

**Polygon Amoy**: Polygon EVM testnet (ChainID 80002). Replaces Mumbai. Free gas from faucet.

## Identity and Credentials

**World ID**: Worldcoin's proof-of-humanity system. Two levels: `Orb` (ocular biometrics, stronger) and `Device` (device-only). Issues a `nullifier_hash` unique per user and app. Votain accepts any level at sign-in, because Orbs were withdrawn from Spain; see **Personhood level**.

**Personhood level**: how distinct a human an election insists each voter is, stored as `personhood` inside the eligibility policy and therefore covered by the on-chain `eligibilityPolicyHash`. `device` is a World ID account and nothing more; `document` requires a passport or national ID proved through Self, whose per-election nullifier the contract records so one document cannot enroll twice; `orb` requires both. Absent on an election that names attribute rules, where it means `document`. Also stored on chain as an enum in the election's config, so the constructor can refuse a level and an attester that contradict each other: attribute rules below `document` could never be satisfied, and a level above it could never be proved.

**SD-JWT (Selective Disclosure JWT)**: JWT extension where the issuer includes attributes that the holder can selectively disclose. In Votain: the backend issues an SD-JWT with `nullifier_hash`, `verification_level`, etc.

**W3C Verifiable Credential (VC)**: standard for verifiable digital credentials. Votain's backend issues VCs as EdDSA-signed SD-JWTs.

**EdDSA (Ed25519)**: digital signature scheme used by the backend to sign SD-JWTs. Private key generated inside the TEE.

**Status List 2021**: standard for revoking VCs. Compressed bitmap where each bit corresponds to one credential.

## Deployment

**TEE (Trusted Execution Environment)**: isolated and verifiable execution environment (hardware). Phala Network uses Intel TDX. Code inside the TEE cannot be tampered with or inspected by the host.

**Intel TDX (Trust Domain Extensions)**: Intel technology for VM-level TEEs. Generates an `attestation report` signed by Intel that anyone can verify to confirm the software is legitimate.

**Attestation**: hardware-signed report certifying what code is running in the TEE. In Votain: the backend's `/attestation` endpoint returns the TDX report.

**IPFS (InterPlanetary File System)**: distributed, content-addressed file system (CID). In Votain: the frontend is deployed on IPFS (4EVERLAND) at `votain.app`, and tally audit trails are to be pinned on Pinata.

**CID (Content Identifier)**: cryptographic hash of IPFS content. Immutable. If the content changes, the CID changes.

**4EVERLAND**: IPFS deployment platform with CD from GitHub, free tier (6 GB storage, 10 GB transfer a month), custom domains and SSL. Keeps the CID updated on each build. Replaced **Fleek**, which shut its hosting down on 2026-01-31.

**Attestation**: a TEE signing a hash of what it is running, so a third party can check WHICH code answered. Useless on its own unless the image can be traced to source, which is why the image is built in public CI with signed provenance.

**dstack-ingress**: the container that terminates TLS inside the Phala enclave, holding the certificate's private key where the operator cannot read it. Obtains the certificate by DNS-01, which is why it needs a Cloudflare token.

**Pinata**: IPFS pinning service. Free tier 1 GB. Ensures content is not garbage-collected from IPFS nodes.

## Frontend

**Passkey (WebAuthn)**: passwordless authentication standard using device biometrics or PIN. In Votain it is a CONVENIENCE and never a root: it holds a sealed copy of the voter's recovery phrase through the PRF extension, so a registered device votes without typing the words. It can also be required as a second factor on an organizer's tally key. It is not a wallet: voter transactions are relayed, never signed by it.

**Recovery phrase**: twelve words, generated on the voter's device, that the Semaphore identity is a pure function of. The root of the voter's identity: the same words rebuild the same voter anywhere, with no server, no passkey and no platform capability involved. Deliberately not BIP-39, because it is not a wallet and must not be typed into one.

**Identity vault**: the voter's recovery phrase, stored once per passkey, each copy sealed under HKDF-SHA256(WebAuthn PRF) with AES-256-GCM. Lets any of a voter's devices unlock the same identity, so multi-device never means multiple votable identities. The issuer holds only ciphertext.

**WebAuthn PRF**: passkey extension that returns a stable 32-byte secret for a given (credential, salt), never leaving the authenticator. Used to seal the voter's recovery phrase, and optionally to harden an organizer's tally key. Chrome and Firefox on Windows evaluate it at credential creation and refuse to on an assertion, which is why nothing depends on it alone.

**Tally master secret**: the organizer's root for every election key they create, derived from a deterministic EIP-712 signature by their wallet (HKDF-SHA256 over the signature). Stored nowhere, reproducible on any device that can sign. Mixing a passkey into it was built and removed; see "The organizer's passkey, and why there is not one" in `docs/dev/architecture.md`.

**Privacy Quorum**: minimum vote threshold for an election to be valid. If not reached, election enters `Voided` state and results are not revealed (individual privacy protection). Independent from the `VotingType` winner rule.

**Voting Type**: rule the organizer picks at election creation to decide what counts as approval. Votain supports four: `SIMPLE_PLURALITY` (most votes wins, any margin), `ABSOLUTE_MAJORITY` (>50% of eligible voters), `SUPERMAJORITY_TWO_THIRDS` (≥2/3 of eligible voters), and `WITNESS_THRESHOLD` (≥N affirmative votes, fixed absolute number). The cryptographic tally is identical for all four; only the on-chain post-decryption check differs.

**Simple Plurality** (mayoría simple / relativa): voting type where the candidate with the most votes wins, even if the margin is a single vote and no candidate reached an absolute majority. Most common globally, used in UK Parliament constituencies, US Congress districts and many Spanish local elections.

**Witness Threshold**: voting type where approval requires a fixed number N of yes-votes regardless of the total eligible electorate. Enables use cases like civil weddings (N=4 testigos), notarial multi-signature, and cooperative-board approvals.

**World ID Credentials**: Worldcoin feature (separate from Orb proof-of-personhood) where World App reads the NFC chip of a passport or national ID locally, verifies the ICAO 9303 PKI, and generates ZK proofs of requested attributes (ageOver18, nationality, etc.). The dApp receives only yes/no answers. Available for passports from 12 countries as of Feb 2026 (including Spanish passport); Spanish DNI not yet supported.

**EUDI Wallet**: European Union Digital Identity Wallet defined by eIDAS 2.0. Carries citizens' digital identities (national IDs, driver's licences, diplomas) and emits SD-JWT VCs with selective disclosure. Mandatory across EU member states by late 2026 to 2027. Future identity source for Votain.

**Identity Source**: any system that emits an SD-JWT VC compatible with Votain's eligibility schema. Three are planned: World ID Credentials (primary, production-ready), EUDI Wallet (future), and a demo issuer (TFG fallback for users without supported documents).
