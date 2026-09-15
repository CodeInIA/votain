import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The read-back proof, and the three different things it can mean.
 *
 * `enrollPrfPasskey` creates a credential and then asserts it once, to find out
 * whether this authenticator will hand the secret back on a LATER visit or only
 * while the credential is being made. Windows Hello does the second, and sealing
 * a phrase under one of those writes a vault entry nobody can ever open.
 *
 * The bug this file exists for: a DISMISSED prompt came back from `assertPrf` as
 * the same `null` an empty answer did, so closing the second dialog (which
 * arrives unannounced on a phone, seconds after the first) branded a perfectly
 * good passkey as useless. The voter was shown a modal telling them to delete a
 * credential that worked, and their phrase was written to disk in the clear.
 */

const create = vi.fn();
const get = vi.fn();

/** A credential whose creation carried the PRF secret, as a phone's does. */
function created(secretAtCreation: boolean) {
  return {
    rawId: new Uint8Array([1, 2, 3, 4]).buffer,
    getClientExtensionResults: () => ({
      prf: {
        enabled: true,
        ...(secretAtCreation ? { results: { first: new Uint8Array(32).fill(7).buffer } } : {}),
      },
    }),
  };
}

function asserted(withSecret: boolean) {
  return {
    rawId: new Uint8Array([1, 2, 3, 4]).buffer,
    getClientExtensionResults: () => ({
      prf: withSecret ? { results: { first: new Uint8Array(32).fill(7).buffer } } : {},
    }),
  };
}

beforeEach(() => {
  localStorage.clear();
  create.mockReset();
  get.mockReset();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('PublicKeyCredential', {
    isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
  });
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { create, get },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the read-back proof after creating a passkey', () => {
  it('does not brand a passkey unusable when the prompt is dismissed', async () => {
    const { enrollPrfPasskey, passkeyLeftUnusable, PasskeyCancelledError } =
      await import('./passkeyPrf');

    create.mockResolvedValue(created(true));
    // NotAllowedError is what a dismissed dialog throws. It is ALSO what a
    // platform that refuses the ceremony throws, and neither says the
    // credential is bad.
    get.mockRejectedValue(new DOMException('dismissed', 'NotAllowedError'));

    await expect(enrollPrfPasskey('voter')).rejects.toBeInstanceOf(PasskeyCancelledError);

    // The heart of it. This used to be the credential id, which is what put
    // "that passkey is no use here" in front of somebody whose passkey worked.
    expect(passkeyLeftUnusable()).toBeNull();
    // And nothing was concluded about the device either, so the next attempt
    // measures again instead of skipping to the fallback.
    expect(localStorage.getItem('votain_prf_readback')).toBeNull();
  });

  it('brands it unusable when the assertion answers with no secret', async () => {
    const { enrollPrfPasskey, passkeyLeftUnusable } = await import('./passkeyPrf');

    create.mockResolvedValue(created(true));
    // It answered. That is a verdict about the authenticator, not about the
    // person, and it is the one case where the warning is the truth.
    get.mockResolvedValue(asserted(false));

    await expect(enrollPrfPasskey('voter')).resolves.toBeNull();
    expect(passkeyLeftUnusable()).not.toBeNull();
  });

  it('clears an earlier suspicion once an assertion does return a secret', async () => {
    const { enrollPrfPasskey, passkeyLeftUnusable } = await import('./passkeyPrf');

    create.mockResolvedValue(created(true));
    get.mockResolvedValue(asserted(false));
    await expect(enrollPrfPasskey('voter')).resolves.toBeNull();
    expect(passkeyLeftUnusable()).not.toBeNull();

    // Linking again, and this time it reads back. Nothing used to clear the
    // flag, so the modal went on calling a working passkey rubbish for the
    // rest of the page's life.
    get.mockResolvedValue(asserted(true));
    const again = await enrollPrfPasskey('voter');

    expect(again).not.toBeNull();
    expect(passkeyLeftUnusable()).toBeNull();
  });
});

describe('retrying after a dismissed read-back', () => {
  it('asks the credential it already made instead of minting a second', async () => {
    const { enrollPrfPasskey, PasskeyCancelledError } = await import('./passkeyPrf');

    create.mockResolvedValue(created(true));
    get.mockRejectedValue(new DOMException('dismissed', 'NotAllowedError'));
    await expect(enrollPrfPasskey('voter')).rejects.toBeInstanceOf(PasskeyCancelledError);
    expect(create).toHaveBeenCalledTimes(1);

    // The retry. The passkey from the first attempt is on the authenticator and
    // is the one being asked about, so there is nothing to create: doing it
    // anyway left an unused credential behind on every hesitation.
    get.mockReset();
    get.mockResolvedValue(asserted(true));
    const assertion = await enrollPrfPasskey('voter');

    expect(assertion).not.toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('lets go after a second dismissal, so the next try can offer other authenticators', async () => {
    const { enrollPrfPasskey, pendingUnprovenPasskey, PasskeyCancelledError } =
      await import('./passkeyPrf');

    create.mockResolvedValue(created(true));
    get.mockRejectedValue(new DOMException('dismissed', 'NotAllowedError'));

    await expect(enrollPrfPasskey('voter')).rejects.toBeInstanceOf(PasskeyCancelledError);
    expect(pendingUnprovenPasskey()).not.toBeNull();

    // Dismissed again. Somebody cancelling twice on the credential this device
    // made may well be waiting for the option to use their phone, and holding
    // on to it would put the same prompt in front of them forever.
    await expect(enrollPrfPasskey('voter')).rejects.toBeInstanceOf(PasskeyCancelledError);
    expect(pendingUnprovenPasskey()).toBeNull();

    // So the next press goes the ordinary way, where the browser offers every
    // transport it has, the QR to a phone included.
    get.mockReset();
    get.mockResolvedValue(asserted(true));
    await expect(enrollPrfPasskey('voter')).resolves.not.toBeNull();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
