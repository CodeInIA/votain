import { createContext, useContext } from 'react';

import type { Role } from '../lib/activeRole';

export interface AuthState {
  voterLoggedIn: boolean;
  setVoterLoggedIn: (v: boolean) => void;
  voterSignOut: () => void;
  organizerLoggedIn: boolean;
  setOrganizerLoggedIn: (v: boolean) => void;
  organizerSignOut: () => void;
  /**
   * Which session the navigation is dressed for. Only ever a choice when both
   * are live; see `lib/activeRole`. It decides chrome, never access.
   */
  activeRole: Role;
  setActiveRole: (role: Role) => void;
  /** False until the session has been reconciled against the backend cookie. */
  sessionChecked: boolean;
}

export const AuthContext = createContext<AuthState>({
  voterLoggedIn: false,
  setVoterLoggedIn: () => {},
  voterSignOut: () => {},
  organizerLoggedIn: false,
  setOrganizerLoggedIn: () => {},
  organizerSignOut: () => {},
  activeRole: 'public',
  setActiveRole: () => {},
  sessionChecked: false,
});

export const useAuth = () => useContext(AuthContext);
