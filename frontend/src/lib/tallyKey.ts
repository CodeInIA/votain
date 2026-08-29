/**
 * Deterministic Paillier key derivation for the election tally.
 *
 * The organizer's tally key is NOT stored anywhere: it is re-derived on demand
 * from the passkey's PRF secret, so it is available on any device where the
 * passkey syncs and never sits at rest (localStorage / backend). The only
 * per-election input is a public `keyNonce` kept in the on-chain metadata — it
 * makes each election's key distinct and lets the key be re-derived before the
 * election address even exists (the public key is a constructor argument).
 *
 * Only the *seeded randomness* is bespoke here: prime testing stays in
 * `bigint-crypto-utils` (audited Miller-Rabin) and the key math mirrors
 * `paillier-bigint`'s own `generateRandomKeys`, reusing its key classes.
 */
import { isProbablyPrime } from "bigint-crypto-utils";
import { PublicKey, PrivateKey } from "paillier-bigint";
import { derivePrfSecret } from "./passkeyPrf";
import { PAILLIER_KEY_BITS, type SerializedKeyPair } from "./paillier";

const TALLY_KEY_SALT = "votain:tally-key:v1";
// PRF-eval salt for the organizer's tally master secret — independent from the
// voter identity secret derived from the same passkey.
const TALLY_PRF_SALT = new TextEncoder().encode(TALLY_KEY_SALT);
// Miller-Rabin rounds. 40 gives a false-prime probability < 2^-80, the usual
// margin for RSA/Paillier-sized primes.
const MR_ROUNDS = 40;

const toHex = (x: bigint): string => "0x" + x.toString(16);

/** A fresh, public per-election nonce (hex) — safe to store on-chain. */
export function newKeyNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return "0x" + [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

// ── Deterministic byte stream: HMAC-SHA256 in counter mode (NIST SP800-108) ──

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}

/**
 * An endless, reproducible byte stream keyed by `secret` and labelled by `info`.
 * block(i) = HMAC(secret, info ‖ uint32BE(i)); bytes are handed out in order.
 */
class SeededStream {
  private buf: Uint8Array = new Uint8Array(0);
  private counter = 0;
  constructor(private readonly secret: Uint8Array, private readonly info: Uint8Array) {}

  private async refill(): Promise<void> {
    const ctr = new Uint8Array(4);
    new DataView(ctr.buffer).setUint32(0, this.counter++, false);
    const block = await hmac(this.secret, concat(this.info, ctr));
    this.buf = concat(this.buf, block);
  }

