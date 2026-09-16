import { useTranslation } from 'react-i18next';
import { Check, Circle, Dot, X } from 'lucide-react';
import { Countdown } from './Countdown';
import { cn } from '../../lib/utils';
import { phaseTimeline, type TimelineStep, type TimelineStatus } from '../../lib/phase';
import { useChainNow } from '../../hooks/useChainNow';
import { formatDateTime } from '../../lib/datetime';
import type { Election } from '../../data/seed';

const ICON: Record<TimelineStatus, typeof Check> = {
  done: Check,
  current: Circle,
  upcoming: Dot,
  abandoned: X,
};

/**
 * One line per window, in the order the election passes through them.
 *
 * Vertical and not the horizontal `Stepper` beside it in this folder. That one
 * is a wizard: numbered circles, labels hidden below `sm`, no room for a date.
 * Every step here carries a date range and the running one carries a live
 * countdown, which is the whole reason the component exists, and none of that
 * survives being laid out sideways on a phone.
 */
function Step({ step, last }: { step: TimelineStep; last: boolean }) {
  const { t } = useTranslation();
  const Icon = ICON[step.status];
  const current = step.status === 'current';

  // To the minute, through the same formatter the gas history uses. A window
  // that closes "on the 17th" does not tell a voter whether they have until
  // breakfast or until midnight, and that is the whole question someone reads
  // a schedule to answer.
  const start = formatDateTime(step.start);

  return (
    <li className="flex gap-3">
      {/* The rail: a marker and the line to the next step. Drawn here rather
          than as a border on the row so it can stop at the last marker instead
          of trailing off under it. */}
      <div className="flex flex-col items-center shrink-0">
        <span
          className={cn(
            'w-5 h-5 rounded-full flex items-center justify-center ring-1 transition-colors',
            step.status === 'done' && 'bg-success/15 ring-success/30 text-success',
            current && 'bg-primary/20 ring-primary/40 text-primary',
            step.status === 'upcoming' && 'bg-surface-high ring-outline-variant/30 text-on-surface-meta',
            step.status === 'abandoned' && 'bg-error/10 ring-error/25 text-error',
          )}
        >
          <Icon className="w-3 h-3" strokeWidth={3} />
        </span>
        {!last && (
          <span
            className={cn(
              'w-px flex-1 min-h-4 my-0.5',
              step.status === 'done' ? 'bg-success/25' : 'bg-outline-variant/25',
            )}
          />
        )}
      </div>

      <div className={cn('min-w-0 flex-1', !last && 'pb-3')}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={cn(
              'text-xs font-semibold',
              current ? 'text-on-surface' : 'text-on-surface-variant',
              step.status === 'abandoned' && 'line-through text-on-surface-meta',
            )}
          >
            {t(step.labelKey)}
          </span>
          {/* Only on the step it belongs to, which is what makes the timeline
              a replacement for the lone countdown rather than an addition to
              it: the same clock, now with the steps around it. On an election
              that has not opened, that step is the first one and the clock
              runs to its START, so the label has to say which.

              Labelled in both cases. Without it, "Enrollment 3d 1h" beside a
              window that has not begun reads as three days left of enrolment,
              which is the opposite of what it means. */}
          {step.countdownTo && (
            <span className="inline-flex items-baseline gap-1">
              <span className="text-[10px] text-on-surface-meta">
                {t(step.countdownIsStart ? 'election.starts_in' : 'election.ends_in')}
              </span>
              <Countdown deadline={step.countdownTo} size="sm" showTimezone={false} />
            </span>
          )}
          {/* Without this, a finished step sits next to a date still in the
              future and reads as a bug instead of as the organizer using the
              power their card says they kept. */}
          {step.endedEarly && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-success/80">
              {t('timeline.ended_early')}
            </span>
          )}
        </div>
        {/* Each end on its own span so a long pair wraps at the dash rather
            than mid-timestamp, and each timestamp stays unbroken. */}
        <p className="text-[11px] text-on-surface-meta tabular-nums flex flex-wrap gap-x-1">
          <span className="whitespace-nowrap">
            {step.end ? start : t('timeline.from_date', { date: start })}
          </span>
          {step.end && (
            <span className="whitespace-nowrap">{'- '}{formatDateTime(step.end)}</span>
          )}
        </p>
      </div>
    </li>
  );
}

interface Props {
  election: Pick<Election, 'phase' | 'enrollStart' | 'enrollEnd' | 'voteStart' | 'voteEnd'>;
  className?: string;
}

/**
 * The schedule the organizer committed to, shown to both roles.
 *
 * It replaces a bare countdown to the next boundary. That answered "how long
 * until the thing about to happen" and could say nothing about what came
 * after, so a voter during enrolment had no way to see when they would be
 * asked to vote, or whether there was a gap between the two windows at all,
 * without opening the election and reading four dates out of a list.
 *
 * THE SAME COMPONENT IN BOTH ROLES, deliberately. The dates are the organizer's
 * promise to the voter, and a promise shown differently to the person making it
 * and the person relying on it is worth less than one shown identically. What
 * the organizer gets extra is the controls, which live elsewhere on their page.
 */
export function PhaseTimeline({ election, className }: Props) {
  const { t } = useTranslation();
  // The chain's clock, because `endedEarly` compares a date the chain set
  // against it. With the browser's, a local node seeded with time jumps makes
  // every finished window on the platform look cut short.
  const { nowMs } = useChainNow();
  const steps = phaseTimeline(election, nowMs);
  const abandoned = steps[0]?.status === 'abandoned';

  return (
    <div className={className}>
      <p className="text-xs font-semibold text-on-surface-meta mb-3">{t('timeline.title')}</p>
      <ol>
        {steps.map((step, i) => (
          <Step key={step.key} step={step} last={i === steps.length - 1} />
        ))}
      </ol>
      {/* Said once under the list rather than on all four steps: the reason is
          the same for every one of them, and repeating it would drown the
          dates it is explaining. */}
      {abandoned && (
        <p className="text-[11px] text-on-surface-meta mt-2">{t('timeline.abandoned')}</p>
      )}
    </div>
  );
}
