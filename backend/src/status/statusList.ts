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

import { getRegistryReader, getRegistryWriter, isRegistrarConfigured } from '../chain/registrar.js';

const LIST_SIZE_BITS = 131_072; // 16 KB bitstring, spec-recommended minimum
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

  // One call per slot handed out. Bounded by the number of registered humans,
  // and only paid when the cache has expired.
  const revoked = new Set<number>();
  for (let index = 1; index <= count; index++) {
    if (await registry.revokedStatus(index)) revoked.add(index);
  }
  return { revoked, count };
}

async function snapshot(): Promise<{ revoked: Set<number>; count: number }> {
  if (!isRegistrarConfigured()) return { revoked: new Set(), count: 0 };
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;

  const fresh = await readRevocations();
  cache = { ...fresh, at: Date.now() };
  return fresh;
}

/** Drops both caches, so a revocation made here is honoured immediately. */
export function refreshRevocations(): void {
  cache = null;
  slotCache.clear();
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

export async function revokeIndex(index: number): Promise<void> {
  if (!isRegistrarConfigured()) return;
  const tx = await getRegistryWriter().revokeStatus(index);
  await tx.wait();
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
  const { revoked } = await snapshot();
  const bytes = Buffer.alloc(LIST_SIZE_BITS / 8);
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
