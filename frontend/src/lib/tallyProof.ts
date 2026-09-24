/**
 * The proof that a published tally is what the ballots actually hold.
 *
 * WHAT IT CLOSES. A Paillier tally used to rest on the organizer's word: they
 * hold the key, they decrypt the sum, they publish counters, and nobody else
 * can decrypt to check. Two things were missing. Anyone could see that the
 * counters added up to the number of voters, but not that the votes had not
 * been moved between options. And one voter could encrypt garbage, or five
 * votes for one option, and either break the tally outright or stuff it.
 *
 * HOW. Paillier is randomness-recoverable: whoever holds the key can compute,
 * from a ciphertext c and its plaintext m, the r with c = g^m · r^n (mod n²).
 * Publishing (m, r) lets anyone check that equation with nothing but the public
 * key, and reveals nothing about any other ciphertext. So:
 *
 *  - every final ballot (the highest nonce per nullifier) is decrypted
 *    privately and classified: a valid ballot encrypts exactly B^i for one
 *    option i, anything else is invalid;
 *  - each INVALID ballot is excluded and opened in public, so excluding an
 *    honest ballot would require an opening that cannot exist;
 *  - the product of the VALID ballots is opened once, to the packed counters.
 *    That reveals the total per option and nothing about who chose what.
 *
 * Ciphertexts that are not even elements of Z*_{n²} are excluded by everyone
 * alike, without any opening, since that needs no key to see.
 *
 * Deliberately free of dependencies: the browser, the auditor's CLI and the
 * contract tests all import this one file, so the three can never disagree
 * about what "verified" means.
 */

export interface PaillierPublic {
  n: bigint;
  g: bigint;
}

/** One voter's surviving ballot, as the chain recorded it. */
export interface FinalBallot {
  nullifier: bigint;
  ciphertext: bigint;
}

/** An excluded ballot, opened so anyone can see it encrypts no valid choice. */
export interface BallotOpening {
  nullifier: bigint;
  plaintext: bigint;
  randomness: bigint;
}

export interface TallyProof {
  version: 1;
  /** Opens the product of the valid ballots to the packed counters. */
  aggregateRandomness: bigint;
  /** Ballots that decrypt to something other than one vote for one option. */
  invalid: BallotOpening[];
}

export const TALLY_PROOF_VERSION = 1;

// ────────────────────────────────────────────────
// Arithmetic
// ────────────────────────────────────────────────

const mod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

export function modPow(base: bigint, exponent: bigint, m: bigint): bigint {
  if (m === 1n) return 0n;
  let result = 1n;
  let b = mod(base, m);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    e >>= 1n;
    b = (b * b) % m;
  }
  return result;
}

