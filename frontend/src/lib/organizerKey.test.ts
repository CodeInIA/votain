import { beforeEach, describe, expect, it } from 'vitest';
import type { Signer } from 'ethers';

import { clearOrganizerKeyCache, organizerMasterSecret, signsDeterministically } from './organizerKey';

/** A wallet stand-in whose signatures are fixed, or fresh every call. */
function wallet(address: string, deterministic: boolean): Signer & { prompts: number } {
  let counter = 0;
  const signer = {
    prompts: 0,
    getAddress: async () => address,
    provider: { getNetwork: async () => ({ chainId: 80002n }) },
    signTypedData: async () => {
      signer.prompts += 1;
      counter += 1;
      return '0x' + (deterministic ? 'ab' : counter.toString(16).padStart(2, '0')).repeat(65);
    },
  };
  return signer as unknown as Signer & { prompts: number };
}

beforeEach(() => {
  localStorage.clear();
  clearOrganizerKeyCache();
});

describe('signsDeterministically', () => {
  it('trusts a wallet that signs the same payload to the same bytes', async () => {
    const w = wallet('0x0000000000000000000000000000000000000001', true);
    expect(await signsDeterministically(w)).toBe(true);
    expect(w.prompts).toBe(2);
  });

  it('refuses one whose signatures change, which could never re-derive a key', async () => {
    const w = wallet('0x0000000000000000000000000000000000000002', false);
    expect(await signsDeterministically(w)).toBe(false);
  });

  it('asks once per wallet, not once per election', async () => {
    const w = wallet('0x0000000000000000000000000000000000000003', true);
    await signsDeterministically(w);
    await signsDeterministically(w);
    expect(w.prompts).toBe(2);
  });

  it('derives the same master secret from a deterministic wallet every time', async () => {
    const w = wallet('0x0000000000000000000000000000000000000004', true);
    const a = await organizerMasterSecret(w);
    clearOrganizerKeyCache();
    const b = await organizerMasterSecret(w);
    expect(a).toEqual(b);
  });
});
