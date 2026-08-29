/**
 * Switches between the two views of one election.
 *
 * An organizer managing an election has no way to see what a voter sees, which
 * is the thing they most need to check before it opens: the requirements, the
 * domain badge, the wording of the candidates. And a voter view of an election
 * they own gives them no way back to the controls without going through the
 * dashboard.
 *
 * WHICH VOTER VIEW. Not always the same one. Discover sends a signed-in voter to
 * `/voter/election/:id` and everyone else to the public `/election/:id`, so
 * "view as a voter would" has to make the same choice, or the organizer would be
 * shown a page they could not have arrived at.
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

interface Props {
  /** The view being offered, not the one currently shown. */
  to: 'voter' | 'organizer';
  href: string;
  className?: string;
}

export function ViewAsSwitch({ to, href, className }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const Icon = to === 'voter' ? Eye : SlidersHorizontal;

  return (
    <button
      type="button"
      onClick={() => navigate(href)}
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
