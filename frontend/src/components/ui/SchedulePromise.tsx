import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, CalendarClock, Info, ShieldCheck, ShieldAlert } from 'lucide-react';
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
  /**
   * Let a reader open the sentence behind each badge.
   *
   * For a page, not for a card. Both badges have always carried their
   * explanation in `title`, which is a hover, and a phone has no hover: the
   * difference between "the organizer can bring this forward" and "these
   * dates cannot move" is the whole reason the badges exist, and on a phone
   * it was four words with no way to ask what they meant.
   *
   * Off by default because a card is a link. A button inside one has to stop
   * the click reaching it, and opening a paragraph would change the height of
   * one card in a grid of them. The card says which promise was made; the
   * page it opens says what that means.
   */
  explainable?: boolean;
  /**
   * The reader is the organizer of this election.
   *
   * These sentences are about what the organizer may and may not do, and they
   * were written for the person relying on them: "the organizer can call it
   * off", read by the organizer, on their own page, about themselves. Passing
   * this swaps in the same promises addressed to the person who made them.
   *
   * A flag rather than a guess from the session: an organizer can hold both
   * roles and read the voter's page of their own election, and there the
   * third person is right, because that page is what everyone else sees.
   */
  asOrganizer?: boolean;
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
  explainable = false,
  asOrganizer = false,
  className,
}: SchedulePromiseProps) {
  const { t } = useTranslation();
  /** Which sentence is open, by badge. Only one at a time. */
  const [open, setOpen] = useState<'schedule' | 'cancel' | null>(null);
  if (fixedSchedule === undefined && cancellable === undefined) return null;

  const Icon = fixedSchedule ? CalendarCheck : CalendarClock;

  /**
   * The strings, in the voice that suits the reader.
   *
   * Only the ones that name the organizer have a second version. "Fixed
   * dates" and "Cannot be called off" say nothing about who anybody is, and a
   * separate copy of them would be two strings to keep in step for no gain.
   */
  const scheduleLabel = fixedSchedule
    ? 'schedule.fixed'
    : compact
      ? 'schedule.movable_short'
      : asOrganizer
        ? 'schedule.movable_own'
        : 'schedule.movable';
  const scheduleDesc = fixedSchedule
    ? asOrganizer ? 'schedule.fixed_desc_own' : 'schedule.fixed_desc'
    : asOrganizer ? 'schedule.movable_desc_own' : 'schedule.movable_desc';
  const cancelLabel = compact
    ? cancellable
      ? 'schedule.can_cancel_short'
      : 'schedule.no_cancel_short'
    : cancellable
      ? asOrganizer ? 'schedule.can_cancel_own' : 'schedule.can_cancel'
      : 'schedule.no_cancel';
  const cancelDesc = cancellable
    ? asOrganizer ? 'schedule.can_cancel_desc_own' : 'schedule.can_cancel_desc'
    : asOrganizer ? 'schedule.no_cancel_desc_own' : 'schedule.no_cancel_desc';

  /**
   * A badge, as a button when it can be asked about and a span otherwise.
   *
   * The same shape either way, so the row reads identically on a page and on
   * a card: the only thing the button adds is the small info glyph and a
   * surface to press.
   *
   * `title` only on the plain one. Where the sentence opens on the page,
   * a tooltip repeating it is the same words twice, and the slower of the two.
   * Where there is nothing to press, it is the only explanation there is.
   */
  const badge = (
    which: 'schedule' | 'cancel',
    body: React.ReactNode,
    description: string,
  ) => {
    if (!explainable) {
      return (
        <span className={cn('flex items-center gap-1.5', className)} title={description}>
          {body}
        </span>
      );
    }
    return (
      <button
        type="button"
        aria-expanded={open === which}
        onClick={() => setOpen(open === which ? null : which)}
        className={cn(
          'flex items-center gap-1.5 rounded-lg -m-1 p-1 cursor-pointer transition-colors',
          'hover:bg-white/5',
          open === which && 'bg-white/5',
          className,
        )}
      >
        {body}
        <Info className="w-3 h-3 shrink-0 opacity-50" />
      </button>
    );
  };

  return (
    <>
      {fixedSchedule !== undefined &&
        badge(
          'schedule',
          <>
            <Icon className={cn('w-3.5 h-3.5 shrink-0', fixedSchedule && 'text-success')} />
            {t(scheduleLabel)}
          </>,
          t(scheduleDesc),
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
      {cancellable !== undefined &&
        badge(
          'cancel',
          <>
            {cancellable
              ? <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              : <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-success" />}
            {t(cancelLabel)}
          </>,
          t(cancelDesc),
        )}
      {/* Full width, so it lands on its own line of the row that holds the
          badges and opening one never moves the other sideways. */}
      {open && (
        <p className="w-full text-[11px] text-on-surface-meta leading-snug">
          {t(open === 'schedule' ? scheduleDesc : cancelDesc)}
        </p>
      )}
    </>
  );
}
