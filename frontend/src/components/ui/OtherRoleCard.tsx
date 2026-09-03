/**
 * The invitation to hold the other session too.
 *
 * The two roles were never exclusive, and nothing in the app said so. Someone
 * signed in as a voter had no way to find out they could also organize without
 * going back to the landing page, and an organizer had no reason to think they
 * were allowed to vote. Now that the header can switch between the two, the
 * profile is where the offer belongs: it is the one screen about the person
 * rather than about an election.
 *
 * Renders nothing once the offered session exists, since the header switch is
 * what serves them from that point on.
 */
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Vote } from 'lucide-react';
import { Card } from './Card';
import { Button } from './Button';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Where each role is entered.
 *
 * Voters go to the plain World ID sign in, NOT to `/voter/onboarding`. Both
 * end at the same verification, but onboarding leads with four slides explaining
 * what Votain is, what it does with your identity and why a vote can be
 * changed. That is the right introduction for someone arriving from the landing
 * page and a waste of an organizer's time: they already run elections here.
 * Organizers authenticate with a passkey, which has no such preamble.
 */
const ENTRY: Record<'voter' | 'organizer', string> = {
  voter: '/voter/signin',
  organizer: '/organizer/auth',
};

export function OtherRoleCard({ role }: { role: 'voter' | 'organizer' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { voterLoggedIn, organizerLoggedIn } = useAuth();

  const alreadyHeld = role === 'voter' ? voterLoggedIn : organizerLoggedIn;
  if (alreadyHeld) return null;

  const Icon = role === 'voter' ? Vote : LayoutDashboard;

  return (
    <Card className="p-5 mb-4">
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 shrink-0 rounded-full bg-secondary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-secondary" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-on-surface break-words">
            {t(`profile.also_${role}_title`)}
          </h2>
          <p className="text-xs text-on-surface-meta leading-relaxed mt-1">
            {t(`profile.also_${role}_desc`)}
          </p>
        </div>
      </div>
      <Button
        variant="default"
        className="w-full rounded-full mt-4"
        onClick={() => navigate(ENTRY[role])}
      >
        {t(`profile.also_${role}_cta`)}
      </Button>
    </Card>
  );
}
