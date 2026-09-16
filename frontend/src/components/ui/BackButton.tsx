import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { cn } from '../../lib/utils';

interface BackButtonProps {
  /** Defaults to history back (navigate(-1)). */
  onClick?: () => void;
  /**
   * Where to go when there is no history to step into.
   *
   * For a page reached from several places AND from a direct link: the link
   * and the reload have nothing behind them, and `navigate(-1)` from there
   * leaves the app entirely. Passing this keeps history back as the normal
   * answer and names a destination only for the case that has none.
   *
   * IT MATTERS FOR FILTERS. A screen keeps its filters in the query string, so
   * stepping back restores them and navigating to a bare path throws them
   * away: an organizer who filtered their dashboard, opened an election and
   * came back found the list as it was before they filtered it.
   */
  fallback?: string;
  className?: string;
}

export function BackButton({ onClick, fallback, className }: BackButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  // React Router labels the entry a session ARRIVED on `default`. Anything
  // else means this app put the previous entry there, so there is somewhere
  // of ours to go back to.
  const hasHistory = location.key !== 'default';
  const goBack = () => {
    if (fallback && !hasHistory) navigate(fallback);
    else navigate(-1);
  };

  return (
    <button
      type="button"
      onClick={onClick ?? goBack}
      className={cn(
        'flex items-center gap-1.5 text-sm text-on-surface-meta hover:text-on-surface transition-colors cursor-pointer',
        className
      )}
    >
      <ChevronLeft className="w-4 h-4" />
      {t('common.back')}
    </button>
  );
}
