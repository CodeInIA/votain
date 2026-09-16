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
    /**
     * What the registry says about the commitment a phrase rebuilds.
     *
     * `sin-cadena` by default, which is the seed mode every other test in
     * this file was written under: no chain to ask, so nothing is refused.
     */
    registro: 'sin-cadena' as 'sin-cadena' | 'conocido' | 'desconocido' | 'error',
  },
}));

vi.mock('./deployments', async () => {
  const real = await vi.importActual<typeof import('./deployments')>('./deployments');
  return { ...real, isChainConfigured: () => estado.registro !== 'sin-cadena' };
});

vi.mock('./contracts', () => ({
  getRegistry: () => ({
    verifiedMembers: async () => {
      if (estado.registro === 'error') throw new Error('rpc down');
      return estado.registro === 'conocido';
    },
  }),
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
      // `PrfAssertion` is `{ credentialId, secret }`, not `prfSecret`.
      return { credentialId: 'cred', secret: new Uint8Array(32) };
    },
  };
});

/**
 * Named as the real module names them, which was not true before.
 *
 * The old mock offered `wrapPhrase`, and sealing calls `wrapSecret`, so any
 * test that got as far as sealing would have thrown and been caught as
 * "stored". None did, so the gap sat there until one was written.
 */
vi.mock('./identityVault', async () => {
  const real = await vi.importActual<typeof import('./identityVault')>('./identityVault');
  return {
    ...real,
    putVaultEntry: async () => { estado.sellado = true; },
    getVaultEntries: async () => [],
    wrapSecret: async () => 'cifrado',
    registerCommitment: async () => undefined,
  };
});

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
   *
   * It moved with the prompt. Taking the identity on and deciding where the
   * words live are two steps now, so the cancelled case belongs to the second
   * one: see `sealRecoveredPhrase` below.
   */
  it('writes no words at rest, because it no longer decides where they go', async () => {
    const { adoptRecoveryPhrase } = await import('./semaphore');

    await adoptRecoveryPhrase(frase);

    expect(localStorage.getItem('votain_recovery_phrase')).toBeNull();
    expect(localStorage.getItem('votain_identity_mode')).toBeNull();
  });

  it('asks for no passkey at all', async () => {
    // The gap this closes: finishing the last word of a phrase used to summon
    // an authenticator dialog, with no warning and nothing said about what it
    // was holding.
    estado.passkey = 'cancelada';
    const { adoptRecoveryPhrase } = await import('./semaphore');

    // A cancelled prompt would have thrown. Nothing is prompted, so nothing
    // can be cancelled.
    const { identity } = await adoptRecoveryPhrase(frase);
    expect(identity.commitment).toBeDefined();
  });

  it('reports the identity, so the session works before step two', async () => {
    estado.passkey = 'cancelada';
    const { adoptRecoveryPhrase } = await import('./semaphore');

    const { identity } = await adoptRecoveryPhrase(frase);

    expect(identity.commitment).toBeTypeOf('bigint');
  });
});

