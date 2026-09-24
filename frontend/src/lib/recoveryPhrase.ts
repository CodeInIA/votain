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

import { EFF_SHORT_WORDS } from "./wordlist";

/**
 * Words the phrase is built from: see `wordlist.ts`.
 *
 * A plain list rather than BIP-39, on purpose. These words are read off a
 * screen and typed back by someone who may never have seen a seed phrase, so
 * they are short, common and unambiguous; and BIP-39 exists to be compatible
 * with wallets, so borrowing it would invite someone to type this phrase into
 * one.
 *
 * LONGER THAN IT WAS. The first list had 128 words, so twelve of them carried
 * 84 bits. The commitments they protect are public and permanent, and a
 * guessing attack runs against every voter at once, so the margin mattered.
 * Twelve words from 1295 carry 124 bits, the same number of words to write
 * down, and on top of that every guess still pays `STRETCH_ITERATIONS`.
 */
const WORDS = EFF_SHORT_WORDS;
const WORD_SET: ReadonlySet<string> = new Set(WORDS);

/** Words per phrase. Twelve of 1295 is about 124 bits. */
const WORD_COUNT = 12;

/** Salt of the derivation. Changing it changes every identity, so it is versioned. */
const DERIVATION_SALT = new TextEncoder().encode("votain:voter-identity:v2");

/**
 * How slow deriving an identity from a phrase is, on purpose.
 *
 * WHY. Every voter's commitment is public and permanent in `PlatformRegistry`,
 * so an attacker can guess phrases offline, at leisure, and check each guess
 * against ALL of them at once. 124 bits is out of reach already; 600,000
 * rounds of PBKDF2-SHA256 (the current OWASP figure) multiply every guess by
 * about 2^19 more, so a weakness found in the list or the generator later does
 * not become a practical attack. It costs an honest voter well under a second,
 * once, when they type their phrase.
 */
const STRETCH_ITERATIONS = 600_000;

/** A fresh phrase, from the browser's cryptographic generator. */
export function generateRecoveryPhrase(): string {
  // Rejection sampling over 16-bit draws: 1295 does not divide 65536, so a
  // plain modulo would make the first words of the list slightly likelier.
  // Draws at or above the largest multiple of the list size are thrown away.
  const limit = Math.floor(0x10000 / WORDS.length) * WORDS.length;
  const words: string[] = [];
  while (words.length < WORD_COUNT) {
    for (const draw of crypto.getRandomValues(new Uint16Array(WORD_COUNT))) {
      if (draw < limit && words.length < WORD_COUNT) words.push(WORDS[draw % WORDS.length]);
    }
  }
  return words.join(" ");
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
  return words.length === WORD_COUNT && words.every(w => WORD_SET.has(w));
}

/** The words a phrase uses that this list does not contain, for pointing at typos. */
export function unknownWords(phrase: string): string[] {
  return normalizePhrase(phrase)
    .split(" ")
    .filter(w => w.length > 0 && !WORD_SET.has(w));
}

/**
 * The Semaphore identity a phrase reconstructs.
 *
 * Through a salted, stretched KDF rather than handing the phrase to `Identity`
 * directly: the derivation is domain-separated, so the same phrase used for
 * anything else later cannot produce the same secret; it does not depend on how
 * a library happens to hash its input today; and every guess costs an attacker
 * `STRETCH_ITERATIONS` rounds.
 */
export async function identityFromPhrase(phrase: string): Promise<Identity> {
  const normalized = normalizePhrase(phrase);
  if (!isValidPhrase(normalized)) {
    throw new Error("That is not a valid Votain recovery phrase");
  }

  const ikm = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalized) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: DERIVATION_SALT, iterations: STRETCH_ITERATIONS },
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
