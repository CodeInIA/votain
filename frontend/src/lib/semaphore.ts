/**
 * Semaphore V4 identity + membership-proof helpers.
 *
 * Identity storage strategy (most secure first):
 *   1. PRF passkey: the secret scalar is derived on demand from a WebAuthn PRF
 *      secret sealed in the authenticator. NOTHING sensitive is stored at rest,
 *      so XSS cannot exfiltrate the voting key. The derived Identity is cached in
 *      memory for the session only.
 *   2. localStorage fallback: used only when the browser/authenticator has no
 *      PRF support. The raw secret is stored (XSS-exposed) and clearly marked.
 *
 * The commitment is deterministic per device, so the same identity is obtained at
 * World ID verification time (to register it on-chain) and later at vote time.
 * Proofs are generated against the election's on-chain LeanIMT group.
 */
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import { poseidon2 } from "poseidon-lite/poseidon2";
import { solidityPackedKeccak256, keccak256, zeroPadValue, toBeHex } from "ethers";
import { getElection } from "./contracts";
import { queryLogsFrom } from "./logs";
import {
  assertPrf,
  enrollPrfPasskey,
  hasPrfCredential,
  clearPrfCredential,
  getCachedCredentialId,
  PasskeyAlreadyRegisteredError,
  type PrfAssertion,
} from "./passkeyPrf";
import {
  fetchVault,
  putVaultEntry,
  recoverIdentity,
  unwrapSecret,
  wrapSecret,
  type VaultState,
} from "./identityVault";

const IDENTITY_STORAGE_KEY = "votain_semaphore_identity"; // fallback only (secret)
const IDENTITY_MODE_KEY = "votain_identity_mode"; // "prf" | "local"
// The PUBLIC identity commitment: safe to persist (it is already on-chain in the
// Semaphore group). Lets read-only UI (enrolled/voted status) work in PRF mode
// after a reload without prompting the passkey. Never holds the secret scalar.
const IDENTITY_COMMITMENT_KEY = "votain_identity_commitment";

// The derived identity is kept in memory for the session so we don't prompt the
// passkey on every read. The secret is never persisted in PRF mode.
let cachedIdentity: Identity | null = null;

/** Caches the identity and remembers its public commitment for read-only checks. */
function remember(id: Identity): Identity {
  cachedIdentity = id;
  localStorage.setItem(IDENTITY_COMMITMENT_KEY, id.commitment.toString());
  return id;
}

// ────────────────────────────────────────────────
// Identity lifecycle
// ────────────────────────────────────────────────

/**
 * Returns the voter's Semaphore identity, deriving it from the passkey PRF when
 * available (prompting the authenticator), or falling back to a localStorage
 * identity. May prompt for a passkey: call from a user gesture.
 */
export async function getOrCreateIdentity(): Promise<Identity> {
  if (cachedIdentity) return cachedIdentity;

  // A pre-existing fallback identity must keep being used: its commitment is
  // already registered on-chain, switching to PRF would orphan it.
  if (localStorage.getItem(IDENTITY_MODE_KEY) === "local") {
    const stored = localStorage.getItem(IDENTITY_STORAGE_KEY);
    if (stored) return remember(Identity.import(stored));
  }

  const outcome = await resolveIdentityFromVault();
  if (outcome.status === "resolved") return outcome.identity;

  // The voter HAS an identity but this device could not open it (prompt
  // dismissed, or none of their passkeys reachable here). Falling through would
  // mint a second identity, which the registry would refuse and `enroll` would
  // reject much later with an unrelated error. Fail loudly instead.
  if (outcome.status === "locked") throw new IdentityLockedError();

  // Fallback: persisted random identity (XSS-exposed, no PRF on this device,
  // and therefore no way to share it with the voter's other devices).
  console.warn(
    "WebAuthn PRF unavailable: storing the Semaphore identity in localStorage (less secure, single device).",
  );
  const stored = localStorage.getItem(IDENTITY_STORAGE_KEY);
  const id = stored ? Identity.import(stored) : new Identity();
  if (!stored) localStorage.setItem(IDENTITY_STORAGE_KEY, id.export());
  localStorage.setItem(IDENTITY_MODE_KEY, "local");
  return remember(id);
}

