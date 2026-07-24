/**
 * Route guards.
 *
 * These protect the *UI surface*: an unauthenticated visitor is redirected to
 * the corresponding sign-in screen instead of seeing an empty dashboard.
 *
 * They are NOT the security boundary — that lives in the backend (httpOnly VC
 * cookie) and on-chain (`onlyOrganizer`, registry-gated enrollment). A client
 * guard can always be bypassed by editing local state; it just stops the app
 * from rendering screens that cannot work without a session.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Spinner } from '../ui/Spinner';

function Checking() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background">
      <Spinner />
    </div>
  );
}

/** Requires a voter session (backed by the httpOnly `voter_vc` cookie). */
export function RequireVoter({ children }: { children: ReactNode }) {
  const { voterLoggedIn, sessionChecked } = useAuth();
  const location = useLocation();

  // Wait for /api/me to reconcile so a valid cookie session isn't bounced.
  if (!sessionChecked && !voterLoggedIn) return <Checking />;

  if (!voterLoggedIn) {
    // Landing, not the onboarding wizard: signing out re-renders this guard
    // (the profile screen lives behind it), and that redirect races the
    // caller's own navigate('/'). Pointing both at the landing page makes the
    // outcome the same either way — and the landing page offers both "Log in"
    // and "Register", so deep links still lead somewhere useful.
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Requires an organizer session (passkey + connected wallet). */
export function RequireOrganizer({ children }: { children: ReactNode }) {
  const { organizerLoggedIn } = useAuth();
  const location = useLocation();

  if (!organizerLoggedIn) {
    return <Navigate to="/organizer/auth" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
