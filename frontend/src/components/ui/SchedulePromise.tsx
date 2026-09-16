import { useTranslation } from 'react-i18next';
import { CalendarCheck, CalendarClock } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SchedulePromiseProps {
  /** Undefined for seed elections and anything deployed before the flag existed. */
  fixedSchedule: boolean | undefined;
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
export function SchedulePromise({ fixedSchedule, className }: SchedulePromiseProps) {
  const { t } = useTranslation();
  if (fixedSchedule === undefined) return null;

  const Icon = fixedSchedule ? CalendarCheck : CalendarClock;
  return (
    <span
      className={cn('flex items-center gap-1.5', className)}
      title={t(fixedSchedule ? 'schedule.fixed_desc' : 'schedule.movable_desc')}
    >
      <Icon className={cn('w-3.5 h-3.5 shrink-0', fixedSchedule && 'text-success')} />
      {t(fixedSchedule ? 'schedule.fixed' : 'schedule.movable')}
    </span>
  );
}