/** The voter has an identity, but this device could not unlock it. */
export class IdentityLockedError extends Error {
  constructor() {
    super(
      "Your voting identity is locked on this device. Approve the passkey prompt, " +
        "or use one of your registered devices to unlock it.",
    );
    this.name = "IdentityLockedError";
  }
}

type VaultOutcome =
  /** Unlocked, or freshly minted for a first-time voter. */
  | { status: "resolved"; identity: Identity }
  /** A vault exists but no passkey here opened it. Must NOT mint a new one. */
  | { status: "locked" }
  /** No session, no vault, or no PRF support: the caller may fall back. */
  | { status: "unavailable" };

/**
 * Resolves the voter's single Semaphore identity through the encrypted vault.
 *
 * Existing voter: unlock the stored secret with any registered passkey. The
 * prompt lists every credential the voter has, so a synced passkey or their
 * phone (over WebAuthn's hybrid/QR transport) both work from a brand new device.
 *
 * New voter: mint the identity here, seal it under this device's passkey and
 * publish the commitment, which is what registers them on-chain.
 *
 * Returns null when this device cannot do PRF at all, so the caller falls back.
 */
async function resolveIdentityFromVault(): Promise<VaultOutcome> {
  let vault: VaultState | null;
  try {
    vault = await fetchVault();
  } catch (error: unknown) {
    console.warn("Identity vault unreachable:", error);
    return { status: "unavailable" };
  }
  // Not signed in yet: no session cookie, so there is nothing to unlock.
  if (!vault) return { status: "unavailable" };

  if (vault.entries.length > 0) {
    const known = vault.entries.map(e => e.credentialId);
    const assertion = await assertPrf(known);
    if (!assertion) return { status: "locked" };

    // Prefer the blob for the credential that answered; fall back to trying the
    // rest, which covers a credential id that changed representation.
    const ordered = [
      ...vault.entries.filter(e => e.credentialId === assertion.credentialId),
      ...vault.entries.filter(e => e.credentialId !== assertion.credentialId),
    ];
    for (const entry of ordered) {
      const secret = await unwrapSecret(assertion.secret, entry.blob);
      if (secret) {
        localStorage.setItem(IDENTITY_MODE_KEY, "prf");
        localStorage.removeItem(IDENTITY_STORAGE_KEY);
        const identity = Identity.import(secret);
        // A passkey that unlocked the vault but has no entry of its own is a
        // device the voter authenticated from remotely: give it local access.
        if (!known.includes(assertion.credentialId)) {
          await addPasskeyToVault(identity, assertion);
        }
        return { status: "resolved", identity: remember(identity) };
      }
    }

    console.warn("A passkey answered but none of the stored blobs opened with it");
    return { status: "locked" };
  }

  // First device for this voter.
  const assertion = await enrollPrfPasskey();
  if (!assertion) return { status: "unavailable" };

  const identity = new Identity();
  await addPasskeyToVault(identity, assertion);
  localStorage.setItem(IDENTITY_MODE_KEY, "prf");
  localStorage.removeItem(IDENTITY_STORAGE_KEY);
  return { status: "resolved", identity: remember(identity) };
}

/** Seals `identity` under one passkey and publishes the entry. */
async function addPasskeyToVault(identity: Identity, assertion: PrfAssertion): Promise<void> {
  const blob = await wrapSecret(assertion.secret, identity.export());
  await putVaultEntry({
    credentialId: assertion.credentialId,
    blob,
    commitment: identity.commitment.toString(),
  });
}

/**
 * Recovery: mint a brand new identity on this device and rebind the voter to it.
 *
 * For the case where every passkey that could open the old identity is gone. The
 * caller must supply a fresh World ID proof; the issuer rotates the on-chain
 * commitment and resets the vault around the new one.
 *
 * The voter comes back able to join elections they had not enrolled in, and
 * permanently unable to re-enter the ones they had. The chain cannot tell
 * whether they already voted there, so refusing is the only safe answer.
 */
