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
import { signInRouteFor, signedOutOf } from '../../lib/activeRole';
import { Spinner } from '../ui/Spinner';

/**
 * Where a guard sends someone who cannot be here.
 *
 * Straight after a sign-out, the screen for the role they just left, which is
 * where they expect to be and where they would go next anyway. Otherwise the
 * landing page: a bounce that is not deliberate should not strand anyone, and
 * walking back through a history of protected routes used to mean one press
 * per screen ever visited, each landing on a sign-in form again.
 */
function bounceTo(role: 'voter' | 'organizer'): string {
  return signedOutOf() === role ? signInRouteFor(role) : '/';
}

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
    return <Navigate to={bounceTo('voter')} replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Requires an organizer session: a wallet this browser remembers. */
export function RequireOrganizer({ children }: { children: ReactNode }) {
  const { organizerLoggedIn } = useAuth();
  const location = useLocation();

  if (!organizerLoggedIn) {
    return <Navigate to={bounceTo('organizer')} replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
