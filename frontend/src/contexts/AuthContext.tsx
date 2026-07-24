import { createContext, useContext } from 'react';

export interface AuthState {
  voterLoggedIn: boolean;
  setVoterLoggedIn: (v: boolean) => void;
  voterSignOut: () => void;
  organizerLoggedIn: boolean;
  setOrganizerLoggedIn: (v: boolean) => void;
  organizerSignOut: () => void;
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
  sessionChecked: false,
});

export const useAuth = () => useContext(AuthContext);
