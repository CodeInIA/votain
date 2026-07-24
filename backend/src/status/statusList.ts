/**
 * W3C Status List 2021 (revocation) — file-backed bitstring.
 *
 * Every issued VC gets a `credentialStatus` entry pointing at this list and a
 * unique bit index. Flipping the bit revokes the credential. Verifiers fetch
 * the list (a signed credential embedding the gzip+base64url bitstring) and
 * check their credential's bit.
 */
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIST_SIZE_BITS = 131_072; // 16 KB bitstring, spec-recommended minimum
export const DEFAULT_LIST_ID = 'voters-1';

const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'status-list.json');

interface StatusListState {
  nextIndex: number;
  /** Revoked bit indexes. */
  revoked: number[];
}

function load(): StatusListState {
  if (!existsSync(DATA_FILE)) return { nextIndex: 0, revoked: [] };
  return JSON.parse(readFileSync(DATA_FILE, 'utf-8')) as StatusListState;
}

function save(state: StatusListState): void {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

/** Allocates the next free bit index for a newly issued credential. */
export function allocateIndex(): number {
  const state = load();
  const index = state.nextIndex;
  state.nextIndex += 1;
  save(state);
  return index;
}

export function revokeIndex(index: number): void {
  const state = load();
  if (!state.revoked.includes(index)) {
    state.revoked.push(index);
    save(state);
  }
}

export function isRevoked(index: number): boolean {
  return load().revoked.includes(index);
}

/** gzip+base64url bitstring with revoked bits set, per StatusList2021. */
export function encodedList(): string {
  const state = load();
  const bytes = Buffer.alloc(LIST_SIZE_BITS / 8);
  for (const index of state.revoked) {
    bytes[Math.floor(index / 8)] |= 1 << (7 - (index % 8));
  }
  return gzipSync(bytes).toString('base64url');
}

/** Decodes an encodedList and checks one bit (used by tests/verifiers). */
export function checkBit(encoded: string, index: number): boolean {
  const bytes = gunzipSync(Buffer.from(encoded, 'base64url'));
  return (bytes[Math.floor(index / 8)] & (1 << (7 - (index % 8)))) !== 0;
}

export function statusListCredential(baseUrl: string, listId: string) {
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
      encodedList: encodedList(),
    },
  };
}
