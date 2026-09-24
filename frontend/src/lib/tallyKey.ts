/**
 * The organizer's tally keys: one ElGamal key per ballot slot, on Baby Jubjub.
 *
 * NOT STORED ANYWHERE by default: re-derived on demand from a deterministic
 * signature by the organizer's WALLET (`organizerKey.ts`), so they are
 * available on any device the organizer can work from and never sit at rest.
 * The only per-election input is a public `keyNonce` kept in the on-chain
 * metadata: it makes each election's keys distinct and lets them be derived
 * before the election address exists, since the public keys are a constructor
 * argument.
 *
 * A wallet whose signatures are NOT deterministic cannot derive anything
 * reproducible, so for it the keys are random and must be kept in a file; see
 * `randomTallyKeys` and the key file below.
 *
 * THE DERIVATION IS A COMPATIBILITY SURFACE. Change it and every election
 * created before cannot be counted. `tallyKey.test.ts` pins it.
 */
import type { Signer } from "ethers";

import { deriveTallyKeys, isInSubgroup, multiply, BASE, type Point } from "./ballotCrypto";
import { organizerMasterSecret } from "./organizerKey";

export interface TallyKeys {
  /** One secret per slot in use: the options, then the blank vote. */
  secrets: bigint[];
  /** The public keys the election stores, x·G for each secret. */
  keys: Point[];
}

/** A fresh, public per-election nonce (hex), safe to store on chain. */
export function newKeyNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return "0x" + [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Re-derives an election's tally keys from the organizer's wallet. Null when
 * there is no signer to ask, in which case the caller falls back to keys it
 * generated at random and stored, since nothing can be re-derived.
 */
export async function deriveElectionKeys(
  keyNonce: string,
  slots: number,
  signer?: Signer,
): Promise<TallyKeys | null> {
  if (!signer) return null;
  return deriveTallyKeys(await organizerMasterSecret(signer), keyNonce, slots);
}

/** Keys from fresh randomness, for a wallet that cannot derive them. Must be kept. */
export async function randomTallyKeys(slots: number): Promise<TallyKeys> {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return deriveTallyKeys(secret, "random", slots);
}

// ────────────────────────────────────────────────
// Key file
// ────────────────────────────────────────────────

/** What an exported key file holds: the secrets, which are enough to rebuild the keys. */
interface KeyFile {
  version: 2;
  secrets: string[];
}

export function serializeTallyKeys(keys: TallyKeys): string {
  const file: KeyFile = { version: 2, secrets: keys.secrets.map(x => "0x" + x.toString(16)) };
  return JSON.stringify(file, null, 2);
}

/** Reads a key file back. Throws on anything that is not one. */
export function parseTallyKeys(text: string): TallyKeys {
  let file: Partial<KeyFile>;
  try {
    file = JSON.parse(text) as Partial<KeyFile>;
  } catch {
    throw new Error("Not a valid key file (invalid JSON)");
  }
  if (file?.version !== 2 || !Array.isArray(file.secrets) || file.secrets.length === 0) {
    throw new Error("Not a valid Votain tally key file");
  }
  const secrets = file.secrets.map(s => BigInt(s));
  const keys = secrets.map(x => multiply(BASE, x));
  if (!keys.every(isInSubgroup)) throw new Error("Not a valid Votain tally key file");
  return { secrets, keys };
}

/** Whether a key set is the one an election stores, point for point. */
export function keysMatch(keys: readonly Point[], onChain: readonly Point[]): boolean {
  return keys.length === onChain.length && keys.every((k, i) => k[0] === onChain[i][0] && k[1] === onChain[i][1]);
}
