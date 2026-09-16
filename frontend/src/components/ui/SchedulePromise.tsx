import { useTranslation } from 'react-i18next';
import { CalendarCheck, CalendarClock, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SchedulePromiseProps {
  /** Undefined for seed elections and anything deployed before the flag existed. */
  fixedSchedule: boolean | undefined;
  /**
   * Whether the organizer kept the power to call the election off.
   *
   * A SEPARATE LINE, not folded into the one above, because they are separate
   * promises: "the dates will not move" says nothing about whether the election
   * will happen at all, and a voter reading one badge should not be left to
   * assume the other.
   */
  cancellable?: boolean | undefined;
  /**
   * Use the short labels, for a card rather than a detail page.
   *
   * Only the movable case has two wordings: "Dates the organizer can shorten"
   * says what it means and is the right length under a heading, and the same
   * sentence in a card's stats grid pushes everything else off the row.
   */
  compact?: boolean;
  className?: string;
}

/**
 * Whether the dates on this election are the dates it will run to.
 *
 * WHAT IT IS ABOUT. An organizer can normally close enrolment or voting early,
 * and while doing it they can see exactly what they are doing: `memberCount` and
 * `distinctVoters` are public and rise in real time. So the roll can be cut off
 * once it suits, and the vote ended once the result does, and neither leaves any
 * trace of why. Giving that power up at deployment is a promise the contract
 * keeps rather than one the organizer makes.
 *
 * BOTH ANSWERS ARE SHOWN, which is the part worth arguing about. Showing only
 * the good one would make its absence meaningless, since a voter who has never
 * seen the badge cannot read anything into not seeing it. The other answer is
 * not an accusation either: keeping the power to close early is reasonable and
 * common, and for the same reason it should be visible. Neither is styled as an
 * alarm.
 *
 * Nothing at all is shown when the answer is unknown. An election deployed
 * before this existed cannot make the promise, and cannot be said to have
 * declined it either.
 */
export function SchedulePromise({
  fixedSchedule,
  cancellable,
  compact = false,
  className,
}: SchedulePromiseProps) {
  const { t } = useTranslation();
  if (fixedSchedule === undefined && cancellable === undefined) return null;

  const Icon = fixedSchedule ? CalendarCheck : CalendarClock;
  return (
    <>
      {fixedSchedule !== undefined && (
        <span
          className={cn('flex items-center gap-1.5', className)}
          title={t(fixedSchedule ? 'schedule.fixed_desc' : 'schedule.movable_desc')}
        >
          <Icon className={cn('w-3.5 h-3.5 shrink-0', fixedSchedule && 'text-success')} />
          {t(
            fixedSchedule
              ? 'schedule.fixed'
              : compact
                ? 'schedule.movable_short'
                : 'schedule.movable',
          )}
        </span>
      )}
      {/* Only the promise is shown, not its absence. Keeping the power to cancel
          is the ordinary state of every election ever created here, and a line
          on all of them saying so would be noise, where the badge above is a
          choice made in both directions and worth reading either way. */}
      {cancellable === false && (
        <span
          className={cn('flex items-center gap-1.5', className)}
          title={t('schedule.no_cancel_desc')}
        >
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-success" />
          {t('schedule.no_cancel')}
        </span>
      )}
    </>
  );
}
