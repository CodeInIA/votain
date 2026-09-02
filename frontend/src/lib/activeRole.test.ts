import { describe, it, expect, beforeEach } from 'vitest';

import {
  resolveActiveRole,
  homeRouteFor,
  readRolePreference,
  storeRolePreference,
  clearRolePreference,
} from './activeRole';

/**
 * The rule that decides whose navigation is on screen.
 *
 * Its failure mode is not a crash but a dead end: a person holding both
 * sessions who cannot reach one of them, which is exactly the bug this replaced.
 */

describe('resolving the active role', () => {
  it('answers with the only session there is', () => {
    expect(resolveActiveRole({ voterLoggedIn: true, organizerLoggedIn: false }, null)).toBe('voter');
    expect(resolveActiveRole({ voterLoggedIn: false, organizerLoggedIn: true }, null)).toBe(
      'organizer',
    );
  });

  it('is public when neither session is live', () => {
    expect(resolveActiveRole({ voterLoggedIn: false, organizerLoggedIn: false }, null)).toBe(
      'public',
    );
  });

  it('honours the preference only when both sessions are live', () => {
    const both = { voterLoggedIn: true, organizerLoggedIn: true };
    expect(resolveActiveRole(both, 'voter')).toBe('voter');
    expect(resolveActiveRole(both, 'organizer')).toBe('organizer');
  });

  it('keeps the old behaviour when both are live and nothing was chosen', () => {
    // The navigation used to resolve organizer first. Preserving that means
    // signing in as a voter never moves an organizer's chrome on its own.
    expect(resolveActiveRole({ voterLoggedIn: true, organizerLoggedIn: true }, null)).toBe(
      'organizer',
    );
  });

  it('ignores a preference for a role whose session has gone', () => {
    // A voter who signs out must not be left looking at voter navigation, and
    // an organizer who signs out must not be stranded in organizer navigation
    // with nothing behind it.
    expect(resolveActiveRole({ voterLoggedIn: false, organizerLoggedIn: true }, 'voter')).toBe(
      'organizer',
    );
    expect(resolveActiveRole({ voterLoggedIn: true, organizerLoggedIn: false }, 'organizer')).toBe(
      'voter',
    );
    expect(resolveActiveRole({ voterLoggedIn: false, organizerLoggedIn: false }, 'voter')).toBe(
      'public',
    );
  });
});

describe('the stored preference', () => {
  beforeEach(() => localStorage.clear());

  it('survives a round trip', () => {
    storeRolePreference('voter');
    expect(readRolePreference()).toBe('voter');
    storeRolePreference('organizer');
    expect(readRolePreference()).toBe('organizer');
  });

  it('reads as unchosen when absent, cleared, or nonsense', () => {
    expect(readRolePreference()).toBeNull();

    storeRolePreference('voter');
    clearRolePreference();
    expect(readRolePreference()).toBeNull();

    // Anyone can write anything here. It decides navigation, never access, so
    // the only requirement is that a value we do not recognise means unchosen.
    localStorage.setItem('votain_active_role', 'admin');
    expect(readRolePreference()).toBeNull();
  });

  it('treats storing the public role as having no preference', () => {
    storeRolePreference('organizer');
    storeRolePreference('public');
    expect(readRolePreference()).toBeNull();
  });
});

describe('where each role goes home', () => {
  it('matches the first item of that role navigation', () => {
    expect(homeRouteFor('voter')).toBe('/voter/elections');
    expect(homeRouteFor('organizer')).toBe('/organizer/dashboard');
    expect(homeRouteFor('public')).toBe('/');
  });
});
