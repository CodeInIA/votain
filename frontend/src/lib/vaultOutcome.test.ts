import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Telling "new voter" apart from "registered, with nothing here to open it".
 *
 * The vault carries the commitment this voter enrolled with, and for a long
 * time only the entry list was read. An empty list was taken to mean new, so a
 * voter who had registered and never sealed a phrase under a passkey (the
 * ordinary state on a device that can create one and never evaluate it) was
 * quietly handed a SECOND identity, with a commitment the registry had never
 * heard of. Nothing failed until an enrolment was refused, much later, for
 * reasons that named none of this.
 */

const { vault } = vi.hoisted(() => ({
  vault: {
    estado: null as null | { commitment: string | null; entries: unknown[] },
    registrado: [] as string[],
  },
}));

vi.mock('./identityVault', () => ({
  fetchVault: async () => vault.estado,
  putVaultEntry: async () => {},
  registerCommitment: async (commitment: string) => {
    vault.registrado.push(commitment);
    return { commitment, passkeyCount: 0, onchainRegistered: true };
  },
  unwrapSecret: async () => null,
  wrapPhrase: async () => 'cifrado',
}));

vi.mock('./passkeyPrf', async () => {
  const real = await vi.importActual<typeof import('./passkeyPrf')>('./passkeyPrf');
  return {
    ...real,
    prfReadbackFailed: () => false,
    prfReadbackProven: () => false,
    assertPrf: async () => null,
    enrollPrfPasskey: async () => null,
  };
});

describe('resolving an identity from the vault', () => {
  beforeEach(() => {
    localStorage.clear();
    vault.registrado = [];
    vi.resetModules();
  });

  it('refuses to mint a second identity for a voter who is already registered', async () => {
    // Registered, and no passkey ever held a copy: the Windows case exactly.
    vault.estado = { commitment: '12345', entries: [] };
    const { getOrCreateIdentity, IdentityLockedError } = await import('./semaphore');

    // Locked, not "new". The phrase is the only way back and the screen has to
    // say so, rather than quietly making them somebody else.
    await expect(getOrCreateIdentity()).rejects.toBeInstanceOf(IdentityLockedError);
  });

  it('refuses to invent an identity for a voter who has none', async () => {
    vault.estado = { commitment: null, entries: [] };
    const { getOrCreateIdentity, IdentityNotSetUpError } = await import('./semaphore');

    // It used to mint one here: a phrase written to disk and an identity handed
    // back, from a call some screen had made for an unrelated reason, trusting a
    // modal elsewhere to show the words. Every silent mint is a voter who can be
    // locked out by one cleared browser without ever having been given the way
    // back. Setting up is now somewhere a voter GOES.
    await expect(getOrCreateIdentity()).rejects.toBeInstanceOf(IdentityNotSetUpError);
    expect(localStorage.getItem('votain_recovery_phrase')).toBeNull();
    expect(vault.registrado).toEqual([]);
  });

  it('registers a voter who finishes the setup without a passkey', async () => {
    vault.estado = { commitment: null, entries: [] };
    const { beginNewIdentity, completeWithoutPasskey } = await import('./semaphore');

    const { phrase, identity } = await beginNewIdentity();
    const result = await completeWithoutPasskey(phrase, identity);

    // BEING ON THE REGISTRY DOES NOT DEPEND ON HOLDING A PASSKEY. Welding the
    // two together left anyone whose authenticator refused off the chain
    // entirely, to find out weeks later when an enrolment was rejected for
    // reasons that named none of it.
    expect(result.kept).toBe('stored');
    expect(vault.registrado).toEqual([identity.commitment.toString()]);
    expect(localStorage.getItem('votain_recovery_phrase')).toBe(phrase);
  });
});
