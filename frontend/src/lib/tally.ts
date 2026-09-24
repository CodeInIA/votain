/**
 * In-browser tally, run by the organizer from the election screen.
 *
 * The election adds every ballot, votes and cancellations, into one running
 * aggregate as they arrive. Each re-vote cancels the one before it, so the
 * aggregate encrypts each voter's LAST vote, and decrypting it gives the
 * counts directly: there is no deduplication to run and no ballot is ever
 * decrypted on its own.
 *
 * WHAT THE KEY IS USED FOR, AND WHAT IT COULD DO. This decrypts the aggregate
 * only, the counts and nothing about any one ballot. But every ballot is
 * encrypted under the same keys, so whoever holds them COULD open a single
 * ballot: its choice, and from its cancellation whether it replaced an earlier
 * vote and for which option. What they could not learn is whose ballot it is or
 * which earlier ballot it cancels, since nothing on chain says either. Removing
 * the power itself needs the keys split between several parties (threshold
 * decryption); see the README's known limits.
 *
 * THE PROOF. The tally circuit proves that the counts are the decryption of
 * the election's own aggregate under its own keys; the contract checks it and
 * refuses to publish anything else. Below the privacy quorum the same circuit,
 * in its other mode, proves only that too few voted, and the election is voided
 * without the counts ever leaving this device.
 */
import type { Signer } from "ethers";
import { poseidon3 } from "poseidon-lite";

import { circuitFiles } from "./ballot";
import {
  decryptTally,
  solidityProof,
  tallyCircuitInputs,
  unflattenPoints,
  type SolidityProof,
} from "./ballotCrypto";
import { getElection } from "./contracts";
import { loadElectionPrivateKey, storeElectionPrivateKey } from "./organizer";
import { deriveElectionKeys, keysMatch, parseTallyKeys, type TallyKeys } from "./tallyKey";

export interface TallyResult {
  /** Vote counts per option; the LAST entry is the blank vote. */
  counts: number[];
  /** How many voted, which the counts add up to: each voter's chain counts once. */
  voters: number;
  /** Ballots cast, re-votes included. */
  ballotsCast: number;
  /** True when `voters` reaches the election's privacy quorum. */
  quorumMet: boolean;
  privacyQuorum: number;
  /**
   * The tally circuit's proof: of the counts when the quorum is met, for
   * `publishResults`; of "fewer than the quorum voted" otherwise, for
   * `voidBelowQuorum`.
   */
  proof: SolidityProof;
}

/**
 * Resolves the tally keys. Keys stored locally, either random ones kept at
 * creation or ones IMPORTED from an exported file, always win, so a device that
 * cannot reach the organizer's wallet can still tally after importing.
 * Otherwise a `keyNonce` election re-derives them from the wallet signature.
 * Null when unavailable.
 */
export async function resolveTallyKey(
  address: string,
  slots: number,
  keyNonce?: string,
  /** Signs the deterministic payload the tally master is derived from. */
  signer?: Signer,
): Promise<TallyKeys | null> {
  const stored = loadElectionPrivateKey(address);
  if (stored) return stored;
  return keyNonce ? deriveElectionKeys(keyNonce, slots, signer) : null;
}

/**
 * Best-effort check of whether this device can obtain the keys: stored or
 * imported ones, or a `keyNonce` election, whose keys any organizer signed in
 * here can derive, since deriving them needs only their wallet.
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

/** The election's own keys, as stored on chain. */
async function onChainKeys(address: string) {
  return unflattenPoints(await getElection(address).tallyKeys());
}

/**
 * Imports a key file exported from another device, after checking it is well
 * formed AND belongs to this election (its keys are the ones on chain).
 * Stored locally so `computeTally` can then use it.
 */
export async function importTallyKey(address: string, fileText: string): Promise<void> {
  const keys = parseTallyKeys(fileText);
  if (!keysMatch(keys.keys, await onChainKeys(address))) {
    throw new Error("This key does not belong to this election");
  }
  storeElectionPrivateKey(address, keys);
}

/**
 * Computes the tally and its proof without publishing, so the organizer can
 * see the result (and whether the privacy quorum held) before committing it.
 * The signer is what reaches the wallet the keys derive from; optional so a
 * device holding an imported key needs none.
 */
export async function computeTally(address: string, signer?: Signer): Promise<TallyResult> {
  const election = getElection(address);
  const [slotsBn, metadataJson, quorumBn, ballotsBn, aggregate, keys] = await Promise.all([
    election.circuitSlots() as Promise<bigint>,
    election.metadataJson() as Promise<string>,
    election.privacyQuorum() as Promise<bigint>,
    election.voteCount() as Promise<bigint>,
    election.aggregate() as Promise<[bigint[], bigint[]]>,
    onChainKeys(address),
  ]);
  // The contract's own floor, which is the one it enforces. The copy in the
  // metadata is for display and could disagree with it.
  const privacyQuorum = Number(quorumBn);
  const ballotsCast = Number(ballotsBn);

  let keyNonce: string | undefined;
  try {
    keyNonce = (JSON.parse(metadataJson) as { keyNonce?: string }).keyNonce;
  } catch { /* no metadata: no derivable key */ }

  // Imported/stored keys first, else re-derive (asks the wallet for a signature).
  const tallyKeys = await resolveTallyKey(address, keys.length, keyNonce, signer);
  if (!tallyKeys) throw new MissingTallyKeyError();
  // Keys that are not this election's decrypt to nothing, and the search for
  // the counts would say so only after running to its bound.
  if (!keysMatch(tallyKeys.keys, keys)) {
    throw new Error("The stored key does not match this election's public keys");
  }

  const total = { a: [aggregate[0][0], aggregate[0][1]] as const, b: unflattenPoints(aggregate[1]) };
  const counts = decryptTally(tallyKeys.secrets, total, ballotsCast);
  const voters = counts.reduce((sum, n) => sum + n, 0n);
  const quorumMet = voters >= quorumBn;

  const inputs = tallyCircuitInputs({
    poseidon3,
    circuitSlots: Number(slotsBn),
    keys,
    secrets: tallyKeys.secrets,
    counts,
    aggregate: total,
    quorum: quorumBn,
    publish: quorumMet,
  });
  const { groth16 } = await import("snarkjs");
  const files = circuitFiles("tally", Number(slotsBn));
  const { proof } = await groth16.fullProve(inputs, files.wasm, files.zkey);

  return {
    counts: counts.map(Number),
    voters: Number(voters),
    ballotsCast,
    quorumMet,
    privacyQuorum,
    proof: solidityProof(proof),
  };
}
