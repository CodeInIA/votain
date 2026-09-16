import { useTranslation } from 'react-i18next';
import { CalendarCheck, CalendarClock, ShieldCheck, ShieldAlert } from 'lucide-react';
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
 * BOTH QUESTIONS GET BOTH ANSWERS. The cancel line used to show only the
 * promise, on the grounds that keeping the power is the ordinary state and a
 * line saying so would be noise. That is equally true of movable dates, which
 * are shown, so it was an inconsistency rather than a rule.
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
      {/* BOTH ANSWERS, the same as the dates above, which they did not used to
          be. The argument for hiding the ordinary one was that "the organizer
          can call it off" is true of almost every election and a line saying
          so would be noise. That argument is exactly as true of movable dates,
          which are also the default and are shown, so keeping one and not the
          other was not a rule, it was an inconsistency: a reader who has never
          seen the cancel badge cannot tell an election that promised nothing
          from one they simply have not looked at closely.

          Not styled as an alarm. Keeping the power to cancel is reasonable and
          common, which is the whole reason it has to be legible rather than
          implied. */}
      {cancellable !== undefined && (
        <span
          className={cn('flex items-center gap-1.5', className)}
          title={t(cancellable ? 'schedule.can_cancel_desc' : 'schedule.no_cancel_desc')}
        >
          {cancellable
            ? <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            : <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-success" />}
          {t(
            cancellable
              ? compact
                ? 'schedule.can_cancel_short'
                : 'schedule.can_cancel'
              : 'schedule.no_cancel',
          )}
        </span>
      )}
    </>
  );
}
