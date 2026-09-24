/**
 * Credential revocation, published in `PlatformRegistry`.
 *
 * A StatusList2021 bitstring says which issued credentials are no longer valid,
 * without saying whose. It used to be a JSON file on this server, which meant a
 * verifier could only ever ask the same party that signed the credential
 * whether it still stood.
 *
 * TWO THINGS MADE THE MOVE PRACTICAL. The slot is assigned once per HUMAN, at
 * registration, rather than once per credential: the issuer used to allocate a
 * fresh index on every sign-in, and on chain that would have been a transaction
 * per login. And reads are cached, because `isRevoked` runs inside
 * `verifySession`, which is every authenticated request in the application. An
 * RPC round trip there would have been paid by every page load to publish a
 * fact that changes a handful of times in a deployment's life.
 *
 * TWO QUESTIONS, TWO READS, and conflating them was a scaling bug. Publishing
 * the list needs every bit; a session check needs ONE. Both used to go through
 * the whole-list read, which asks the chain once per registered human: sixty
 * nine calls on the development chain and sixty nine thousand on a platform
 * with that many voters, every time the cache expired under traffic. The
 * session path now reads the single slot it is asking about, which is one
 * `eth_call` whatever the population, and the full scan is paid only by
 * whoever fetches the published credential.
 *
 * Both caches are deliberate and bounded: a revocation takes effect within
 * `CACHE_TTL_MS`, and `refreshRevocations` exists so a revocation made through
 * this server takes effect at once.
 *
 * Env:
 *   CHAIN_RPC_URL     RPC endpoint
 *   REGISTRY_ADDRESS  PlatformRegistry deployment address
 */
import { gzipSync, gunzipSync } from 'node:zlib';

import { getRegistryReader, isRegistrarConfigured, writeRegistry } from '../chain/registrar.js';

/** 16 KB bitstring, the spec-recommended minimum. Grows past it, never truncates. */
const MIN_LIST_SIZE_BITS = 131_072;

/** How many slots are read from the chain at once while building the list. */
const READ_CONCURRENCY = 25;
export const DEFAULT_LIST_ID = 'voters-1';

/**
 * How long a cached revocation set is trusted.
 *
 * Short enough that a revocation from another instance is honoured in under a
 * minute, long enough that a burst of requests costs one RPC call rather than
 * hundreds.
 */
const CACHE_TTL_MS = 30_000;

let cache: { revoked: Set<number>; count: number; at: number } | null = null;
/** The scan in progress, so a burst of requests at expiry pays for one. */
let inFlight: Promise<{ revoked: Set<number>; count: number }> | null = null;

/**
 * One slot's verdict, for the session path.
 *
 * Keyed by index rather than by human, because that is what a credential
 * carries. Small: it holds an entry per voter who has made a request inside
 * the TTL, and each entry is a number and a boolean.
 */
const slotCache = new Map<number, { revoked: boolean; at: number }>();

async function readRevocations(): Promise<{ revoked: Set<number>; count: number }> {
  const registry = getRegistryReader();
  const count = Number(await registry.memberCount());

  // One call per slot handed out, a batch at a time. Bounded by the number of
  // registered humans, and only paid when the cache has expired.
  const revoked = new Set<number>();
  for (let start = 1; start <= count; start += READ_CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(READ_CONCURRENCY, count - start + 1) },
      (_, i) => start + i,
    );
    const flags = await Promise.all(batch.map(index => registry.revokedStatus(index) as Promise<boolean>));
    flags.forEach((isRevoked, i) => {
      if (isRevoked) revoked.add(batch[i]);
    });
  }
  return { revoked, count };
}

async function snapshot(): Promise<{ revoked: Set<number>; count: number }> {
  if (!isRegistrarConfigured()) return { revoked: new Set(), count: 0 };
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;

  inFlight ??= readRevocations()
    .then(fresh => {
      cache = { ...fresh, at: Date.now() };
      return fresh;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Drops both caches, so a revocation made here is honoured immediately. */
export function refreshRevocations(): void {
  cache = null;
  slotCache.clear();
  humanSlots.clear();
}

/**
 * The slot this human's credentials are listed under.
 *
 * Assigned by `registerMember`, so there is nothing to allocate here and no
 * transaction to pay for at sign-in. Zero means the human is not registered,
 * which the caller reports rather than papering over.
 */
export async function statusIndexFor(nullifier: string): Promise<number> {
  if (!isRegistrarConfigured()) return 0;
  return Number(await getRegistryReader().statusIndexOf(nullifier));
}

/**
 * The slot of a human, for a credential that does not carry one.
 *
 * A first-time voter signs in before they are registered, so their credential
 * names no slot. Their registration assigns one moments later, and from then
 * on it can be revoked: this is how the session path finds it. A slot never
 * changes once assigned, so a found one is cached for good; "not registered
 * yet" is cached only for the usual TTL.
 */
const humanSlots = new Map<string, { slot: number; at: number }>();
const MAX_CACHED_HUMANS = 50_000;

export async function statusSlotOfHuman(nullifier: string): Promise<number> {
  const cached = humanSlots.get(nullifier);
  if (cached && (cached.slot > 0 || Date.now() - cached.at < CACHE_TTL_MS)) return cached.slot;

  const slot = await statusIndexFor(nullifier);
  if (humanSlots.size >= MAX_CACHED_HUMANS) humanSlots.clear();
  humanSlots.set(nullifier, { slot, at: Date.now() });
  return slot;
}

export async function revokeIndex(index: number): Promise<void> {
  if (!isRegistrarConfigured()) throw new Error('registrar not configured');
  await writeRegistry(r => r.revokeStatus(index));
  refreshRevocations();
}

export async function isRevoked(index: number): Promise<boolean> {
  if (!isRegistrarConfigured()) return false;

  const cached = slotCache.get(index);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.revoked;

  // A whole-list read would answer this too, and did: one call per registered
  // human to learn one bit. See the note at the top of the file.
  const revoked: boolean = await getRegistryReader().revokedStatus(index);
  slotCache.set(index, { revoked, at: Date.now() });
  return revoked;
}

/** gzip+base64url bitstring with revoked bits set, per StatusList2021. */
export async function encodedList(): Promise<string> {
  const { revoked, count } = await snapshot();
  // Slot `count` is the highest handed out. A fixed 16 KB list silently lost
  // every revocation past slot 131071, since writing beyond a Buffer is a
  // no-op; the list now grows, in whole bytes, to hold every slot.
  const bits = Math.max(MIN_LIST_SIZE_BITS, count + 1);
  const bytes = Buffer.alloc(Math.ceil(bits / 8));
  for (const index of revoked) {
    bytes[Math.floor(index / 8)] |= 1 << (7 - (index % 8));
  }
  return gzipSync(bytes).toString('base64url');
}

/** Decodes an encodedList and checks one bit (used by tests/verifiers). */
export function checkBit(encoded: string, index: number): boolean {
  const bytes = gunzipSync(Buffer.from(encoded, 'base64url'));
  return (bytes[Math.floor(index / 8)] & (1 << (7 - (index % 8)))) !== 0;
}

export async function statusListCredential(baseUrl: string, listId: string) {
  return {
    '@context': ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/vc/status-list/2021/v1'],
    id: `${baseUrl}/api/credentials/status/${listId}`,
    type: ['VerifiableCredential', 'StatusList2021Credential'],
    issuer: process.env.ISSUER_DID ?? 'https://issuer.votain.local',
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      id: `${baseUrl}/api/credentials/status/${listId}#list`,
      type: 'StatusList2021',
      statusPurpose: 'revocation',
      encodedList: await encodedList(),
    },
  };
}
