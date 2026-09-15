import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * What the voter is actually asked to prove.
 *
 * Silent configuration, and the kind that decays without anybody noticing: the
 * request still succeeds when it asks for the wrong thing, it just lets in the
 * wrong people or turns away the right ones. These pin the two decisions that
 * matter and would otherwise live only in a comment.
 */

const { peticiones } = vi.hoisted(() => ({
  peticiones: [] as Array<{ config: Record<string, unknown>; restricciones: unknown }>,
}));

vi.mock('@worldcoin/idkit-core', () => ({
  IDKit: {
    // El constructor es SÍNCRONO: `IDKit.request({...}).constraints(...)`, y el
    // await envuelve la expresión entera.
    request: (config: Record<string, unknown>) => ({
      preset: (restricciones: unknown) => {
        peticiones.push({ config, restricciones });
        return Promise.resolve({
          connectorURI: 'wc:prueba',
          pollUntilCompletion: async () => ({ success: false }),
        });
      },
    }),
  },
  deviceLegacy: (opciones: unknown) => ({ preset: 'deviceLegacy', opciones }),
}));

vi.mock('./backend', () => ({ backendBase: () => 'https://emisor.test' }));

describe('World ID request', () => {
  beforeEach(() => {
    peticiones.length = 0;
    vi.stubEnv('VITE_WORLD_ID_APP_ID', 'app_prueba');
    vi.stubEnv('VITE_WORLD_ID_RP_ID', 'rp_prueba');
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ sig: '0x', nonce: 'n', created_at: 1, expires_at: 2 }),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /**
   * World ID 4.0 has no device credential and no successor that means the
   * same thing, and in Spain a voter can hold none of the four it does know:
   * Orbs withdrawn, no document credential issued here, selfie access-gated.
   * Cutting over today would lock out very nearly every voter, so the legacy
   * preset stays and this is what says so out loud.
   */
  it('still accepts a 3.0 proof, because 4.0 offers Spain nothing to hold', async () => {
    const { requestWorldIdProof } = await import('./worldId');
    await requestWorldIdProof();

    expect(peticiones[0].config.allow_legacy_proofs).toBe(true);
  });

  /**
   * The floor, deliberately. Asking for more at the door would turn away the
   * voters this exists for; an election that needs an Orb asks at ENROLLMENT,
   * where a refusal costs one election rather than the whole account.
   */
  it('asks for the lowest credential, not for personhood', async () => {
    const { requestWorldIdProof } = await import('./worldId');
    await requestWorldIdProof();

    expect(peticiones[0].restricciones).toEqual({ preset: 'deviceLegacy', opciones: {} });
  });
});
