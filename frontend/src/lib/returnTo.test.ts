import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { forgetReturnTo, rememberReturnTo, takeReturnTo } from './returnTo';

/**
 * Coming back to the election somebody was sent away from.
 *
 * The flow this serves crosses four screens and ends in a `replace`, so the
 * intent cannot ride on the navigation. What it can do instead is outlive the
 * whole trip, which is exactly why it has to be taken rather than read: a
 * destination left behind would fire again on some unrelated sign in weeks
 * later and drop that person on an election with no explanation.
 */

describe('remembering where to come back to', () => {
  beforeEach(() => sessionStorage.clear());

  it('hands the path back once and then forgets it', () => {
    rememberReturnTo('/election/0xabc');
    expect(takeReturnTo()).toBe('/election/0xabc');
    // The second caller gets nothing, which is what stops a stale
    // destination ambushing a later sign in.
    expect(takeReturnTo()).toBeNull();
  });

  it('has nothing to say when nobody was sent anywhere', () => {
    expect(takeReturnTo()).toBeNull();
  });

  it('keeps only the most recent intent', () => {
    rememberReturnTo('/election/0xone');
    rememberReturnTo('/election/0xtwo');
    expect(takeReturnTo()).toBe('/election/0xtwo');
  });

  it('can be dropped without being followed', () => {
    rememberReturnTo('/election/0xabc');
    forgetReturnTo();
    expect(takeReturnTo()).toBeNull();
  });
});

describe('what it refuses to remember', () => {
  beforeEach(() => sessionStorage.clear());

  it('turns away anything that could leave the site', () => {
    // The value is fed to `navigate`, and `//host` is a protocol-relative
    // URL: stored and followed, it would take the person off Votain in the
    // middle of signing up. Refused on the way in rather than trusted on the
    // way out.
    for (const hostile of ['//evil.example', 'https://evil.example', '\\\\evil.example', 'javascript:alert(1)']) {
      rememberReturnTo(hostile);
      expect(takeReturnTo()).toBeNull();
    }
  });

  it('turns away a path that is not one', () => {
    rememberReturnTo('election/0xabc');
    expect(takeReturnTo()).toBeNull();
  });

  it('refuses a hostile value that was already in the store', () => {
    // Nothing else writes this key, but the check is on both sides anyway:
    // session storage is the page's own and anything running in it could.
    sessionStorage.setItem('votain_return_to', '//evil.example');
    expect(takeReturnTo()).toBeNull();
  });
});

describe('when the browser will not store anything', () => {
  afterEach(() => vi.restoreAllMocks());

  it('gives up quietly rather than taking the page down', () => {
    // Private mode, or site data blocked. Landing on the list instead of the
    // election is a worse ending, not a broken one, and a sign up that
    // throws here would be much worse than either.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => rememberReturnTo('/election/0xabc')).not.toThrow();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(takeReturnTo()).toBeNull();
  });
});
