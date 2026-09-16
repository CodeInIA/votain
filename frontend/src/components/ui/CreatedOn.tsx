import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatDateTime } from '../../lib/datetime';

interface Props {
  /** Undefined for seed elections and anything deployed before the immutable. */
  date: Date | undefined;
  /**
   * Show the time inline as well as in the tooltip.
   *
   * For a detail page, where there is room and the reader came looking. A card
   * gets the date alone and keeps the exact moment on hover, because a row of
   * timestamps is four numbers to compare where one would do.
   */
  precise?: boolean;
  className?: string;
}

/**
 * When the election was deployed.
 *
 * WHY IT IS WORTH A LINE. No other date on the screen answers it. An election
 * announced today for next March and one deployed last March that opens
 * tomorrow are a year apart in age and adjacent in every date a card shows,
 * and "this was created an hour ago" is the single most useful thing to know
 * about a convincing copy of somebody else's election. It sits beside the
 * domain badge in that job: both are about whether to believe the thing.
 *
 * It is also the only date here the organizer did not choose. Every other one
 * came out of the wizard and can be set to anything the validation allows;
 * this one is written by the chain at deployment, and nobody can offer a
 * different answer afterwards.
 *
 * Nothing is drawn when it is unknown, like the promises beside it. An
 * election deployed before the immutable existed has no creation date to show,
 * and inventing one from the first date in its schedule would be a guess in
 * the one place that exists to not be guessed at.
 */
export function CreatedOn({ date, precise = false, className }: Props) {
  const { t } = useTranslation();
  if (!date) return null;

  const exact = t('election.created_on', { date: formatDateTime(date) });
  return (
    <span className={cn('flex items-center gap-1.5 min-w-0', className)} title={exact}>
      <Sparkles className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">
        {precise ? exact : t('election.created_on', { date: date.toLocaleDateString() })}
      </span>
    </span>
  );
}
