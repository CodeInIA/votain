import { useState, useEffect, useEffectEvent, type ReactNode } from 'react';
import { clearSessionSecrets } from '../lib/passkeyPrf';
import { clearOrganizerKeyCache } from '../lib/organizerKey';
import { clearIdentity } from '../lib/semaphore';
import { clearOnDevice, sealOnDevice } from '../lib/deviceSeal';
import { storeVoterPersonhood, clearVoterPersonhood } from '../lib/voterSession';
import { onReturnToForeground } from '../lib/foreground';
import {
  announceIdentityMismatch,
  announceSessionExpired,
  msUntilExpiry,
  resetSessionExpiryNotice,
  SESSION_EXPIRED_EVENT,
} from '../lib/sessionExpiry';
import { checkPlatformMembership } from '../lib/platformMembership';
import { getStoredCommitment } from '../lib/semaphore';
import {
  clearRolePreference,
  noteSignedOutOf,
  readRolePreference,
  resolveActiveRole,
  storeRolePreference,
  type Role,
} from '../lib/activeRole';
import {
  forgetOrganizerAddress,
  getRememberedOrganizerAddress,
  WALLET_DISCONNECTED_EVENT,
} from '../hooks/useOrganizerWallet';
import { setOrganizerName } from '../lib/organizer';
import { AuthContext } from './AuthContext';
import { backendUrl } from '../lib/backend';

const VOTER_KEY = 'votain_voter_logged_in';
const ORGANIZER_KEY = 'votain_organizer_logged_in';


