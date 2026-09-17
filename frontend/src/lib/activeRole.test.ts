import { describe, it, expect, beforeEach } from 'vitest';

import {
  resolveActiveRole,
  homeRouteFor,
  switchDestination,
  roleOwningRoute,
  readRolePreference,
  storeRolePreference,
  clearRolePreference,
  noteSignedOutOf,
  signedOutOf,
  clearSignedOutMark,
  signInRouteFor,
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

describe('where switching leaves you', () => {
  it('stays put on a page that reads the same for both roles', () => {
    // The bug this is for: flipping the switch on Discover threw the person to
    // a dashboard, losing their place for nothing.
    //
    // An election used to be in this list and is not any more. It was a
    // public preview then, the same page for everybody; it shows the ballot
    // to whoever has a session now, so it is role-specific and has its own
    // cases below.
    for (const page of ['/discover', '/verify-receipt', '/how-it-works']) {
      expect(switchDestination(page, 'organizer')).toBe(page);
      expect(switchDestination(page, 'voter')).toBe(page);
    }
  });

  it('crosses to the same page on the other side when there is one', () => {
    expect(switchDestination('/voter/profile', 'organizer')).toBe('/organizer/profile');
    expect(switchDestination('/organizer/profile', 'voter')).toBe('/voter/profile');
  });

  it('falls back to the new role home from a page that belongs to the old one', () => {
    // Voter navigation wrapped around the gas tank is the alternative.
    expect(switchDestination('/organizer/gas', 'voter')).toBe('/voter/elections');
    expect(switchDestination('/voter/history', 'organizer')).toBe('/organizer/dashboard');
  });

  it('crosses to the organizer view of the same election', () => {
    // Keeping the owner's place, which is who the switch is for. It refused
    // to do this while nothing checked ownership, because the header cannot:
    // the management page does it now, and sends a non-owner to their
    // dashboard.
    expect(switchDestination('/election/0xabc', 'organizer')).toBe('/organizer/election/0xabc');
  });

  it('crosses back to the same election from the organizer panel', () => {
    // The panel has no public twin to fall through to, so without this the
    // prefix rule sends them to the voter's list and loses the election they
    // were managing.
    expect(switchDestination('/organizer/election/0xabc', 'voter')).toBe('/election/0xabc');
    // Switching to the role it already shows changes nothing.
    expect(switchDestination('/organizer/election/0xabc', 'organizer')).toBe('/organizer/election/0xabc');
  });

  it('is not confused by a results page hanging off an election', () => {
    // `/election/:id/results` is a public page in its own right and there is
    // no organizer twin of it, so only the id is taken.
    expect(switchDestination('/election/0xabc/results', 'organizer')).toBe('/organizer/election/0xabc');
  });

  it('stays on an election when switching to the role it is already showing', () => {
    // `/election/:id` IS the voter's view of it: there is nowhere to go.
    expect(switchDestination('/election/0xabc', 'voter')).toBe('/election/0xabc');
  });

  it('treats an election as role-specific despite its public path', () => {
    // The trap this closes. The prefix rule below it only catches `/voter/`
    // and `/organizer/`, and the election page moved out of both when the two
    // copies were merged. Switching to organizer left the person where they
    // stood, told they were acting as an organizer while looking at a ballot.
    expect(switchDestination('/election/0xabc', 'organizer')).not.toBe('/election/0xabc');
  });
});

/**
 * The mark a sign-out leaves behind.
 *
 * Signing out re-renders the route guard, which redirects before the screen
 * holding the button can run its own navigate, and that screen then unmounts
 * with the navigation still pending. The guard is therefore the only thing that
 * can honour where the person meant to go, and this is how it is told.
 */
describe('the sign-out mark', () => {
  beforeEach(() => sessionStorage.clear());

  it('names the role that was just left', () => {
    noteSignedOutOf('organizer');
    expect(signedOutOf()).toBe('organizer');
  });

  it('says nothing when nobody signed out', () => {
    expect(signedOutOf()).toBeNull();
  });

  it('survives being read, because guards read it while rendering', () => {
    // React renders twice under StrictMode. A read that consumed the value
    // would be seen by one render and missed by the other, and the redirect
    // would land somewhere different depending on which render was kept.
    noteSignedOutOf('voter');
    expect(signedOutOf()).toBe('voter');
    expect(signedOutOf()).toBe('voter');
    expect(signedOutOf()).toBe('voter');
  });

  it('is cleared by the sign-in screen it sent them to', () => {
    noteSignedOutOf('voter');
    clearSignedOutMark();
    expect(signedOutOf()).toBeNull();
  });

  it('expires, so it cannot redirect someone who came back much later', () => {
    sessionStorage.setItem('votain_just_signed_out', `organizer:${Date.now() - 60_000}`);
    expect(signedOutOf()).toBeNull();
  });

  it('ignores anything it did not write', () => {
    sessionStorage.setItem('votain_just_signed_out', 'nonsense');
    expect(signedOutOf()).toBeNull();
  });

  it('points each role at its own sign-in screen', () => {
    expect(signInRouteFor('organizer')).toBe('/organizer/auth');
    expect(signInRouteFor('voter')).toBe('/voter/signin');
  });
});

describe('switching on a page both roles have', () => {
  it('crosses between the two saved lists instead of going home', () => {
    // One page reading two lists: the same human keeps different things as a
    // voter and as an organizer, and switching here is looking at the same
    // shelf from the other side. Being dropped on a dashboard for that would
    // lose the place for nothing, which is the rule this table exists for.
    expect(switchDestination('/voter/saved', 'organizer')).toBe('/organizer/saved');
    expect(switchDestination('/organizer/saved', 'voter')).toBe('/voter/saved');
  });
});

describe('which role a route belongs to', () => {
  it('names the role for the pages that have one', () => {
    expect(roleOwningRoute('/voter/saved')).toBe('voter');
    expect(roleOwningRoute('/voter/elections')).toBe('voter');
    expect(roleOwningRoute('/organizer/dashboard')).toBe('organizer');
    expect(roleOwningRoute('/organizer/election/0xabc')).toBe('organizer');
  });

  it('leaves the pages that belong to nobody alone', () => {
    // The same page from both sides. Re-dressing somebody for opening one
    // would undo the choice they just made in the header.
    for (const page of ['/', '/discover', '/verify-receipt', '/election/0xabc', '/how-it-works']) {
      expect(roleOwningRoute(page)).toBeNull();
    }
  });

  it('is not fooled by a path that merely starts with the word', () => {
    expect(roleOwningRoute('/voterish/thing')).toBeNull();
    expect(roleOwningRoute('/organizers')).toBeNull();
  });
});
