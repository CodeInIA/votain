import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Linking a SECOND passkey, which is the whole point of the list.
 *
 * `enrollThisDevice` used to return early when the credential id cached in this
 * browser was already registered. That answered a different question: it meant
 * "this browser's own passkey is in the list" and was read as "there is nothing
 * left to add". Pressing the button said "this device already holds one of your
 * passkeys" and stopped, so a voter could never add their phone, a second
 * laptop or a security key, and the one list standing between them and losing
 * their identity stayed a single point of failure.
 *
 * What prevents a duplicate is not a guard here: it is `excludeCredentials`.
 * The authenticator knows what it holds and refuses with InvalidStateError,
 * while the browser goes on offering every other transport.
 */

const { estado } = vi.hoisted(() => ({
  estado: {
    entradas: [] as string[],
    excluidos: null as null | string[],
  },
}));

vi.mock('./identityVault', () => ({
  fetchVault: async () => ({
    commitment: '123',
    entries: estado.entradas.map(id => ({ credentialId: id, blob: 'x', addedAt: '' })),
  }),
  putVaultEntry: async () => {},
  registerCommitment: async (commitment: string) => ({
    commitment,
    passkeyCount: 1,
    onchainRegistered: true,
  }),
  unwrapSecret: async () => null,
  wrapSecret: async () => 'cifrado',
}));

vi.mock('./passkeyPrf', async () => {
  const real = await vi.importActual<typeof import('./passkeyPrf')>('./passkeyPrf');
  return {
    ...real,
    prfReadbackFailed: () => false,
    prfReadbackProven: () => true,
    getCachedCredentialId: () => 'cred-de-este-navegador',
    assertPrf: async () => ({ credentialId: 'cred-de-este-navegador', secret: new Uint8Array(32) }),
    enrollPrfPasskey: async (_role: string, exclude: string[] = []) => {
      estado.excluidos = exclude;
      return { credentialId: 'cred-del-movil', secret: new Uint8Array(32).fill(9) };
    },
  };
});

describe('adding another passkey when this browser already registered one', () => {
  beforeEach(() => {
    localStorage.clear();
    estado.excluidos = null;
    estado.entradas = ['cred-de-este-navegador'];
    vi.resetModules();
  });

  it('asks the authenticator instead of refusing on our side', async () => {
    localStorage.setItem('votain_identity_mode', 'local');
    localStorage.setItem(
      'votain_recovery_phrase',
      'shelter drift canvas rosemary marble linen emerald eagle lilac glacier mineral hollow',
    );
    const { enrollThisDevice } = await import('./semaphore');

    const result = await enrollThisDevice();

    // The credential that answered is a NEW one: the phone, offered over the QR
    // transport because nothing on our side cut the attempt short.
    expect(result.credentialId).toBe('cred-del-movil');
    expect(result.alreadyRegistered).toBe(false);
    // And the one already registered was handed over as an exclusion, which is
    // what stops a duplicate without stopping everything else.
    expect(estado.excluidos).toEqual(['cred-de-este-navegador']);
  });
});
