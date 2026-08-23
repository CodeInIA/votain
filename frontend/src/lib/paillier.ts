/**
 * Paillier homomorphic ballot encryption.
 *
 * Encoding: a ballot for option `i` is the plaintext B^i where B = 10^6.
 * Adding ciphertexts therefore adds per-option counters in base B, so the
 * organizer decrypts ONE aggregated value and unpacks every option's total
 * without ever seeing an individual vote. Blank vote = last option index.
 */
import { generateRandomKeys, PublicKey, PrivateKey } from "paillier-bigint";

/** Max votes representable per option before counters overlap. */
export const COUNTER_BASE = 1_000_000n;

export const PAILLIER_KEY_BITS = 2048;

export interface SerializedPublicKey {
  n: string; // hex
  g: string; // hex
}

export interface SerializedKeyPair {
  publicKey: SerializedPublicKey;
  privateKey: {
    lambda: string; // hex
    mu: string; // hex
  };
}

/**
 * Hex for values consumed as numbers (key material). Odd length is fine here:
 * BigInt() parses it either way.
 */
const toHex = (x: bigint): string => "0x" + x.toString(16);
const fromHex = (s: string): bigint => BigInt(s);

/**
 * Hex for values consumed as Solidity `bytes` (the ballot ciphertext).
 *
 * MUST be zero-padded to an even number of digits. `toString(16)` drops the
 * leading zero nibble, so roughly half of all ciphertexts come out an odd number
 * of characters, which ethers rejects as BytesLike: the vote would fail client
 * side before it ever reached the chain, and only for some voters, which is a
 * miserable bug to chase.
 */
const toBytesHex = (x: bigint): string => {
  const digits = x.toString(16);
  return "0x" + (digits.length % 2 === 0 ? digits : "0" + digits);
};

// ────────────────────────────────────────────────
// Key management
// ────────────────────────────────────────────────

export async function generateElectionKeys(): Promise<SerializedKeyPair> {
  const { publicKey, privateKey } = await generateRandomKeys(PAILLIER_KEY_BITS);
  return {
    publicKey: { n: toHex(publicKey.n), g: toHex(publicKey.g) },
    privateKey: { lambda: toHex(privateKey.lambda), mu: toHex(privateKey.mu) },
  };
}

export function parsePublicKey(json: string): PublicKey {
  const { n, g } = JSON.parse(json) as SerializedPublicKey;
  return new PublicKey(fromHex(n), fromHex(g));
}

export function restoreKeyPair(serialized: SerializedKeyPair): { publicKey: PublicKey; privateKey: PrivateKey } {
  const publicKey = new PublicKey(fromHex(serialized.publicKey.n), fromHex(serialized.publicKey.g));
  const privateKey = new PrivateKey(
    fromHex(serialized.privateKey.lambda),
    fromHex(serialized.privateKey.mu),
    publicKey,
  );
  return { publicKey, privateKey };
}

// ────────────────────────────────────────────────
// Ballots
// ────────────────────────────────────────────────

/** Encrypts a ballot for `optionIndex` (blank = numOptions). Returns 0x-hex ciphertext. */
export function encryptBallot(publicKeyJson: string, optionIndex: number): string {
  const pk = parsePublicKey(publicKeyJson);
  const plaintext = COUNTER_BASE ** BigInt(optionIndex);
  return toBytesHex(pk.encrypt(plaintext));
}

/** Homomorphically adds a list of 0x-hex ciphertexts. */
export function addCiphertexts(publicKey: PublicKey, ciphertexts: string[]): bigint {
  if (ciphertexts.length === 0) throw new Error("no ciphertexts to add");
  return ciphertexts.map(fromHex).reduce((acc, c) => publicKey.addition(acc, c));
}

/** Decrypts an aggregated ciphertext and unpacks the per-option counters. */
export function decryptTally(
  keyPair: { publicKey: PublicKey; privateKey: PrivateKey },
  aggregated: bigint,
  numOptionsWithBlank: number,
): bigint[] {
  let remaining = keyPair.privateKey.decrypt(aggregated);
  const counts: bigint[] = [];
  for (let i = 0; i < numOptionsWithBlank; i++) {
    counts.push(remaining % COUNTER_BASE);
    remaining /= COUNTER_BASE;
  }
  if (remaining !== 0n) throw new Error("tally overflow: counters exceeded COUNTER_BASE");
  return counts;
}