export async function recoverWithNewPasskey(
  worldIdProof: unknown,
): Promise<{ commitment: bigint }> {
  const assertion = await enrollPrfPasskey();
  if (!assertion) {
    throw new Error("This device cannot create a PRF-capable passkey");
  }

  const identity = new Identity();
  const blob = await wrapSecret(assertion.secret, identity.export());
  await recoverIdentity({
    credentialId: assertion.credentialId,
    blob,
    commitment: identity.commitment.toString(),
    worldIdProof,
  });

  // Only adopt it locally once the issuer confirmed the rotation.
  localStorage.setItem(IDENTITY_MODE_KEY, "prf");
  localStorage.removeItem(IDENTITY_STORAGE_KEY);
  remember(identity);
  return { commitment: identity.commitment };
}

/**
 * Registers a NEW passkey on this device for the voter's existing identity, so
 * the device can vote on its own afterwards without reaching for another one.
 * Requires the identity to be unlocked already.
 */
export async function enrollThisDevice(): Promise<{
  credentialId: string;
  /** True when the authenticator already held a registered passkey. */
  alreadyRegistered: boolean;
}> {
  const identity = await getOrCreateIdentity();

  // Same machine, different browser is the case this handles. The authenticator
  // is shared (one Windows Hello, one Touch ID) but localStorage is not, so this
  // browser can have no cached credential id while the device is already
  // registered. Minting a second passkey there would add a duplicate vault entry
  // for a single authenticator, and Windows Hello can overwrite the first while
  // doing it, quietly breaking the entry the voter already had.
  const vault = await fetchVault();
  const known = vault?.entries.map(e => e.credentialId) ?? [];
  const cached = getCachedCredentialId();
  if (cached && known.includes(cached)) {
    return { credentialId: cached, alreadyRegistered: true };
  }

  try {
    // Nothing cached to compare against, so hand the ids to the authenticator:
    // it knows what it holds and refuses with InvalidStateError.
    const assertion = await enrollPrfPasskey(known);
    if (!assertion) {
      throw new Error("This device cannot create a PRF-capable passkey");
    }
    await addPasskeyToVault(identity, assertion);
    return { credentialId: assertion.credentialId, alreadyRegistered: false };
  } catch (error: unknown) {
    if (!(error instanceof PasskeyAlreadyRegisteredError)) throw error;

    // The refusal proves a registered passkey is here, but not WHICH one, and
    // this browser has no cached id to show. Assert it: that both identifies the
    // credential and caches its id, so the profile marks the device as this one
    // instead of going on offering to add it.
    const existing = await assertPrf(known);
    if (!existing) throw error;
    return { credentialId: existing.credentialId, alreadyRegistered: true };
  }
}

/**
 * The voter's PUBLIC identity commitment for read-only checks (enrolled / voted),
 * available without a passkey prompt once the identity has been derived at least
 * once on this device. Null if it never has.
 */
export function getStoredCommitment(): bigint | null {
  if (cachedIdentity) return cachedIdentity.commitment;
  const c = localStorage.getItem(IDENTITY_COMMITMENT_KEY);
  return c ? BigInt(c) : null;
}

// Per-election vote nullifier (PUBLIC, emitted in VoteCast). Remembered on this
// device after voting so "already voted" shows without a passkey prompt; the
// truth is still verified on-chain via nullifierNonces.
const VOTE_NULLIFIER_PREFIX = "votain_vote_";

export function rememberVote(electionAddress: string, nullifier: bigint): void {
  localStorage.setItem(VOTE_NULLIFIER_PREFIX + electionAddress.toLowerCase(), nullifier.toString());
}

export function getStoredVoteNullifier(electionAddress: string): bigint | null {
  const v = localStorage.getItem(VOTE_NULLIFIER_PREFIX + electionAddress.toLowerCase());
  return v ? BigInt(v) : null;
}

