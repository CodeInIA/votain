/**
 * Encrypted voter preferences, stored on chain.
 *
 * Today that means the elections a voter saved to come back to. This server
 * moves the blob and never reads it: the key is derived from the voter's own
 * Semaphore secret, which lives in their browser and in their authenticator,
 * and which this process has never held.
 *
 * WHY THE CHAIN AND NOT A FILE, in one line, because `vault.ts` argues it in
 * full: the issuer has no database, and what a settings store has to provide is
 * availability. `PlatformRegistry` already holds the ciphertext of the identity
 * itself for the same reason, and a blob nobody can read adds no authority to
 * it. A swapped blob decrypts to nothing, and the browser says so.
 *
 * WHAT THE PLATFORM STILL LEARNS, which is the honest limit of this design: the
 * size of a voter's settings and when they changed. Not their contents. The
 * relayer is the only account that can write, so it also learns that a change
 * happened when it submits one, which is the same thing the chain records.
 *
 * Env: as `chain/registrar.ts`.
 */
import { getRegistryReader, isRegistrarConfigured, writeRegistry } from '../chain/registrar.js';
import { toHex, fromHex, VaultUnavailableError } from './vault.js';

/**
 * The contract's own ceiling, repeated here so a request that cannot fit is
 * refused with a message instead of a reverted transaction.
 *
 * Kept in sync with `PlatformRegistry.MAX_PREFERENCES_BYTES` by the test below
 * it in spirit and by the contract in fact: if they ever disagree, the chain
 * wins and the caller sees a revert, which is the safe direction to be wrong in.
 */
export const MAX_PREFERENCES_BYTES = 4096;

export class PreferencesTooLargeError extends Error {
  constructor() {
    super(`Preferences must be at most ${MAX_PREFERENCES_BYTES} bytes`);
    this.name = 'PreferencesTooLargeError';
  }
}

/**
 * How many bytes a base64url payload carries.
 *
 * Counted from the encoding rather than by decoding, because the number is
 * wanted BEFORE the bytes are trusted: this is the check that stops an
 * oversized body, so it must not start by allocating it.
 */
export function blobByteLength(base64url: string): number {
  const padding = base64url.endsWith('==') ? 2 : base64url.endsWith('=') ? 1 : 0;
  return Math.floor((base64url.length * 3) / 4) - padding;
}

/** Whether the string is base64url and nothing else. */
export function isBase64Url(value: string): boolean {
  return /^[A-Za-z0-9_-]*=*$/.test(value);
}

function requireChain(): void {
  if (!isRegistrarConfigured()) throw new VaultUnavailableError();
}

/**
 * This human's sealed settings, or an empty string when they have none.
 *
 * Empty and absent are deliberately the same answer. A voter who has saved
 * nothing and a voter who cleared everything are in the same state, and the
 * browser has nothing different to do about them.
 */
export async function getPreferences(nullifier: string): Promise<string> {
  requireChain();
  const registry = getRegistryReader();
  const hex: string = await registry.preferencesOf(nullifier);
  return hex && hex !== '0x' ? fromHex(hex) : '';
}

/**
 * Replaces this human's sealed settings.
 *
 * REPLACES, because the store cannot merge what it cannot read. Two devices
 * reconciling their lists is the browser's job, done on the plaintext, and what
 * arrives here is already the answer.
 */
export async function setPreferences(nullifier: string, blob: string): Promise<void> {
  requireChain();
  if (blobByteLength(blob) > MAX_PREFERENCES_BYTES) throw new PreferencesTooLargeError();

  await writeRegistry(r => r.setPreferences(nullifier, toHex(blob)));
}
