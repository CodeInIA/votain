/**
 * Switches between the two views of one election.
 *
 * An organizer managing an election has no way to see what a voter sees, which
 * is the thing they most need to check before it opens: the requirements, the
 * domain badge, the wording of the candidates. And a voter view of an election
 * they own gives them no way back to the controls without going through the
 * dashboard.
 *
 * WHICH VOTER VIEW. There is only one, and there used to be two. `/election/:id`
 * now serves the reader it has, showing the ballot to a session and the
 * invitation to verify to everyone else, so "view as a voter would" has one
 * destination and cannot pick the wrong one.
 *
 * The organizer direction is deliberately narrow: it appears only when the
 * connected wallet owns the election AND an organizer session is active. Without
 * the ownership check every voter would see it, and without the session check it
 * would offer a route that `RequireOrganizer` bounces straight back.
 */
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, SlidersHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';

interface Props {
  /** The view being offered, not the one currently shown. */
  to: 'voter' | 'organizer';
  href: string;
  className?: string;
}

export function ViewAsSwitch({ to, href, className }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { voterLoggedIn, organizerLoggedIn, setActiveRole } = useAuth();
  const Icon = to === 'voter' ? Eye : SlidersHorizontal;

  /**
   * Whether the person actually holds the role being offered.
   *
   * Only then is switching to it a true statement. This button appears for an
   * organizer who may have no voter session at all, and telling the app they
   * are now acting as a voter would put the voter's navigation around
   * somebody with no voter identity.
   */
  const holdsTheRole = to === 'voter' ? voterLoggedIn : organizerLoggedIn;

  /**
   * SWITCHES THE ROLE, not only the page.
   *
   * It used to navigate and nothing else, which was defensible while the
   * header toggle refused to cross between the two views of an election. Now
   * that it does, pressing one control left the header saying "Voter" over
   * the organizer's panel while pressing the other, two inches away, changed
   * both. Two controls that go to the same place should leave the app in the
   * same state.
   */
  const go = () => {
    if (holdsTheRole) setActiveRole(to);
    navigate(href);
  };

  return (
    <button
      type="button"
      onClick={go}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer shrink-0',
        'text-xs font-semibold whitespace-nowrap ring-1 transition-colors',
        'bg-transparent text-on-surface-meta ring-outline-variant/30',
        'hover:text-on-surface hover:ring-outline-variant/50',
        className,
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />
      {t(to === 'voter' ? 'election.view_as_voter' : 'election.view_as_organizer')}
    </button>
  );
}