/**
 * Synchronous best-effort read for informational UI (enrolled status, history).
 * Returns the in-memory identity, or the localStorage one in fallback mode. In
 * PRF mode after a page reload this returns null until `getOrCreateIdentity()`
 * re-derives it (an explicit passkey tap): by design, nothing is stored at rest.
 */
export function getStoredIdentity(): Identity | null {
  if (cachedIdentity) return cachedIdentity;
  if (localStorage.getItem(IDENTITY_MODE_KEY) === "prf") return null;
  const stored = localStorage.getItem(IDENTITY_STORAGE_KEY);
  if (!stored) return null;
  cachedIdentity = Identity.import(stored);
  return cachedIdentity;
}

/** True when the voter's identity is available without a fresh passkey prompt. */
export function isIdentityLoaded(): boolean {
  return getStoredIdentity() !== null;
}

export function clearIdentity(): void {
  cachedIdentity = null;
  localStorage.removeItem(IDENTITY_STORAGE_KEY);
  localStorage.removeItem(IDENTITY_MODE_KEY);
  localStorage.removeItem(IDENTITY_COMMITMENT_KEY);
  // Drop this device's per-election vote records too.
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith(VOTE_NULLIFIER_PREFIX)) localStorage.removeItem(k);
  }
  if (hasPrfCredential()) clearPrfCredential();
}

// ────────────────────────────────────────────────
// Group reconstruction
// ────────────────────────────────────────────────

/** Rebuilds the election's member group from MemberEnrolled events. */
export async function fetchElectionGroup(electionAddress: string): Promise<Group> {
  const election = getElection(electionAddress);
  const events = await queryLogsFrom(election, election.filters.MemberEnrolled());
  // Events arrive ordered by (blockNumber, logIndex) == insertion order.
  const members = events.map(e =>
    BigInt((e as unknown as { args: { identityCommitment: bigint } }).args.identityCommitment),
  );
  return new Group(members);
}

// ────────────────────────────────────────────────
// Vote proof
// ────────────────────────────────────────────────

/** keccak256(ciphertext ‖ nonce): must mirror ElectionV4.castVote exactly. */
export function voteMessage(voteCiphertext: string, nonce: bigint): bigint {
  return BigInt(solidityPackedKeccak256(["bytes", "uint256"], [voteCiphertext, nonce]));
}

/** Semaphore's hash-to-field (keccak256 of a uint256, truncated to the field). */
function hashToField(value: bigint): bigint {
  return BigInt(keccak256(zeroPadValue(toBeHex(value), 32))) >> 8n;
}

/**
 * Computes the Semaphore nullifier for a voter+scope WITHOUT generating a proof.
 * nullifier = Poseidon2(hash(scope), identity.secretScalar). Lets us read the
 * on-chain nonce before doing the expensive proof generation.
 */
export function computeNullifier(identity: Identity, scope: bigint): bigint {
  return poseidon2([hashToField(scope), identity.secretScalar]);
}

export interface VoteProof {
  merkleTreeDepth: bigint;
  merkleTreeRoot: bigint;
  nullifier: bigint;
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
}

/**
 * Generates the Semaphore membership proof for a vote.
 * @param voteCiphertext 0x-hex Paillier ciphertext of the encoded ballot.
 * @param nonce Current nullifierNonce for this voter (re-vote support).
 * @param scope Election scope (external nullifier).
 */
export async function generateVoteProof(
  identity: Identity,
  group: Group,
  voteCiphertext: string,
  nonce: bigint,
  scope: bigint,
): Promise<VoteProof> {
  const message = voteMessage(voteCiphertext, nonce);
  const proof: SemaphoreProof = await generateProof(identity, group, message, scope);

  // points order (packGroth16Proof) is already Solidity calldata order.
  const p = proof.points.map(BigInt);
  return {
    merkleTreeDepth: BigInt(proof.merkleTreeDepth),
    merkleTreeRoot: BigInt(proof.merkleTreeRoot),
    nullifier: BigInt(proof.nullifier),
    pA: [p[0], p[1]],
    pB: [
      [p[2], p[3]],
      [p[4], p[5]],
    ],
    pC: [p[6], p[7]],
  };
}
