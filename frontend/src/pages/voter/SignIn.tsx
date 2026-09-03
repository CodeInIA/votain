import { useNavigate } from 'react-router-dom';
import { WorldIdVerify } from '../../components/voter/WorldIdVerify';

/**
 * World ID sign in, with no preamble.
 *
 * `/voter/onboarding` is the other door and ends at this same verification,
 * after four slides explaining what Votain is. That introduction is right for
 * someone arriving from the landing page and wrong for someone who already uses
 * the app, which is why `OtherRoleCard` sends an organizer here instead.
 *
 * Back goes wherever they came from rather than always to the landing page.
 * That was harmless while the only way in was the landing page itself; now an
 * organizer reaches this from their profile, and being dropped on the front
 * page for changing their mind is not going back.
 */
export default function SignIn() {
  const navigate = useNavigate();
  // A direct link has nothing behind it, so home is the only sensible fallback.
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));
  return <WorldIdVerify onBack={goBack} />;
}
