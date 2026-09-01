import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import HowItWorks from './HowItWorks';
import { AuthContext, type AuthState } from '../../contexts/AuthContext';

/**
 * The page's closing invitation, which used to be offered to everyone.
 *
 * A signed-in voter was told to register to vote, which reads as the page not
 * knowing who it is talking to. Both other entry points to onboarding, the top
 * nav and the election preview, already ask first.
 *
 * i18next is mocked globally to return the key, so the assertions read as keys.
 */

const authState = (over: Partial<AuthState> = {}): AuthState => ({
  voterLoggedIn: false,
  setVoterLoggedIn: () => {},
  voterSignOut: () => {},
  organizerLoggedIn: false,
  setOrganizerLoggedIn: () => {},
  organizerSignOut: () => {},
  sessionChecked: true,
  ...over,
});

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

  it('says nothing to an organizer, whose chrome could not hold a voter session', () => {
    // Not because the roles exclude each other: `AuthProvider` keeps the two
    // sessions independent. Because `TopNav` and `BottomTabNav` both resolve
    // organizer first, so the moment both are set the voter routes vanish from
    // the navigation. Inviting an organizer to register would hand them a
    // session the app then hides.
    setup({ organizerLoggedIn: true });
    expect(screen.queryByText('how.cta_register')).not.toBeInTheDocument();
    expect(screen.queryByText('landing.my_elections')).not.toBeInTheDocument();
  });
});
