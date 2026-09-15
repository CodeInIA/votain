import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Where a recovery phrase ends up, which is the most consequential branch in
 * the voter's side of this app.
 *
 * It used to write the words to localStorage FIRST and offer a passkey second,
 * so dismissing that prompt left them in the clear on disk while the screen
 * said "restored". The one outcome nobody would choose, reached by the one
 * gesture that says they did not want it.
 */

const { estado } = vi.hoisted(() => ({
  estado: {
    /** What the passkey enrolment does: seal, refuse, or be unable. */
    passkey: 'sella' as 'sella' | 'cancelada' | 'incapaz',
    sellado: false,
  },
}));

vi.mock('./passkeyPrf', async () => {
  const real = await vi.importActual<typeof import('./passkeyPrf')>('./passkeyPrf');
  return {
    ...real,
    prfReadbackFailed: () => false,
    prfReadbackProven: () => true,
    enrollPrfPasskey: async () => {
      if (estado.passkey === 'cancelada') throw new real.PasskeyCancelledError();
      if (estado.passkey === 'incapaz') return null;
      return { credentialId: 'cred', prfSecret: new Uint8Array(32) };
    },
  };
});

vi.mock('./identityVault', () => ({
  putVaultEntry: async () => { estado.sellado = true; },
  getVaultEntries: async () => [],
  wrapPhrase: async () => 'cifrado',
}));

describe('adoptRecoveryPhrase', () => {
  const frase = 'amber anchor apple arrow autumn bamboo beacon berry bishop bottle branch bridge';

  beforeEach(() => {
    localStorage.clear();
    estado.passkey = 'sella';
    estado.sellado = false;
    vi.resetModules();
  });

  /**
   * The point of the whole change. Someone who dismisses that prompt on a
   * shared computer means exactly what they did.
   */
  it('writes nothing at rest when the passkey is declined', async () => {
    estado.passkey = 'cancelada';
    const { adoptRecoveryPhrase } = await import('./semaphore');

    const { kept } = await adoptRecoveryPhrase(frase);

    expect(kept).toBe('session');
    expect(localStorage.getItem('votain_recovery_phrase')).toBeNull();
    expect(localStorage.getItem('votain_identity_mode')).toBeNull();
  });

  /**
   * A platform that CANNOT seal is the opposite case: without the fallback,
   * Windows has no way back in at all.
   */
  it('keeps the fallback when the authenticator cannot seal', async () => {
    estado.passkey = 'incapaz';
    const { adoptRecoveryPhrase } = await import('./semaphore');

    const { kept } = await adoptRecoveryPhrase(frase);

    expect(kept).toBe('stored');
    expect(localStorage.getItem('votain_recovery_phrase')).toBe(frase);
  });

  it('reports the identity either way, so the session still works', async () => {
    estado.passkey = 'cancelada';
    const { adoptRecoveryPhrase } = await import('./semaphore');

    const { identity } = await adoptRecoveryPhrase(frase);

    expect(identity.commitment).toBeTypeOf('bigint');
  });
});
