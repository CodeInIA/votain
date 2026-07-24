/**
 * In-browser tally, run by the organizer from the election screen.
 *
 * Mirrors the pipeline in `scripts-tally/tally-votes.ts`, minus the IPFS
 * pinning: read every VoteCast event, keep only the highest nonce per nullifier
 * (coercion resistance — a coerced ballot is always superseded by a later one),
 * sum the surviving Paillier ciphertexts homomorphically, and decrypt the single
 * aggregate. Individual ballots are never decrypted.
 *
 * The private key is read from local storage on the organizer's device and never
 * leaves it. `scripts-tally` stays in the repo as the auditor-facing path: it
 * recomputes the same result independently and pins the audit trail to IPFS.
 */
import { getElection } from "./contracts";
import { loadElectionPrivateKey } from "./organizer";
import { addCiphertexts, decryptTally, restoreKeyPair, type SerializedKeyPair } from "./paillier";
import { deriveElectionKeys } from "./tallyKey";
import { hasPrfCredential } from "./passkeyPrf";

export interface TallyResult {
  /** Vote counts per option; the LAST entry is the blank vote. */
  counts: number[];
  /** Distinct voters after coercion-resistance dedup. */
  voters: number;
  /** Raw VoteCast events, including superseded re-votes. */
  ballotsCast: number;
  /** True when `voters` is below the election's privacy quorum. */
  quorumMet: boolean;
  privacyQuorum: number;
}

/**
 * Resolves the decryption keypair the same way `computeTally` does — derived
 * from the passkey for `keyNonce` elections, or the stored key otherwise.
 * Returns null when unavailable on this device.
 */
export async function resolveTallyKey(
  address: string,
  keyNonce?: string,
): Promise<SerializedKeyPair | null> {
  return keyNonce ? deriveElectionKeys(keyNonce) : loadElectionPrivateKey(address);
}

/**
 * Best-effort check of whether this device can obtain the decryption key without
 * a passkey prompt-and-fail. Derivable elections carry a public `keyNonce`, so a
 * PRF passkey on this device is enough; legacy random-key elections need the key
 * in local storage. Not a guarantee (the passkey could be a different one), just
 * enough to warn up front instead of failing on the button press.
 */
export function hasTallyKey(address: string, keyNonce?: string): boolean {
  return keyNonce ? hasPrfCredential() : loadElectionPrivateKey(address) !== null;
}

export class MissingTallyKeyError extends Error {
  constructor() {
    super("No decryption key available on this device for this election");
    this.name = "MissingTallyKeyError";
  }
}

/**
 * Computes the tally without publishing it, so the organizer can see the result
 * (and whether the privacy quorum held) before committing it on-chain.
 */
export async function computeTally(address: string): Promise<TallyResult> {
  const election = getElection(address);
  const [numOptionsBn, pkJson, metadataJson] = await Promise.all([
    election.numOptions(),
    election.paillierPublicKey(),
    election.metadataJson(),
  ]);
  const totalSlots = Number(numOptionsBn) + 1; // + blank vote

  let privacyQuorum = 0;
  let keyNonce: string | undefined;
  try {
    const meta = JSON.parse(metadataJson) as { privacyQuorum?: number; keyNonce?: string };
    privacyQuorum = meta.privacyQuorum ?? 0;
    keyNonce = meta.keyNonce;
  } catch { /* no metadata — treat as no quorum, no derivable key */ }

  // Derivable elections: re-derive from the passkey (prompts). Legacy: local key.
  let keys: SerializedKeyPair | null;
  if (keyNonce) {
    keys = await deriveElectionKeys(keyNonce);
  } else {
    keys = loadElectionPrivateKey(address);
  }
  if (!keys) throw new MissingTallyKeyError();

  const { publicKey, privateKey } = restoreKeyPair(keys);
  // The stored key must belong to this election, or the decryption is garbage.
  if ("0x" + publicKey.n.toString(16) !== (JSON.parse(pkJson) as { n: string }).n) {
    throw new Error("The stored key does not match this election's public key");
  }

  const events = await election.queryFilter(election.filters.VoteCast());

  // Coercion resistance: only the highest nonce per nullifier survives.
  const latest = new Map<string, { ciphertext: string; nonce: bigint }>();
  for (const e of events) {
    const args = (e as unknown as {
      args: { nullifier: bigint; voteCiphertext: string; nonce: bigint };
    }).args;
    const key = args.nullifier.toString();
    const existing = latest.get(key);
    if (!existing || args.nonce > existing.nonce) {
      latest.set(key, { ciphertext: args.voteCiphertext, nonce: args.nonce });
    }
  }

  const finalVotes = [...latest.values()];
  const quorumMet = finalVotes.length >= privacyQuorum;

  // With no votes there is nothing to add — report an all-zero tally rather than
  // letting addCiphertexts throw on an empty list.
  const counts = finalVotes.length === 0
    ? Array.from({ length: totalSlots }, () => 0)
    : decryptTally(
        { publicKey, privateKey },
        addCiphertexts(publicKey, finalVotes.map(v => v.ciphertext)),
        totalSlots,
      ).map(Number);

  return {
    counts,
    voters: finalVotes.length,
    ballotsCast: events.length,
    quorumMet,
    privacyQuorum,
  };
}
