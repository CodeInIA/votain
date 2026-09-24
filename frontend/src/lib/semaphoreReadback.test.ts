/**
 * Sealing the phrase under a passkey is not proof that it can be read back.
 *
 * Chrome and Firefox on Windows evaluate the PRF extension while a credential
 * is being CREATED and refuse to evaluate it on an assertion. So enrolment
 * succeeds, the vault entry is written correctly, and every later attempt to
 * open it fails. The code used to delete the local copy of the phrase the
 * moment the seal succeeded, which left a voter locked out of their own phrase
 * on the device that had just generated it, with a Windows dialog saying only
 * "there was a problem signing in with your passkey".
 *
 * The identity must survive that, without a prompt, and without ever becoming a
 * different identity. That is what these tests hold.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchVault = vi.fn();
const putVaultEntry = vi.fn();
const assertPrf = vi.fn();
const enrollPrfPasskey = vi.fn();

vi.mock('./identityVault', async () => {
  const actual = await vi.importActual<typeof import('./identityVault')>('./identityVault');
  return {
    ...actual,
    fetchVault: (...a: unknown[]) => fetchVault(...a),
    putVaultEntry: (...a: unknown[]) => putVaultEntry(...a),
    // Stubbed rather than spread through: the real one reaches for the backend,
    // and a first-time voter with no passkey now registers on the way past.
    registerCommitment: async (commitment: string) => ({
      commitment,
      passkeyCount: 0,
      onchainRegistered: true,
    }),
  };
});

vi.mock('./passkeyPrf', async () => {
  const actual = await vi.importActual<typeof import('./passkeyPrf')>('./passkeyPrf');
  return {
    ...actual,
    // The real `assertPrf` records the read-back verdict as a side effect of
    // producing a secret, because that is the only place it is ever proven.
    // A mock that skips it would let these tests pass against code that never
    // records anything.
    assertPrf: async (...a: unknown[]) => {
      const result = await assertPrf(...a);
      if (result) localStorage.setItem('votain_prf_readback', 'ok');
      return result;
    },
    enrollPrfPasskey: (...a: unknown[]) => enrollPrfPasskey(...a),
    getCachedCredentialId: () => 'cred-1',
  };
});

const SECRET = new Uint8Array(32).fill(3);
const PHRASE_KEY = 'votain_recovery_phrase';
const MODE_KEY = 'votain_identity_mode';
const READBACK_KEY = 'votain_prf_readback';

/** A fresh module, so the in-memory identity cache does not answer for us. */
async function freshSemaphore() {
  vi.resetModules();
  return import('./semaphore');
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('a device that can seal but not read back', () => {
  it('keeps the local phrase when the seal is all that succeeded', async () => {
    // First enrolment: no vault entries yet, and the authenticator hands back a
    // secret at CREATION, which is what Windows does.
    fetchVault.mockResolvedValue({ entries: [], commitment: null });
    enrollPrfPasskey.mockResolvedValue({ credentialId: 'cred-1', secret: SECRET });
    putVaultEntry.mockResolvedValue(undefined);

    const sem = await freshSemaphore();
    // Two explicit calls, which is the point: minting the phrase and creating a
    // passkey are separate now, with the voter's twelve words on screen in
    // between. Nothing here happens as a side effect of signing in.
    const { phrase, identity } = await sem.beginNewIdentity();
    await sem.completeWithPasskey(phrase, identity);

    expect(putVaultEntry).toHaveBeenCalled(); // the seal did happen
    expect(localStorage.getItem(MODE_KEY)).toBe('prf');
    // The part that matters: the words are still reachable on this device.
    const kept = localStorage.getItem(PHRASE_KEY);
    expect(kept).toBeTruthy();
    expect(kept!.split(' ')).toHaveLength(12);
    expect(identity.commitment).toBeTruthy();
  });

  it('comes back as the SAME voter after a reload, with no prompt that can work', async () => {
    fetchVault.mockResolvedValue({ entries: [], commitment: null });
    enrollPrfPasskey.mockResolvedValue({ credentialId: 'cred-1', secret: SECRET });
    putVaultEntry.mockResolvedValue(undefined);

    const first = await freshSemaphore();
    const minted = await first.beginNewIdentity();
    await first.completeWithPasskey(minted.phrase, minted.identity);
    const before = minted.identity.commitment;

    // Reload. The vault now has an entry, and the assertion returns nothing,
    // which is exactly what that platform does.
    fetchVault.mockResolvedValue({
      entries: [{ credentialId: 'cred-1', blob: 'unopenable', addedAt: Date.now() }],
      commitment: before.toString(),
    });
    assertPrf.mockResolvedValue(null);

    const second = await freshSemaphore();
    const after = (await second.getOrCreateIdentity()).commitment;

    expect(after).toBe(before); // never a second identity
    expect(localStorage.getItem(READBACK_KEY)).toBe('failed');
  });

  it('stops asking the authenticator once it has been shown to fail', async () => {
    localStorage.setItem(MODE_KEY, 'prf');
    localStorage.setItem(READBACK_KEY, 'failed');
    localStorage.setItem(
      PHRASE_KEY,
      'salad acorn radar bagel tulip vapor wafer yeast zebra blimp cider dwarf',
    );

    const sem = await freshSemaphore();
    await sem.getOrCreateIdentity();

    // No dialog that ends in "something went wrong", on every page load, forever.
    expect(assertPrf).not.toHaveBeenCalled();
    expect(fetchVault).not.toHaveBeenCalled();
  });

  it('summons no authenticator until the voter asks for one', async () => {
    // Minting the phrase is free of prompts, and that is what lets a screen show
    // the twelve words BEFORE anything reaches for a fingerprint. It used to be
    // one call: the passkey dialog arrived first, unannounced, and the words
    // afterwards as a receipt.
    fetchVault.mockResolvedValue({ entries: [], commitment: null });

    const sem = await freshSemaphore();
    const { phrase, identity } = await sem.beginNewIdentity();

    expect(enrollPrfPasskey).not.toHaveBeenCalled();
    expect(putVaultEntry).not.toHaveBeenCalled();
    expect(phrase.split(' ')).toHaveLength(12);
    expect(identity.commitment).toBeTruthy();
  });

  it('gives back the same words to somebody who left and came back', async () => {
    // Whoever copied twelve words onto paper must find THOSE words again.
    // Minting afresh would quietly turn what they wrote down into a stranger.
    fetchVault.mockResolvedValue({ entries: [], commitment: null });

    const first = await freshSemaphore();
    const one = await first.beginNewIdentity();

    const second = await freshSemaphore();
    const two = await second.beginNewIdentity();

    expect(two.phrase).toBe(one.phrase);
    expect(two.identity.commitment).toBe(one.identity.commitment);
  });

  it('hands the phrase straight back when it is held locally', async () => {
    const words =
      'salad acorn radar bagel tulip vapor wafer yeast zebra blimp cider dwarf';
    localStorage.setItem(MODE_KEY, 'prf');
    localStorage.setItem(READBACK_KEY, 'failed');
    localStorage.setItem(PHRASE_KEY, words);

    const sem = await freshSemaphore();

    expect(await sem.revealRecoveryPhrase()).toBe(words);
    expect(assertPrf).not.toHaveBeenCalled();
  });
});

describe('a device that can read back', () => {
  it('drops the local copy, because nothing should be at rest that need not be', async () => {
    // The vault opens: the blob is a real sealed phrase, so seal then reload.
    fetchVault.mockResolvedValue({ entries: [], commitment: null });
    enrollPrfPasskey.mockResolvedValue({ credentialId: 'cred-1', secret: SECRET });

    let sealed: string | undefined;
    putVaultEntry.mockImplementation((entry: { blob: string }) => {
      sealed = entry.blob;
      return Promise.resolve();
    });

    const first = await freshSemaphore();
    const minted = await first.beginNewIdentity();
    await first.completeWithPasskey(minted.phrase, minted.identity);
    const before = minted.identity.commitment;
    expect(sealed).toBeTruthy();

    fetchVault.mockResolvedValue({
      entries: [{ credentialId: 'cred-1', blob: sealed!, addedAt: Date.now() }],
      commitment: before.toString(),
    });
    assertPrf.mockResolvedValue({ credentialId: 'cred-1', secret: SECRET });

    const second = await freshSemaphore();
    const after = (await second.getOrCreateIdentity()).commitment;

    expect(after).toBe(before);
    expect(localStorage.getItem(READBACK_KEY)).toBe('ok');
    expect(localStorage.getItem(PHRASE_KEY)).toBeNull();
  });
});

describe('linking a passkey to a phrase that was already here', () => {
  /**
   * The case a voter reported: set up without a passkey, later added one from
   * their profile over a QR code to their phone, and the twelve words were
   * still sitting in this browser afterwards.
   *
   * The seal had worked. What never ran was the bookkeeping that says the
   * identity now lives behind a passkey and the copy at rest can go: the
   * button calls `enrollThisDevice`, and the only code that did that
   * bookkeeping was a wrapper with no callers.
   */
  it('lets the local copy go once the passkey can open it', async () => {
    const sem = await freshSemaphore();
    const minted = await sem.beginNewIdentity();
    await sem.completeWithoutPasskey(minted.phrase, minted.identity);

    expect(localStorage.getItem(MODE_KEY)).toBe('local');
    expect(localStorage.getItem(PHRASE_KEY)).toBeTruthy();

    // The link. The real `enrollPrfPasskey` proves the read-back before it
    // returns an assertion, and records that proof; the mock says so too,
    // because the decision to drop the copy is made from that record.
    fetchVault.mockResolvedValue({ entries: [], commitment: minted.identity.commitment.toString() });
    enrollPrfPasskey.mockImplementation(async () => {
      localStorage.setItem(READBACK_KEY, 'ok');
      return { credentialId: 'cred-phone', secret: SECRET };
    });
    putVaultEntry.mockResolvedValue(undefined);

    await sem.enrollThisDevice();

    expect(putVaultEntry).toHaveBeenCalled();
    expect(localStorage.getItem(MODE_KEY)).toBe('prf');
    expect(localStorage.getItem(PHRASE_KEY)).toBeNull();
  });

  it('keeps it when the passkey seals but cannot be read back', async () => {
    // Windows again, through the same door: the vault entry is written and
    // nothing on this machine can open it, so the words stay where they are.
    const sem = await freshSemaphore();
    const minted = await sem.beginNewIdentity();
    await sem.completeWithoutPasskey(minted.phrase, minted.identity);

    fetchVault.mockResolvedValue({ entries: [], commitment: minted.identity.commitment.toString() });
    enrollPrfPasskey.mockResolvedValue({ credentialId: 'cred-1', secret: SECRET });
    putVaultEntry.mockResolvedValue(undefined);

    await sem.enrollThisDevice();

    expect(localStorage.getItem(MODE_KEY)).toBe('prf');
    expect(localStorage.getItem(PHRASE_KEY)).toBeTruthy();
  });

  it('lets it go when the authenticator already held the passkey', async () => {
    // Adding one this authenticator already has: it refuses with
    // InvalidStateError and the app asserts instead, which opens the entry the
    // vault already holds. That is the same proof by another route.
    const sem = await freshSemaphore();
    const minted = await sem.beginNewIdentity();
    await sem.completeWithoutPasskey(minted.phrase, minted.identity);

    fetchVault.mockResolvedValue({
      entries: [{ credentialId: 'cred-1', blob: 'sealed', addedAt: Date.now() }],
      commitment: minted.identity.commitment.toString(),
    });
    const { PasskeyAlreadyRegisteredError } = await import('./passkeyPrf');
    enrollPrfPasskey.mockRejectedValue(new PasskeyAlreadyRegisteredError());
    assertPrf.mockImplementation(async () => {
      localStorage.setItem(READBACK_KEY, 'ok');
      return { credentialId: 'cred-1', secret: SECRET };
    });

    const result = await sem.enrollThisDevice();

    expect(result.alreadyRegistered).toBe(true);
    expect(localStorage.getItem(MODE_KEY)).toBe('prf');
    expect(localStorage.getItem(PHRASE_KEY)).toBeNull();
  });
});
