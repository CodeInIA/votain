import { createContext, useContext, useState, type ReactNode } from 'react';

const VOTER_KEY = 'votain_voter_logged_in';
const ORGANIZER_KEY = 'votain_organizer_logged_in';

interface AuthState {
  voterLoggedIn: boolean;
  setVoterLoggedIn: (v: boolean) => void;
  voterSignOut: () => void;
  organizerLoggedIn: boolean;
  setOrganizerLoggedIn: (v: boolean) => void;
  organizerSignOut: () => void;
}

const AuthContext = createContext<AuthState>({
  voterLoggedIn: false,
  setVoterLoggedIn: () => {},
  voterSignOut: () => {},
  organizerLoggedIn: false,
  setOrganizerLoggedIn: () => {},
  organizerSignOut: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [voterLoggedIn, setVoterLoggedInState] = useState(
    () => localStorage.getItem(VOTER_KEY) === 'true'
  );
  const [organizerLoggedIn, setOrganizerLoggedInState] = useState(
    () => localStorage.getItem(ORGANIZER_KEY) === 'true'
  );

  const setVoterLoggedIn = (v: boolean) => {
    if (v) localStorage.setItem(VOTER_KEY, 'true');
    else localStorage.removeItem(VOTER_KEY);
    setVoterLoggedInState(v);
  };

  const voterSignOut = () => {
    localStorage.removeItem(VOTER_KEY);
    localStorage.removeItem('voter_nullifier');
    setVoterLoggedInState(false);
  };

  const setOrganizerLoggedIn = (v: boolean) => {
    if (v) localStorage.setItem(ORGANIZER_KEY, 'true');
    else localStorage.removeItem(ORGANIZER_KEY);
    setOrganizerLoggedInState(v);
  };

  const organizerSignOut = () => {
    localStorage.removeItem(ORGANIZER_KEY);
    setOrganizerLoggedInState(false);
  };

  return (
    <AuthContext.Provider value={{
      voterLoggedIn, setVoterLoggedIn, voterSignOut,
      organizerLoggedIn, setOrganizerLoggedIn, organizerSignOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
