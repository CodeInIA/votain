/**
 * Semaphore V4 identity + membership-proof helpers.
 *
 * Identity storage strategy (most secure first):
 *   1. PRF passkey  — the secret scalar is derived on demand from a WebAuthn PRF
 *      secret sealed in the authenticator. NOTHING sensitive is stored at rest,
 *      so XSS cannot exfiltrate the voting key. The derived Identity is cached in
 *      memory for the session only.
 *   2. localStorage fallback — used only when the browser/authenticator has no
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
import { solidityPackedKeccak256, keccak256, zeroPadValue, toBeHex, hexlify } from "ethers";
import { getElection } from "./contracts";
import { derivePrfSecret, hasPrfCredential, clearPrfCredential } from "./passkeyPrf";

const IDENTITY_STORAGE_KEY = "votain_semaphore_identity"; // fallback only (secret)
const IDENTITY_MODE_KEY = "votain_identity_mode"; // "prf" | "local"
// The PUBLIC identity commitment — safe to persist (it is already on-chain in the
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
 * identity. May prompt for a passkey — call from a user gesture.
 */
export async function getOrCreateIdentity(): Promise<Identity> {
  if (cachedIdentity) return cachedIdentity;

  // A pre-existing fallback identity must keep being used: its commitment is
  // already registered on-chain, switching to PRF would orphan it.
  if (localStorage.getItem(IDENTITY_MODE_KEY) === "local") {
    const stored = localStorage.getItem(IDENTITY_STORAGE_KEY);
    if (stored) return remember(Identity.import(stored));
  }

  // Preferred: derive deterministically from the passkey PRF secret.
  const prfSecret = await derivePrfSecret();
  if (prfSecret) {
    // Semaphore's Identity accepts a private-key seed; the PRF secret is stable.
    localStorage.setItem(IDENTITY_MODE_KEY, "prf");
    // Ensure no stale plaintext secret lingers from a previous fallback run.
    localStorage.removeItem(IDENTITY_STORAGE_KEY);
    return remember(new Identity(hexlify(prfSecret)));
  }

  // Fallback: persisted random identity (XSS-exposed — no PRF on this device).
  console.warn(
    "WebAuthn PRF unavailable — storing the Semaphore identity in localStorage (less secure).",
  );
  const stored = localStorage.getItem(IDENTITY_STORAGE_KEY);
  const id = stored ? Identity.import(stored) : new Identity();
  if (!stored) localStorage.setItem(IDENTITY_STORAGE_KEY, id.export());
  localStorage.setItem(IDENTITY_MODE_KEY, "local");
  return remember(id);
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

// Per-election vote nullifier (PUBLIC — emitted in VoteCast). Remembered on this
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
 * re-derives it (an explicit passkey tap) — by design, nothing is stored at rest.
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
  const events = await election.queryFilter(election.filters.MemberEnrolled());
  // Events arrive ordered by (blockNumber, logIndex) == insertion order.
  const members = events.map(e =>
    BigInt((e as unknown as { args: { identityCommitment: bigint } }).args.identityCommitment),
  );
  return new Group(members);
}

// ────────────────────────────────────────────────
// Vote proof
// ────────────────────────────────────────────────

/** keccak256(ciphertext ‖ nonce) — must mirror ElectionV4.castVote exactly. */
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
