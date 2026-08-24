import { useState, useEffect, type ReactNode } from 'react';
import { hasPrfCredential } from '../lib/passkeyPrf';
import { clearIdentity } from '../lib/semaphore';
import { forgetOrganizerAddress } from '../hooks/useOrganizerWallet';
import { setOrganizerName } from '../lib/organizer';
import { AuthContext } from './AuthContext';

const VOTER_KEY = 'votain_voter_logged_in';
const ORGANIZER_KEY = 'votain_organizer_logged_in';
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? '';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [voterLoggedIn, setVoterLoggedInState] = useState(
    () => localStorage.getItem(VOTER_KEY) === 'true'
  );
  // The organizer session is authenticated by their PASSKEY, not by the wallet:
  // the wallet only authorises signing and is summoned lazily when something
  // must be signed. So a stored session is only honoured while a passkey
  // credential still exists on this device — evaluated up-front to avoid a
  // flash of logged-in UI.
  //
  // This flag is a UI convenience, never a security boundary: every write is
  // gated by a wallet signature and the contracts' `onlyOrganizer` check.
  const [organizerLoggedIn, setOrganizerLoggedInState] = useState(() => {
    const flagged = localStorage.getItem(ORGANIZER_KEY) === 'true';
    if (flagged && !hasPrfCredential()) {
      localStorage.removeItem(ORGANIZER_KEY);
      return false;
    }
    return flagged;
  });
  const [sessionChecked, setSessionChecked] = useState(false);

  const setVoterLoggedIn = (v: boolean) => {
    if (v) localStorage.setItem(VOTER_KEY, 'true');
    else localStorage.removeItem(VOTER_KEY);
    setVoterLoggedInState(v);
  };

  // The httpOnly voter_vc cookie is the SOURCE OF TRUTH for the voter session.
  // The localStorage flag is only an optimistic cache to avoid a flash on load;
  // it is spoofable, so we always reconcile against /api/me:
  //   - 401 (backend up, no valid cookie)  → clear the flag, log out.
  //   - authenticated                      → confirm the flag.
  //   - network error / backend down       → keep the optimistic state (unknown,
  //                                           don't nuke a possibly-valid session).
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    fetch(`${BACKEND_URL}/api/me`, { credentials: 'include', signal: controller.signal })
      .then(async res => {
        if (res.status === 401) {
          // Definitive "not authenticated" — clear any (possibly spoofed) flag.
          localStorage.removeItem(VOTER_KEY);
          localStorage.removeItem('voter_nullifier');
          setVoterLoggedInState(false);
          return null;
        }
        return res.ok ? (await res.json() as { authenticated?: boolean; nullifier?: string }) : null;
      })
      .then(data => {
        if (data?.authenticated) {
          if (data.nullifier) localStorage.setItem('voter_nullifier', data.nullifier);
          setVoterLoggedIn(true);
        }
      })
      .catch(() => { /* backend unreachable: keep optimistic state */ })
      .finally(() => {
        clearTimeout(timer);
        setSessionChecked(true);
      });

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  // Signing out has to take the voting identity with it, not just the session
  // flags. What stayed behind before was not a harmless cache: `getOrCreateIdentity`
  // returns the stored identity whenever the mode is "local", so the next person
  // to sign in on this browser voted as the previous one. Even in PRF mode the
  // leftover commitment and per-election vote records showed one voter another
  // voter's history. `clearIdentity` covers the identity, its mode, the cached
  // commitment, this device's passkey handle and the votain_vote_* records.
  //
  // In the no-PRF fallback this deletes the only copy of the secret scalar. That
  // is the intended meaning of signing out of a device, and such an identity is
  // local-chain only anyway: the on-chain registration hangs off the vault write,
  // which the fallback never performs.
  const voterSignOut = () => {
    localStorage.removeItem(VOTER_KEY);
    localStorage.removeItem('voter_nullifier');
    clearIdentity();
    setVoterLoggedInState(false);
    // Clear the httpOnly VC cookie so /api/me does not restore the session.
    fetch(`${BACKEND_URL}/api/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
  };

  const setOrganizerLoggedIn = (v: boolean) => {
    if (v) localStorage.setItem(ORGANIZER_KEY, 'true');
    else localStorage.removeItem(ORGANIZER_KEY);
    setOrganizerLoggedInState(v);
  };

  // The remembered wallet address and display name identify the organizer, so
  // they go too. The votain_paillier_sk_* entries deliberately do NOT: they are
  // the tally private keys for elections already on chain, and deleting them
  // would leave those results permanently undecryptable. Signing out must not be
  // able to destroy an election's outcome.
  const organizerSignOut = () => {
    localStorage.removeItem(ORGANIZER_KEY);
    forgetOrganizerAddress();
    setOrganizerName('');
    setOrganizerLoggedInState(false);
  };

  return (
    <AuthContext.Provider value={{
      voterLoggedIn, setVoterLoggedIn, voterSignOut,
      organizerLoggedIn, setOrganizerLoggedIn, organizerSignOut,
      sessionChecked,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
