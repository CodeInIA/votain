import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

const VOTER_KEY = 'votain_voter_logged_in';
const ORGANIZER_KEY = 'votain_organizer_logged_in';
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? '';

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

  // A valid voter_vc cookie (httpOnly, set by the issuer after World ID
  // verification) restores the voter session even if localStorage was cleared.
  useEffect(() => {
    if (localStorage.getItem(VOTER_KEY) === 'true') return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    fetch(`${BACKEND_URL}/api/me`, { credentials: 'include', signal: controller.signal })
      .then(res => (res.ok ? res.json() as Promise<{ authenticated?: boolean; nullifier?: string }> : null))
      .then(data => {
        if (data?.authenticated) {
          if (data.nullifier) localStorage.setItem('voter_nullifier', data.nullifier);
          setVoterLoggedIn(true);
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  const voterSignOut = () => {
    localStorage.removeItem(VOTER_KEY);
    localStorage.removeItem('voter_nullifier');
    setVoterLoggedInState(false);
    // Clear the httpOnly VC cookie so /api/me does not restore the session.
    fetch(`${BACKEND_URL}/api/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
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
