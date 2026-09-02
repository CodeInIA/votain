import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import HowItWorks from './HowItWorks';
import { AuthContext, type AuthState } from '../../contexts/AuthContext';
import { resolveActiveRole } from '../../lib/activeRole';

/**
 * The page's closing invitation, which used to be offered to everyone.
 *
 * A signed-in voter was told to register to vote, which reads as the page not
 * knowing who it is talking to. Both other entry points to onboarding, the top
 * nav and the election preview, already ask first.
 *
 * i18next is mocked globally to return the key, so the assertions read as keys.
 */

const authState = (over: Partial<AuthState> = {}): AuthState => {
  const base = {
    voterLoggedIn: false,
    setVoterLoggedIn: () => {},
    voterSignOut: () => {},
    organizerLoggedIn: false,
    setOrganizerLoggedIn: () => {},
    organizerSignOut: () => {},
    setActiveRole: () => {},
    sessionChecked: true,
    ...over,
  };
  // Derived rather than passed, so a test that flips a session cannot leave
  // the role saying something the provider never would.
  return { ...base, activeRole: over.activeRole ?? resolveActiveRole(base, null) };
};

const setup = (over: Partial<AuthState> = {}) =>
  render(
    <MemoryRouter>
      <AuthContext.Provider value={authState(over)}>
        <HowItWorks />
      </AuthContext.Provider>
    </MemoryRouter>,
  );

describe('HowItWorks, the closing call to action', () => {
  it('invites a visitor with no session to register', () => {
    setup();
    expect(screen.getByText('how.cta_register')).toBeInTheDocument();
  });

  it('sends a signed-in voter to their elections instead', () => {
    setup({ voterLoggedIn: true });
    expect(screen.queryByText('how.cta_register')).not.toBeInTheDocument();
    expect(screen.getByText('landing.my_elections')).toBeInTheDocument();
  });

  it('invites an organizer to register as a voter too', () => {
    // It did not, back when both navigation bars resolved organizer first: the
    // session it offered would have been hidden the moment it existed. The role
    // switch is what made the offer honest.
    setup({ organizerLoggedIn: true });
    expect(screen.getByText('how.cta_register')).toBeInTheDocument();
    expect(screen.queryByText('landing.my_elections')).not.toBeInTheDocument();
  });
});