describe('a phrase that rebuilds nobody', () => {
  /**
   * The gap this closes. `isValidPhrase` only ever checked the SHAPE of a
   * phrase, so twelve words picked off the list derived a perfectly good
   * Semaphore identity and were adopted in silence. One mistyped word handed
   * the voter a brand new identity enrolled in nothing, and every election
   * then told them they were not a member with no way back.
   */
  const frase = 'amber anchor apple arrow autumn bamboo beacon berry bishop bottle branch bridge';

  beforeEach(() => {
    localStorage.clear();
    estado.passkey = 'sella';
    estado.sellado = false;
    estado.registro = 'sin-cadena';
    vi.resetModules();
  });

  it('is refused when the registry has never seen it', async () => {
    estado.registro = 'desconocido';
    const { adoptRecoveryPhrase, PhraseNotRegisteredError } = await import('./semaphore');

    await expect(adoptRecoveryPhrase(frase)).rejects.toBeInstanceOf(PhraseNotRegisteredError);
  });

  it('writes nothing to the device when it is refused', async () => {
    // Checked before anything is remembered. Adopting first and asking after
    // would leave the wrong identity on this browser.
    estado.registro = 'desconocido';
    const { adoptRecoveryPhrase } = await import('./semaphore');

    await expect(adoptRecoveryPhrase(frase)).rejects.toThrow();
    expect(localStorage.getItem('votain_recovery_phrase')).toBeNull();
    expect(localStorage.getItem('votain_identity_commitment')).toBeNull();
    expect(estado.sellado).toBe(false);
  });

  it('is accepted when the registry knows it', async () => {
    estado.registro = 'conocido';
    const { adoptRecoveryPhrase } = await import('./semaphore');

    const { identity } = await adoptRecoveryPhrase(frase);
    expect(identity.commitment).toBeDefined();
  });

  it('does not lock anyone out when the registry cannot be reached', async () => {
    // A voter with the right words and a bad connection must not be refused
    // their own identity by a check that exists to protect them.
    estado.registro = 'error';
    const { adoptRecoveryPhrase } = await import('./semaphore');

    const { identity } = await adoptRecoveryPhrase(frase);
    expect(identity.commitment).toBeDefined();
  });

  it('asks nothing at all with no chain configured', async () => {
    estado.registro = 'sin-cadena';
    const { adoptRecoveryPhrase } = await import('./semaphore');

    const { identity } = await adoptRecoveryPhrase(frase);
    expect(identity.commitment).toBeDefined();
  });
});

describe('where a recovered phrase ends up', () => {
  /**
   * The second step, which is where this decision lives now. Same outcomes as
   * before, asked for out loud instead of behind a dialog nobody expected.
   */
  const frase = 'amber anchor apple arrow autumn bamboo beacon berry bishop bottle branch bridge';

  beforeEach(() => {
    localStorage.clear();
    estado.passkey = 'sella';
    estado.sellado = false;
    estado.registro = 'sin-cadena';
    vi.resetModules();
  });

  it('seals the words under the passkey when one can hold them', async () => {
    const { adoptRecoveryPhrase, sealRecoveredPhrase } = await import('./semaphore');
    const { identity } = await adoptRecoveryPhrase(frase);

    expect(await sealRecoveredPhrase(frase, identity)).toBe('sealed');
    expect(estado.sellado).toBe(true);
  });

  it('leaves the prompt to be cancelled, rather than swallowing it', async () => {
    // Dismissing it is a decision and the screen has to react to it, so the
    // error travels instead of being turned into an outcome down here.
    estado.passkey = 'cancelada';
    const { adoptRecoveryPhrase, sealRecoveredPhrase } = await import('./semaphore');
    const { PasskeyCancelledError } = await import('./passkeyPrf');
    const { identity } = await adoptRecoveryPhrase(frase);

    await expect(sealRecoveredPhrase(frase, identity)).rejects.toBeInstanceOf(PasskeyCancelledError);
    // And nothing was written, which is what the voter asked for.
    expect(localStorage.getItem('votain_recovery_phrase')).toBeNull();
  });

  it('keeps the fallback when the authenticator cannot seal', async () => {
    // Windows Hello genuinely cannot do this, and somebody there still has to
    // be able to vote.
    estado.passkey = 'incapaz';
    const { adoptRecoveryPhrase, sealRecoveredPhrase } = await import('./semaphore');
    const { identity } = await adoptRecoveryPhrase(frase);

    expect(await sealRecoveredPhrase(frase, identity)).toBe('stored');
    expect(localStorage.getItem('votain_recovery_phrase')).toBe(frase);
  });

  it('keeps them on the device when that is what was chosen', async () => {
    const { adoptRecoveryPhrase, keepRecoveredPhraseOnDevice } = await import('./semaphore');
    await adoptRecoveryPhrase(frase);

    expect(keepRecoveredPhraseOnDevice(frase)).toBe('stored');
    expect(localStorage.getItem('votain_recovery_phrase')).toBe(frase);
    expect(localStorage.getItem('votain_identity_mode')).toBe('local');
  });
});
