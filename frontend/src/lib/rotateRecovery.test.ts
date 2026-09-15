import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Recovering without a passkey, and with a stale phrase in the way.
 *
 * Recovery used to demand a working passkey, because it called the contract's
 * `resetVault`, which refuses an empty vault entry. That made the ONE screen
 * that cannot fall back to the twelve words the one reached by people most
 * likely to be on a borrowed machine or on an authenticator that creates
 * credentials it will not evaluate. The rotation and the sealing are separate
 * events and only the second needs a passkey.
 */

const { estado } = vi.hoisted(() => ({
  estado: { recuperado: null as null | { commitment: string; credentialId?: string } },
}));

vi.mock('./identityVault', () => ({
  fetchVault: async () => null,
  putVaultEntry: async () => {},
  registerCommitment: async (commitment: string) => ({
    commitment,
    passkeyCount: 0,
    onchainRegistered: true,
  }),
  recoverIdentity: async (p: { commitment: string; credentialId?: string }) => {
    estado.recuperado = { commitment: p.commitment, credentialId: p.credentialId };
    return { commitment: p.commitment };
  },
  unwrapSecret: async () => null,
  wrapSecret: async () => 'cifrado',
}));

vi.mock('./passkeyPrf', async () => {
  const real = await vi.importActual<typeof import('./passkeyPrf')>('./passkeyPrf');
  return { ...real, enrollPrfPasskey: async () => null, assertPrf: async () => null };
});

const VIEJA =
  'shelter drift canvas rosemary marble linen emerald eagle lilac glacier mineral hollow';

describe('rotating to a new identity', () => {
  beforeEach(() => {
    localStorage.clear();
    estado.recuperado = null;
    vi.resetModules();
  });

  it('rotates with no passkey at all', async () => {
    const { rotateToNewIdentity } = await import('./semaphore');

    const { phrase, identity } = await rotateToNewIdentity({ proof: 'x' });

    expect(phrase.split(' ')).toHaveLength(12);
    // The request carries the commitment and NOTHING else: no credential, no
    // blob. The server clears the old entries and stops there.
    expect(estado.recuperado).toEqual({
      commitment: identity.commitment.toString(),
      credentialId: undefined,
    });
  });

  it('never reuses a phrase already sitting on this device', async () => {
    // The trap this exists for. `beginNewIdentity` REUSES a stored phrase, which
    // is right for a first-time voter (they must find the words they copied) and
    // wrong here: the words on this device belong to the identity being
    // abandoned, and on a shared browser they may not even be this person's.
    // Rotating onto a commitment whose phrase somebody else holds is the
    // opposite of a recovery.
    localStorage.setItem('votain_recovery_phrase', VIEJA);
    localStorage.setItem('votain_identity_mode', 'local');

    const { rotateToNewIdentity } = await import('./semaphore');
    const { phrase } = await rotateToNewIdentity({ proof: 'x' });

    expect(phrase).not.toBe(VIEJA);
    // And the stale copy is replaced, not left behind: `getOrCreateIdentity`
    // reads this slot first in "local" mode, so leaving it would hand back the
    // voter who was just revoked.
    expect(localStorage.getItem('votain_recovery_phrase')).toBe(phrase);
  });
});
