/**
 * Paillier homomorphic ballot encryption.
 *
 * Encoding: a ballot for option `i` is the plaintext B^i. Adding ciphertexts
 * therefore adds per-option counters in base B, so the organizer decrypts ONE
 * aggregated value and unpacks every option's total without ever seeing an
 * individual vote. Blank vote = last option index.
 *
 * THE BASE IS PART OF THE BALLOT. It is fixed when a ballot is encrypted, so it
 * cannot be changed for an election that already has votes in it. Elections
 * record theirs in `metadataJson.counterBase`; the ones created before that
 * field existed have none and are read with `LEGACY_COUNTER_BASE`.
 */
import { generateRandomKeys, PublicKey, PrivateKey } from "paillier-bigint";

/**
 * Votes representable per option, for elections created from now on.
 *
 * A trillion, where it used to be a million. A million is more than any real
 * election needs, but "more than anyone needs" is the kind of bound that gets
 * tested by something nobody predicted, and the cost of raising it is nothing:
 * the plaintext has about 616 decimal digits to spend and 51 counters of 12
 * digits fit inside it. See `ElectionV4.MAX_OPTIONS`, which enforces the
 * matching ceiling on options so the two can never disagree.
 */
export const COUNTER_BASE = 1_000_000_000_000n;

/** What elections created before `counterBase` was recorded were encoded with. */
export const LEGACY_COUNTER_BASE = 1_000_000n;

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

/**
 * The counter base one election was encoded with.
 *
 * Elections created before the base was recorded carry no `counterBase`, and
 * they were all encoded with the old million. Defaulting to the current
 * constant instead would decode every one of them to nonsense, so absence has
 * to mean the legacy value rather than "whatever we use today".
 */
export function counterBaseFor(metadataJson: string): bigint {
  try {
    const meta = JSON.parse(metadataJson) as { counterBase?: string };
    return meta.counterBase ? BigInt(meta.counterBase) : LEGACY_COUNTER_BASE;
  } catch {
    return LEGACY_COUNTER_BASE;
  }
}

/** Encrypts a ballot for `optionIndex` (blank = numOptions). Returns 0x-hex ciphertext. */
export function encryptBallot(
  publicKeyJson: string,
  optionIndex: number,
  base: bigint = COUNTER_BASE,
): string {
  if (!Number.isInteger(optionIndex) || optionIndex < 0) {
    throw new Error(`not an option index: ${optionIndex}`);
  }
  const pk = parsePublicKey(publicKeyJson);
  const plaintext = base ** BigInt(optionIndex);
  return toBytesHex(pk.encrypt(plaintext));
}