function gcd(a: bigint, b: bigint): bigint {
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export function modInverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [mod(a, m), m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error("not invertible");
  return mod(oldS, m);
}

// ────────────────────────────────────────────────
// Ballots and counters
// ────────────────────────────────────────────────

/** Whether a ciphertext is an element of Z*_{n²}. Needs no key. */
export function isWellFormed(pk: PaillierPublic, c: bigint): boolean {
  const n2 = pk.n * pk.n;
  return c > 0n && c < n2 && gcd(c, pk.n) === 1n;
}

/** Whether a plaintext is exactly one vote for one of `slots` options. */
export function isValidBallotPlaintext(m: bigint, base: bigint, slots: number): boolean {
  let power = 1n;
  for (let i = 0; i < slots; i++) {
    if (m === power) return true;
    power *= base;
  }
  return false;
}

/** The single plaintext the counters stand for: Σ counts[i] · base^i. */
export function packCounts(counts: readonly bigint[], base: bigint): bigint {
  let packed = 0n;
  for (let i = counts.length - 1; i >= 0; i--) packed = packed * base + counts[i];
  return packed;
}

/** Whether (m, r) opens c: c = g^m · r^n (mod n²). */
export function verifyOpening(pk: PaillierPublic, c: bigint, m: bigint, r: bigint): boolean {
  const n2 = pk.n * pk.n;
  if (m < 0n || m >= pk.n) return false;
  if (r <= 0n || r >= pk.n || gcd(r, pk.n) !== 1n) return false;
  return (modPow(pk.g, m, n2) * modPow(r, pk.n, n2)) % n2 === mod(c, n2);
}

/** The product of ciphertexts, which encrypts the sum of their plaintexts. */
export function aggregate(pk: PaillierPublic, ciphertexts: readonly bigint[]): bigint {
  const n2 = pk.n * pk.n;
  return ciphertexts.reduce((acc, c) => (acc * c) % n2, 1n);
}

/**
 * The r that opens c to m, which only the key holder can compute.
 *
 * c · g^{-m} = r^n (mod n²), and raising that to n^{-1} mod λ gives r back
 * modulo n, because r^λ = 1 (mod n) whenever λ is a multiple of the Carmichael
 * function of n, which both of Paillier's usual choices of λ are.
 */
export function recoverRandomness(
  pk: PaillierPublic,
  lambda: bigint,
  c: bigint,
  m: bigint,
): bigint {
  const n2 = pk.n * pk.n;
  const rToN = (mod(c, n2) * modInverse(modPow(pk.g, m, n2), n2)) % n2;
  const d = modInverse(pk.n, lambda);
  return modPow(rToN % pk.n, d, pk.n);
}

// ────────────────────────────────────────────────
// Final ballots
// ────────────────────────────────────────────────

/** The ballot each nullifier's highest nonce left, which is the one that counts. */
export function finalBallots(
  events: readonly { nullifier: bigint; nonce: bigint; ciphertext: string | bigint }[],
): FinalBallot[] {
  const latest = new Map<bigint, { nonce: bigint; ciphertext: bigint }>();
  for (const e of events) {
    const existing = latest.get(e.nullifier);
    if (!existing || e.nonce > existing.nonce) {
      latest.set(e.nullifier, { nonce: e.nonce, ciphertext: toBigInt(e.ciphertext) });
    }
  }
  return [...latest.entries()].map(([nullifier, v]) => ({ nullifier, ciphertext: v.ciphertext }));
}

function toBigInt(value: string | bigint): bigint {
  if (typeof value === "bigint") return value;
  return value === "0x" || value === "" ? 0n : BigInt(value);
}

// ────────────────────────────────────────────────
// Producing and checking a tally
// ────────────────────────────────────────────────

export interface ProvenTally {
  counts: bigint[];
  /** Ballots excluded: malformed ciphertexts plus opened invalid ones. */
  invalidBallots: number;
  proof: TallyProof;
}

/**
 * Tallies the final ballots and proves the result. Needs the private key,
 * given as `decrypt` and `lambda` so this file stays free of any library.
 */
export function proveTally(params: {
  publicKey: PaillierPublic;
  lambda: bigint;
  decrypt: (c: bigint) => bigint;
  ballots: readonly FinalBallot[];
  slots: number;
  base: bigint;
}): ProvenTally {
  const { publicKey: pk, lambda, decrypt, ballots, slots, base } = params;

  const valid: bigint[] = [];
  const invalid: BallotOpening[] = [];
  let malformed = 0;
  const counts = Array.from({ length: slots }, () => 0n);

  for (const ballot of ballots) {
    if (!isWellFormed(pk, ballot.ciphertext)) {
      malformed++;
      continue;
    }
    const m = decrypt(ballot.ciphertext);
    if (isValidBallotPlaintext(m, base, slots)) {
      valid.push(ballot.ciphertext);
      counts[indexOfPower(m, base)] += 1n;
    } else {
      invalid.push({
        nullifier: ballot.nullifier,
        plaintext: m,
        randomness: recoverRandomness(pk, lambda, ballot.ciphertext, m),
      });
    }
  }

  const packed = packCounts(counts, base);
  const aggregateRandomness =
    valid.length === 0 ? 1n : recoverRandomness(pk, lambda, aggregate(pk, valid), packed);

  return {
    counts,
    invalidBallots: malformed + invalid.length,
    proof: { version: TALLY_PROOF_VERSION, aggregateRandomness, invalid },
  };
}

function indexOfPower(m: bigint, base: bigint): number {
  let i = 0;
  while (m > 1n) {
    m /= base;
    i++;
  }
  return i;
}

export type TallyVerdict =
  | { ok: true; validBallots: number; invalidBallots: number }
  | { ok: false; reason: string };

/**
 * Checks a published tally against the ballots on chain, with no key.
 *
 * Everything it needs is public: the ballots from `VoteCast`, the public key,
 * the counters and the proof. Any reader can run it and reach the same answer.
 */
export function verifyTally(params: {
  publicKey: PaillierPublic;
  ballots: readonly FinalBallot[];
  counts: readonly bigint[];
  invalidBallots: bigint | number;
  proof: TallyProof;
  base: bigint;
}): TallyVerdict {
  const { publicKey: pk, ballots, counts, proof, base } = params;
  if (proof.version !== TALLY_PROOF_VERSION) return { ok: false, reason: "unknown proof version" };
  if (counts.some(c => c < 0n || c >= base)) return { ok: false, reason: "a counter overflows its slot" };

  const byNullifier = new Map(ballots.map(b => [b.nullifier, b.ciphertext]));
  const excluded = new Set<bigint>();

  for (const opening of proof.invalid) {
    const c = byNullifier.get(opening.nullifier);
    if (c === undefined) return { ok: false, reason: "an excluded ballot is not on chain" };
    if (excluded.has(opening.nullifier)) return { ok: false, reason: "a ballot is excluded twice" };
    if (!verifyOpening(pk, c, opening.plaintext, opening.randomness)) {
      return { ok: false, reason: "an excluded ballot's opening does not match it" };
    }
    if (isValidBallotPlaintext(opening.plaintext, base, counts.length)) {
      return { ok: false, reason: "a valid ballot was excluded" };
    }
    excluded.add(opening.nullifier);
  }

  const valid: bigint[] = [];
  let malformed = 0;
  for (const b of ballots) {
    if (excluded.has(b.nullifier)) continue;
    if (!isWellFormed(pk, b.ciphertext)) {
      malformed++;
      continue;
    }
    valid.push(b.ciphertext);
  }

  const invalidBallots = malformed + excluded.size;
  if (BigInt(invalidBallots) !== BigInt(params.invalidBallots)) {
    return { ok: false, reason: "the excluded count does not match the proof" };
  }

  const total = counts.reduce((a, c) => a + c, 0n);
  if (total !== BigInt(valid.length)) {
    return { ok: false, reason: "the counters do not add up to the valid ballots" };
  }

  const packed = packCounts(counts, base);
  const opened =
    valid.length === 0
      ? packed === 0n
      : verifyOpening(pk, aggregate(pk, valid), packed, proof.aggregateRandomness);
  if (!opened) return { ok: false, reason: "the counters are not what the ballots add up to" };

  return { ok: true, validBallots: valid.length, invalidBallots };
}

// ────────────────────────────────────────────────
// Wire format
// ────────────────────────────────────────────────

const hex = (x: bigint): string => "0x" + x.toString(16);

/** UTF-8 JSON as `0x`-prefixed hex, the form `publishResults` takes it in. */
export function encodeTallyProof(proof: TallyProof): string {
  const json = JSON.stringify({
    v: proof.version,
    r: hex(proof.aggregateRandomness),
    invalid: proof.invalid.map(o => ({
      nullifier: hex(o.nullifier),
      m: hex(o.plaintext),
      r: hex(o.randomness),
    })),
  });
  const bytes = new TextEncoder().encode(json);
  return "0x" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

/** The inverse of `encodeTallyProof`. Throws on anything else. */
export function decodeTallyProof(data: string): TallyProof {
  const digits = data.startsWith("0x") ? data.slice(2) : data;
  if (digits.length % 2 !== 0 || /[^0-9a-f]/i.test(digits)) throw new Error("not hex");
  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);

  const raw = JSON.parse(new TextDecoder().decode(bytes)) as {
    v?: unknown;
    r?: unknown;
    invalid?: unknown;
  };
  if (raw.v !== TALLY_PROOF_VERSION || typeof raw.r !== "string" || !Array.isArray(raw.invalid)) {
    throw new Error("not a tally proof");
  }
  return {
    version: TALLY_PROOF_VERSION,
    aggregateRandomness: BigInt(raw.r),
    invalid: raw.invalid.map((o: { nullifier?: unknown; m?: unknown; r?: unknown }) => {
      if (typeof o?.nullifier !== "string" || typeof o.m !== "string" || typeof o.r !== "string") {
        throw new Error("not a tally proof");
      }
      return { nullifier: BigInt(o.nullifier), plaintext: BigInt(o.m), randomness: BigInt(o.r) };
    }),
  };
}
