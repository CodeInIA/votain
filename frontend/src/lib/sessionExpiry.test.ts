import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  announceSessionExpired,
  msUntilExpiry,
  MAX_TIMER_MS,
  noticeUnauthorized,
  resetSessionExpiryNotice,
  SESSION_EXPIRED_EVENT,
} from './sessionExpiry';

/**
 * Noticing that a session has ended, which nothing used to do.
 *
 * `/api/me` was read once at mount and never again, so a credential that
 * expired while the tab was open left the interface offering a voter their
 * history and an enrol button, and the first sign of it was an action failing
 * for reasons that read like their fault.
 */

beforeEach(() => {
  resetSessionExpiryNotice();
});

describe('announcing an expired session', () => {
  it('tells whoever is listening', () => {
    const heard = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, heard);

    announceSessionExpired();

    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_EXPIRED_EVENT, heard);
  });

  it('says it once for a burst, not once per refusal', () => {
    // A screen that loads four authenticated things at once gets four 401s in
    // the same breath, and each one is the same news.
    const heard = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, heard);

    announceSessionExpired();
    announceSessionExpired();
    announceSessionExpired();

    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_EXPIRED_EVENT, heard);
  });

  it('can be said again after signing back in', () => {
    const heard = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, heard);

    announceSessionExpired();
    resetSessionExpiryNotice();
    announceSessionExpired();

    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener(SESSION_EXPIRED_EVENT, heard);
  });
});

describe('noticeUnauthorized', () => {
  it('only reacts to a 401', () => {
    const heard = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, heard);

    // A relayed ballot refused for a bad proof is a 400, and says nothing
    // about the session: it carries no cookie by design.
    expect(noticeUnauthorized(400)).toBe(false);
    expect(noticeUnauthorized(500)).toBe(false);
    expect(heard).not.toHaveBeenCalled();

    expect(noticeUnauthorized(401)).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_EXPIRED_EVENT, heard);
  });
});

describe('msUntilExpiry', () => {
  const now = 1_800_000_000_000; // ms

  it('reads seconds and answers in milliseconds', () => {
    // The claim is in seconds, the browser counts in milliseconds, and mixing
    // the two is the first thing this would get wrong.
    expect(msUntilExpiry(1_800_000_060, now)).toBe(60_000);
  });

  it('is zero for a credential that has already expired', () => {
    expect(msUntilExpiry(1_799_999_000, now)).toBe(0);
  });

  it('caps a distant expiry rather than overflowing the timer', () => {
    // setTimeout takes a 32-bit delay: anything beyond about 24.8 days fires
    // immediately, which would sign a voter out the moment they arrived.
    const sevenDays = now / 1000 + 7 * 24 * 60 * 60;

    expect(msUntilExpiry(sevenDays, now)).toBe(MAX_TIMER_MS);
    expect(MAX_TIMER_MS).toBeLessThan(2 ** 31 - 1);
  });

  it('answers null when the credential says nothing', () => {
    expect(msUntilExpiry(undefined, now)).toBeNull();
    expect(msUntilExpiry(Number.NaN, now)).toBeNull();
  });
});
