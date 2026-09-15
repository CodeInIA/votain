/**
 * The voter's recovery phrase, and the identity derived from it.
 *
 * WHY THIS EXISTS. A voter's Semaphore identity is not something they use once
 * at enrolment: it is the key that signs every membership proof, so it is
 * needed for each ballot and each re-vote, which is the coercion defence. In
 * PRF mode the secret is never persisted, so a page reload means deriving it
 * from the passkey again.
 *
 * That made the whole design rest on one platform capability, and the capability
 * is not reliably there. Chrome and Firefox on Windows return the PRF secret
 * when a credential is created and refuse to evaluate it on an assertion:
 * measured across seven combinations of residency, allowCredentials and user
 * verification, over http://localhost and over HTTPS. A voter there could
 * enrol and then be unable to vote after refreshing the page. Reports from
 * other machines say it works, so the capability is not even consistent, which
 * is the strongest argument for not depending on it.
 *
 * So the phrase is the root and the passkey is a convenience. The identity is
 * derived from the phrase, the phrase is sealed under the passkey where that
 * works so nobody has to type it, and where it does not the voter types twelve
 * words and gets the same identity back. No platform can lock anyone out.
 *
 * This is the arrangement password managers use: a master secret the person
 * holds, with biometrics as the shortcut rather than the foundation.
 *
 * WHAT IT IS NOT. The phrase is not a wallet seed and controls no funds. It
 * reconstructs one Semaphore identity, and losing it costs the elections that
 * identity is already enrolled in, since the chain cannot tell whether that
 * voter already voted there and refusing is the only safe answer.
 */
import { Identity } from "@semaphore-protocol/identity";

/**
 * Words the phrase is built from.
 *
 * A deliberately small, plain list rather than BIP-39. These words are read off
 * a screen and typed back by someone who may never have seen a seed phrase, so
 * they are short, unambiguous when spoken, and have no near-homophones. Twelve
 * words from 128 give 84 bits, which is far past what an attacker could search
 * when every guess has to be checked against a Semaphore commitment.
 *
 * NOT BIP-39 on purpose: that list exists to be compatible with wallets, and
 * borrowing it would invite someone to type this phrase into one.
 */
const WORDS = [
  "amber", "anchor", "apple", "arrow", "autumn", "bamboo", "beacon", "berry",
  "bishop", "bottle", "branch", "bridge", "bronze", "butter", "cactus", "candle",
  "canvas", "carbon", "castle", "cedar", "cherry", "chisel", "cinder", "circle",
  "citrus", "clever", "cliff", "clover", "cobalt", "comet", "copper", "coral",
  "cotton", "crater", "crimson", "crystal", "cyclone", "dahlia", "damson", "dawn",
  "denim", "desert", "diamond", "dolphin", "dragon", "drift", "eagle", "ember",
  "emerald", "falcon", "fennel", "fern", "fiddle", "flint", "forest", "fossil",
  "galaxy", "garden", "ginger", "glacier", "granite", "gravel", "harbor", "harvest",
  "hazel", "hollow", "indigo", "ivory", "jasmine", "jungle", "kettle", "lagoon",
  "lantern", "laurel", "lemon", "lichen", "lilac", "linen", "lunar", "magnet",
  "mango", "maple", "marble", "meadow", "mercury", "meteor", "mimosa", "mineral",
  "mirror", "mosaic", "nectar", "nickel", "nutmeg", "oasis", "obsidian", "olive",
  "onyx", "orbit", "orchid", "otter", "oyster", "pebble", "pepper", "pewter",
  "pigeon", "pillar", "pine", "planet", "pollen", "poppy", "prairie", "prism",
  "pumpkin", "quartz", "quiver", "raven", "ribbon", "river", "rocket", "rosemary",
  "saffron", "sage", "salmon", "sapphire", "satin", "shadow", "shelter", "silver",
];

/** Words per phrase. Twelve of 128 is 84 bits. */
const WORD_COUNT = 12;

const HKDF_INFO = new TextEncoder().encode("votain:voter-identity:v1");

/** A fresh phrase, from the browser's cryptographic generator. */
export function generateRecoveryPhrase(): string {
  // One rejection-free draw per word: 128 is a power of two, so the low seven
  // bits of a random byte are uniform over the list with nothing to discard.
  const bytes = crypto.getRandomValues(new Uint8Array(WORD_COUNT));
  return Array.from(bytes, b => WORDS[b & 0x7f]).join(" ");
}

/**
 * Puts a typed phrase into the one form that derives correctly.
 *
 * Someone reading twelve words off a screen will capitalise, double-space, or
 * paste a trailing newline, and every one of those would derive a different
 * identity and lose their vote with no error to show for it.
 */
export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

/** Whether a phrase could have come from here: right length, known words. */
export function isValidPhrase(phrase: string): boolean {
  const words = normalizePhrase(phrase).split(" ");
  return words.length === WORD_COUNT && words.every(w => WORDS.includes(w));
}

/** The words a phrase uses that this list does not contain, for pointing at typos. */
export function unknownWords(phrase: string): string[] {
  return normalizePhrase(phrase)
    .split(" ")
    .filter(w => w.length > 0 && !WORDS.includes(w));
}

/**
 * The Semaphore identity a phrase reconstructs.
 *
 * Through HKDF rather than handing the phrase to `Identity` directly: the
 * derivation is then domain-separated, so the same phrase used for anything
 * else later cannot produce the same secret, and the identity does not depend
 * on how a library happens to hash its input today.
 */
export async function identityFromPhrase(phrase: string): Promise<Identity> {
  const normalized = normalizePhrase(phrase);
  if (!isValidPhrase(normalized)) {
    throw new Error("That is not a valid Votain recovery phrase");
  }

  const ikm = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalized) as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: HKDF_INFO },
    ikm,
    256,
  );

  // Hex, so the seed `Identity` receives is a stable string: passing raw bytes
  // would tie every voter's identity to how one library version stringifies a
  // buffer.
  const seed = Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, "0")).join("");
  return new Identity(seed);
}

/** The word list, for a UI that offers completions while someone types. */
export function phraseWordList(): readonly string[] {
  return WORDS;
}