export function AuthProvider({ children }: { children: ReactNode }) {
  const [voterLoggedIn, setVoterLoggedInState] = useState(
    () => localStorage.getItem(VOTER_KEY) === 'true'
  );
  // The organizer session is the WALLET. It owns their elections on chain, it
  // signs every lifecycle call, and a deterministic signature from it derives
  // the key their results are decrypted with, so there is nothing an organizer
  // can do here without it. A stored session is honoured only while an address
  // is still remembered on this device, evaluated up-front to avoid a flash of
  // logged-in UI.
  //
  // It used to hang off a passkey instead. That made the session stand for the
  // wrong thing: a forgotten passkey ended a session the wallet could have
  // carried on its own, and a linked wallet with no passkey could not get in at
  // all, on the platforms where an assertion is the part that fails.
  //
  // This flag is a UI convenience, never a security boundary: every write is
  // gated by a wallet signature and the contracts' `onlyOrganizer` check.
  const [organizerLoggedIn, setOrganizerLoggedInState] = useState(() => {
    const flagged = localStorage.getItem(ORGANIZER_KEY) === 'true';
    if (flagged && !getRememberedOrganizerAddress()) {
      localStorage.removeItem(ORGANIZER_KEY);
      return false;
    }
    return flagged;
  });
  const [sessionChecked, setSessionChecked] = useState(false);
  const [preferredRole, setPreferredRole] = useState<Role | null>(readRolePreference);

  const activeRole = resolveActiveRole({ voterLoggedIn, organizerLoggedIn }, preferredRole);

  const setActiveRole = (role: Role) => {
    storeRolePreference(role);
    setPreferredRole(role === 'public' ? null : role);
  };

  // Signing OUT of the role currently being worn drops the preference with it.
  // `resolveActiveRole` would ignore it anyway, since a preference only counts
  // while both sessions are live, but leaving it behind means a voter who signs
  // back in months later silently inherits a choice they no longer remember
  // making.
  const releaseRole = (role: Role) => {
    if (preferredRole !== role) return;
    clearRolePreference();
    setPreferredRole(null);
  };

  // Split from `setVoterLoggedIn` on purpose. Restoring a session from the
  // cookie must NOT claim the navigation: an organizer who chose the organizer
  // view and still holds a voter cookie would have that choice overwritten by
  // every page load, which is the one thing a preference must survive.
  const rememberVoterSession = (v: boolean) => {
    if (v) localStorage.setItem(VOTER_KEY, 'true');
    else localStorage.removeItem(VOTER_KEY);
    setVoterLoggedInState(v);
  };

  // Signing IN is different: it is an explicit act, and the role just entered is
  // the one the person means to use.
  const setVoterLoggedIn = (v: boolean) => {
    rememberVoterSession(v);
    if (v) setActiveRole('voter');
  };

  /**
   * Ends the voter session locally, without asking anybody.
   *
   * The counterpart to `voterSignOut`, and deliberately quieter: this runs when
   * the session is ALREADY gone, so there is no cookie left to clear and no
   * reason to touch the identity. A voter whose credential expired still owns
   * their phrase, their passkeys and their sealed secret; what they have lost
   * is permission to talk to this server until they verify again.
   */
  const endExpiredVoterSession = () => {
    localStorage.removeItem(VOTER_KEY);
    void clearOnDevice('nullifier');
    clearVoterPersonhood();
    setVoterLoggedInState(false);
    releaseRole('voter');
  };

  /**
   * Checks the session against the chain, and acts only on a clear answer.
   *
   * SKIPPED FOR A VOTER WHO HAS NOT SET UP YET. Between signing in with World
   * ID and writing their vault there is a real, ordinary moment where the
   * registry has never heard of them, and it looks exactly like a wiped chain.
   * Holding a commitment is what tells the two apart: this browser only has one
   * once an identity exists for it.
   *
   * A chain that cannot answer changes nothing. Ending a working session
   * because a node was briefly unreachable would be a worse bug than the one
   * this fixes.
   */
  const reconcileMembership = async (nullifier: string) => {
    const commitment = getStoredCommitment();
    if (commitment === null) return;

    const verdict = await checkPlatformMembership(nullifier, commitment);
    if (verdict === 'not-registered') {
      // The credential is valid and refers to a human this platform does not
      // have. Verifying again is the way back, and it re-registers the same
      // identity when the phrase is still here.
      endExpiredVoterSession();
      announceSessionExpired('unregistered');
      return;
    }
    if (verdict === 'other-identity') {
      // Registered, under a commitment this browser cannot produce: rotated
      // elsewhere, or this copy is stale. The session stands, because their
      // passkey or their phrase opens the right one; what must stop is the
      // pretence that this device can vote.
      announceIdentityMismatch();
    }
  };

  // The httpOnly voter_vc cookie is the SOURCE OF TRUTH for the voter session.
  // The localStorage flag is only an optimistic cache to avoid a flash on load;
  // it is spoofable, so we always reconcile against /api/me:
  //   - 401 (backend up, no valid cookie)  → clear the flag, log out.
  //   - authenticated                      → confirm the flag.
  //   - network error / backend down       → keep the optimistic state (unknown,
  //                                           don't nuke a possibly-valid session).
  //
  // RUN MORE THAN ONCE, which is the part that was missing. It used to run at
  // mount and never again, so a credential that expired while the tab was open,
  // or while a laptop slept for a week, left the interface offering a session
  // that had ended: the first anyone heard of it was an action failing. It now
  // runs again whenever the tab comes back, and a timer wakes it when the
  // credential's own expiry arrives.
  // Effect events: the effects below run once and keep listening, and these
  // let them call the latest version of each handler without re-subscribing.
  const onSessionEnded = useEffectEvent(endExpiredVoterSession);
  const onMembershipCheck = useEffectEvent(reconcileMembership);

  useEffect(() => {
    let cancelled = false;
    let expiryTimer: number | undefined;

    const reconcile = () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      void fetch(backendUrl('/api/me'), { credentials: 'include', signal: controller.signal })
        .then(async res => {
          if (cancelled) return null;
          if (res.status === 401) {
            // ANNOUNCED ONLY IF WE BELIEVED OTHERWISE. This same branch runs
            // for every anonymous visitor on their first paint, and telling a
            // stranger their session expired would be a lie in the one place
            // they have no way to check it.
            const believed = localStorage.getItem(VOTER_KEY) === 'true';
            // Definitive "not authenticated": clear any (possibly spoofed) flag.
            onSessionEnded();
            if (believed) announceSessionExpired();
            return null;
          }
          return res.ok
            ? (await res.json() as {
                authenticated?: boolean;
                nullifier?: string;
                personhood?: string;
                expiresAt?: number;
              })
            : null;
        })
        .then(data => {
          if (cancelled || !data?.authenticated) return;
          // Sealed rather than stored: see `deviceSeal`. Not awaited,
          // because nothing in this reconcile depends on it landing, and the
          // only reader loads it asynchronously anyway.
          if (data.nullifier) void sealOnDevice('nullifier', data.nullifier);
          // Written on every reconcile, cleared when absent: a voter who signs
          // in again with a stronger credential must not keep the old answer,
          // and one whose credential predates the claim must not keep a level
          // it never carried.
          storeVoterPersonhood(data.personhood);
          rememberVoterSession(true);
          resetSessionExpiryNotice();

          // THE COOKIE IS NOT THE PLATFORM. A session says the backend issued
          // this person a credential; being a member says the chain holds
          // them, and the two part company whenever the registry is replaced
          // under a live session, which on a local chain is every restart.
          if (data.nullifier) void onMembershipCheck(data.nullifier);

          // The credential's own deadline, from the credential. A tab open
          // across it ends the session at the right moment instead of carrying
          // on until something fails.
          const remaining = msUntilExpiry(data.expiresAt);
          if (remaining === null) return;
          window.clearTimeout(expiryTimer);
          expiryTimer = window.setTimeout(
            () => (remaining === 0 ? onSessionEnded() : reconcile()),
            remaining,
          );
        })
        .catch(() => { /* backend unreachable: keep optimistic state */ })
        .finally(() => {
          clearTimeout(timeout);
          if (!cancelled) setSessionChecked(true);
        });
    };

    reconcile();
    const stopWatchingReturn = onReturnToForeground(reconcile);

    return () => {
      cancelled = true;
      window.clearTimeout(expiryTimer);
      stopWatchingReturn();
    };
  }, []);

  /**
   * The backend saying "no" to something that carried the cookie.
   *
   * The clock and the reconcile catch an expiry eventually; a 401 is the
   * server saying so now, and it is also the only thing that catches a
   * credential REVOKED before its expiry.
   */
  useEffect(() => {
    const onExpired = () => onSessionEnded();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
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
    void clearOnDevice('nullifier');
    clearVoterPersonhood();
    clearIdentity();
    // The PRF secrets a passkey handed over this session live in memory only,
    // and memory outlives a sign-out on a shared browser.
    clearSessionSecrets();
    setVoterLoggedInState(false);
    releaseRole('voter');
    // Clear the httpOnly VC cookie so /api/me does not restore the session.
    fetch(backendUrl('/api/logout'), { method: 'POST', credentials: 'include' }).catch(() => {});
  };

  const setOrganizerLoggedIn = (v: boolean) => {
    if (v) localStorage.setItem(ORGANIZER_KEY, 'true');
    else localStorage.removeItem(ORGANIZER_KEY);
    setOrganizerLoggedInState(v);
    if (v) setActiveRole('organizer');
  };

  // The remembered wallet address and display name identify the organizer, so
  // they go too. The votain_paillier_sk_* entries deliberately do NOT: they are
  // the tally private keys for elections already on chain, and deleting them
  // would leave those results permanently undecryptable. Signing out must not be
  // able to destroy an election's outcome.
  //
  // The cached wallet SIGNATURE is a different matter and does go: it is the
  // organizer's tally master in all but name, it is held in memory precisely so
  // that one approval covers a whole session, and that session is over.
  const organizerSignOut = () => {
    localStorage.removeItem(ORGANIZER_KEY);
    clearOrganizerKeyCache();
    clearSessionSecrets();
    forgetOrganizerAddress();
    setOrganizerName('');
    setOrganizerLoggedInState(false);
    releaseRole('organizer');
  };

  // A wallet that disconnects from its own side ends the organizer session:
  // there is nothing left to sign with, and every screen behind the guard is a
  // screen that cannot work. Treated as a sign-out, so the guard sends them to
  // the organizer sign-in screen rather than to the landing page.
  useEffect(() => {
    const onDisconnected = () => {
      if (localStorage.getItem(ORGANIZER_KEY) !== 'true') return;
      noteSignedOutOf('organizer');
      organizerSignOut();
    };
    window.addEventListener(WALLET_DISCONNECTED_EVENT, onDisconnected);
    return () => window.removeEventListener(WALLET_DISCONNECTED_EVENT, onDisconnected);
    // No dependency array on purpose. `organizerSignOut` closes over the current
    // role preference, so pinning this to `[]` would hold a stale one and
    // release the wrong role. Re-subscribing costs one add and one remove.
  });

  return (
    <AuthContext.Provider value={{
      voterLoggedIn, setVoterLoggedIn, voterSignOut,
      organizerLoggedIn, setOrganizerLoggedIn, organizerSignOut,
      activeRole, setActiveRole,
      sessionChecked,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