  async take(n: number): Promise<Uint8Array> {
    while (this.buf.length < n) await this.refill();
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

function bytesToBigInt(b: Uint8Array): bigint {
  let x = 0n;
  for (const byte of b) x = (x << 8n) | BigInt(byte);
  return x;
}

const bitLength = (x: bigint): number => x.toString(2).length;

/**
 * Odd primes below TRIAL_DIVISION_LIMIT, for cheaply discarding composites.
 *
 * Around one odd number in 355 is prime at this size, so a naive walk spends
 * almost all of its time running full Miller-Rabin on numbers a single division
 * would have rejected. Dividing by the small primes first removes roughly seven
 * candidates in eight before any modular exponentiation happens.
 *
 * The limit is where the returns flatten: a larger sieve rejects a few percent
 * more candidates while costing a proportionally larger division pass on every
 * survivor.
 */
const TRIAL_DIVISION_LIMIT = 10_000;

const SMALL_PRIMES: bigint[] = (() => {
  const composite = new Uint8Array(TRIAL_DIVISION_LIMIT + 1);
  const primes: bigint[] = [];
  for (let i = 3; i <= TRIAL_DIVISION_LIMIT; i += 2) {
    if (composite[i]) continue;
    primes.push(BigInt(i));
    for (let j = i * i; j <= TRIAL_DIVISION_LIMIT; j += i) composite[j] = 1;
  }
  return primes;
})();

/** True when a small prime divides x, which proves x composite. */
function hasSmallFactor(x: bigint): boolean {
  for (const p of SMALL_PRIMES) {
    if (x % p === 0n) return x !== p;
  }
  return false;
}

/**
 * Draws a candidate of exactly `bits` bits from the stream (top bit set, odd),
 * then walks upward by 2 to the next probable prime. Deterministic given the
 * stream. Setting only the top bit, not the second, keeps p·q from spilling
 * into an extra bit (the caller redraws q if n is still the wrong size).
 *
 * THE WALK IS PART OF THE KEY. This function must return the same prime it
 * always has: the organizer's tally key is re-derived rather than stored, so a
 * different result here makes every earlier election undecryptable. Both filters
 * below are therefore chosen to be exact rather than merely likely. Trial
 * division only rejects numbers a small prime divides, and the one-round test
 * only rejects numbers Miller-Rabin proves composite; neither can skip a value
 * the original loop would have accepted. `tallyKey.test.ts` pins the result.
 */
async function nextPrime(stream: SeededStream, bits: number): Promise<bigint> {
  const bytes = await stream.take(Math.ceil(bits / 8));
  let x = bytesToBigInt(bytes) & ((1n << BigInt(bits)) - 1n);
  x |= (1n << BigInt(bits - 1)) | 1n;

  for (;;) {
    if (!hasSmallFactor(x)) {
      // One round first. A single Miller-Rabin witness rejects almost every
      // composite that survived the sieve, at a fortieth of the cost, so the
      // full MR_ROUNDS margin is only ever paid on a genuine candidate.
      if (await isProbablyPrime(x, 1)) {
        if (await isProbablyPrime(x, MR_ROUNDS)) return x;
      }
    }
    x += 2n;
  }
}

/**
 * Derives a Paillier keypair from a raw secret. Pure and deterministic — same
 * (secret, keyNonce) always yields the same keys. Exposed for testing;
 * production code should use `deriveElectionKeys`.
 */
export async function deriveKeysFromSecret(
  secret: Uint8Array,
  keyNonce: string,
  bitlength = PAILLIER_KEY_BITS,
): Promise<SerializedKeyPair> {
  const info = new TextEncoder().encode(`${TALLY_KEY_SALT}:${keyNonce}`);
  const stream = new SeededStream(secret, info);

  // Mirrors paillier-bigint: p is one bit longer than q, and n must be exactly
  // `bitlength` bits — redraw q (deterministically, from the same stream) if not.
  const p = await nextPrime(stream, Math.floor(bitlength / 2) + 1);
  let q: bigint;
  let n: bigint;
  do {
    q = await nextPrime(stream, Math.floor(bitlength / 2));
    n = p * q;
  } while (q === p || bitLength(n) !== bitlength);

  // Simple variant (g = n + 1): a standard, valid Paillier instance.
  const g = n + 1n;
  const lambda = (p - 1n) * (q - 1n);
  const mu = modInverse(lambda, n);

  // Build with the library's own classes to be certain the instance is well-formed.
  const publicKey = new PublicKey(n, g);
  void new PrivateKey(lambda, mu, publicKey, p, q);

  return {
    publicKey: { n: toHex(n), g: toHex(g) },
    privateKey: { lambda: toHex(lambda), mu: toHex(mu) },
  };
}

/**
 * Re-derives the election's tally keypair from the passkey PRF secret. Returns
 * null when the device has no PRF passkey (the caller must fall back to a random
 * keypair that is exported/stored, since nothing could be re-derived here).
 */
export async function deriveElectionKeys(keyNonce: string): Promise<SerializedKeyPair | null> {
  const secret = await derivePrfSecret(TALLY_PRF_SALT);
  if (!secret) return null;
  return deriveKeysFromSecret(secret, keyNonce, PAILLIER_KEY_BITS);
}

/** Modular inverse via the extended Euclidean algorithm (deterministic integer math). */
function modInverse(a: bigint, m: bigint): bigint {
  let [old_r, r] = [((a % m) + m) % m, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const quot = old_r / r;
    [old_r, r] = [r, old_r - quot * r];
    [old_s, s] = [s, old_s - quot * s];
  }
  if (old_r !== 1n) throw new Error("modInverse: not invertible");
  return ((old_s % m) + m) % m;
}
