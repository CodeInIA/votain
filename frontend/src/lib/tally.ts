/**
 * In-browser tally, run by the organizer from the election screen.
 *
 * Mirrors the pipeline in `scripts-tally/tally-votes.ts`, minus the IPFS
 * pinning: read every VoteCast event, keep only the highest nonce per nullifier
 * (coercion resistance, a coerced ballot is always superseded by a later one),
 * and prove the result with `tallyProof.ts`.
 *
 * WHAT THE KEY SEES. To prove the tally, each surviving ballot is decrypted on
 * this device to tell a valid one from garbage or a stuffed one. That is no new
 * power: the ciphertexts are public and whoever holds this key could always
 * decrypt them. What leaves the device is only what the proof needs: the
 * totals, the randomness that opens their sum, and an opening of each ballot
 * excluded as invalid. Nothing about any valid ballot is published.
 *
 * The private key is read from local storage on the organizer's device and never
 * leaves it. `scripts-tally` stays in the repo as the auditor-facing path: it
 * recomputes the same result independently and pins the audit trail to IPFS.
 */
import type { Signer } from "ethers";

import { getElection } from "./contracts";
import { eventArgs, queryLogsFrom } from "./logs";
import { loadElectionPrivateKey, storeElectionPrivateKey } from "./organizer";
import { counterBaseFor, restoreKeyPair, type SerializedKeyPair } from "./paillier";
import { deriveElectionKeys } from "./tallyKey";
import { encodeTallyProof, finalBallots, proveTally } from "./tallyProof";

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
  /** Final ballots excluded because they encrypt no single valid choice. */
  invalidBallots: number;
  /** The encoded decryption proof `publishResults` carries. */
  proof: string;
}

/**
 * Resolves the decryption keypair. A key stored locally, either the fallback
 * random key or one IMPORTED from an exported file, always wins, so a device
 * that cannot reach the organizer's wallet can still tally after importing.
 * Otherwise a `keyNonce` election re-derives it from the wallet signature.
 * Null when unavailable.
 */
export async function resolveTallyKey(
  address: string,
  keyNonce?: string,
  /** Signs the deterministic payload the tally master is derived from. */
  signer?: Signer,
): Promise<SerializedKeyPair | null> {
  const stored = loadElectionPrivateKey(address);
  if (stored) return stored;
  return keyNonce ? deriveElectionKeys(keyNonce, signer) : null;
}

/**
 * Best-effort check of whether this device can obtain the decryption key: an
 * imported or stored key, or a `keyNonce` election, whose key any organizer
 * signed in here can derive, since deriving it needs only their wallet.
 *
 * Not a guarantee, and deliberately not a prompt: enough to warn up front
 * instead of failing on the button press.
 */
export function hasTallyKey(address: string, keyNonce?: string): boolean {
  return Boolean(loadElectionPrivateKey(address)) || Boolean(keyNonce);
}

export class MissingTallyKeyError extends Error {
  constructor() {
    super("No decryption key available on this device for this election");
    this.name = "MissingTallyKeyError";
  }
}

/**
 * Imports a decryption key exported from another device, after validating that
 * it is well-formed AND belongs to this election (matches the on-chain public
 * key). Stored locally so `computeTally` can then use it.
 */
export async function importTallyKey(address: string, fileText: string): Promise<void> {
  let keys: SerializedKeyPair;
  try {
    keys = JSON.parse(fileText) as SerializedKeyPair;
  } catch {
    throw new Error("Not a valid key file (invalid JSON)");
  }
  if (!keys?.publicKey?.n || !keys?.publicKey?.g || !keys?.privateKey?.lambda || !keys?.privateKey?.mu) {
    throw new Error("Not a valid Votain tally key file");
  }
  const pkJson = (await getElection(address).paillierPublicKey()) as string;
  if (keys.publicKey.n !== (JSON.parse(pkJson) as { n: string }).n) {
    throw new Error("This key does not belong to this election");
  }
  storeElectionPrivateKey(address, keys);
}

/**
 * Computes the tally without publishing it, so the organizer can see the result
 * (and whether the privacy quorum held) before committing it on-chain.
 */
// The signer is what reaches the organizer vault, and therefore what lets a
// second passkey derive the same key as the first. Optional so a caller that
// only wants the shape of a tally need not connect a wallet.
export async function computeTally(address: string, signer?: Signer): Promise<TallyResult> {
  const election = getElection(address);
  const [numOptionsBn, pkJson, metadataJson, quorumBn] = await Promise.all([
    election.numOptions(),
    election.paillierPublicKey(),
    election.metadataJson(),
    election.privacyQuorum() as Promise<bigint>,
  ]);
  const totalSlots = Number(numOptionsBn) + 1; // + blank vote
  // The contract's own floor, which is the one `publishResults` enforces. The
  // copy in the metadata is for display and could disagree with it.
  const privacyQuorum = Number(quorumBn);

  let keyNonce: string | undefined;
  try {
    keyNonce = (JSON.parse(metadataJson) as { keyNonce?: string }).keyNonce;
  } catch { /* no metadata: no derivable key */ }

  // Imported/stored key first, else re-derive (prompts for a wallet signature).
  const keys = await resolveTallyKey(address, keyNonce, signer);
  if (!keys) throw new MissingTallyKeyError();

  const { publicKey, privateKey } = restoreKeyPair(keys);
  // The stored key must belong to this election, or the decryption is garbage.
  if ("0x" + publicKey.n.toString(16) !== (JSON.parse(pkJson) as { n: string }).n) {
    throw new Error("The stored key does not match this election's public key");
  }

  const events = await queryLogsFrom(election, election.filters.VoteCast());
  const ballots = finalBallots(
    events.map(e => {
      const args = eventArgs<{ nullifier: bigint; voteCiphertext: string; nonce: bigint }>(e);
      return { nullifier: args.nullifier, nonce: args.nonce, ciphertext: args.voteCiphertext };
    }),
  );

  const proven = proveTally({
    publicKey: { n: publicKey.n, g: publicKey.g },
    lambda: privateKey.lambda,
    decrypt: c => privateKey.decrypt(c),
    ballots,
    slots: totalSlots,
    base: counterBaseFor(metadataJson),
  });

  return {
    counts: proven.counts.map(Number),
    voters: ballots.length,
    ballotsCast: events.length,
    quorumMet: ballots.length >= privacyQuorum,
    privacyQuorum,
    invalidBallots: proven.invalidBallots,
    proof: encodeTallyProof(proven.proof),
  };
}
