import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EyeOff, Fuel, Info, Percent, Repeat2, Users, Vote } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { Badge } from './Badge';
import { BlockchainBadge } from './BlockchainBadge';
import { Card } from './Card';
import { DomainBadge } from './DomainBadge';
import { EligibilityChips } from './EligibilityChips';
import { ExpandableText } from './ExpandableText';
import { PhaseTimeline } from './PhaseTimeline';
import { SchedulePromise } from './SchedulePromise';
import { VotingRule } from './VotingRule';
import { useElectionFunding } from '../../hooks/useElectionFunding';
import { useVoteCost } from '../../hooks/useVoteCost';
import { explorerAddressUrl } from '../../lib/deployments';
import { PULSE_PHASES } from '../../lib/phase';
import { replacedBallots, turnoutPct, votersOf } from '../../lib/turnout';
import type { Election } from '../../data/seed';

/**
 * The parts of an election page that are the same whoever is reading it.
 *
 * WHY THESE EXIST. There were two pages for one election, a public preview
 * and a voter's ballot, and they had converged until they held byte-identical
 * markup while drifting inside it. Pulling the shared half out was the first
 * half of the answer; the second was merging the pages themselves, so these
 * are now used by `ElectionPage` alone.
 *
 * THEY STAY SEPARATE ANYWAY. The election page is long, and these three are
 * the part of it that says what the election IS rather than what can be done
 * about it. That boundary is worth a file even with one caller: it is the
 * line between the description any reader gets and the machinery only a
 * session can use.
 */

interface HeaderProps {
  election: Election;
  /**
   * Badges only one reader can see, such as "you voted". They sit after the
   * phase and before the requirements, which is where the voter's page put
   * its own before this was shared.
   */
  extraBadges?: ReactNode;
}

/** Phase, requirements, title, organizer: what the page is about. */
export function ElectionHeader({ election, extraBadges }: HeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Badge
          variant={election.phase as Parameters<typeof Badge>[0]['variant']}
          dot={PULSE_PHASES.has(election.phase)}
        >
          {t(`phase.${election.phase}`)}
        </Badge>
        {extraBadges}
        {/* The rules themselves, in the same chips the lists use. The full
            sentences are further down the page; this row is for what can be
            read at a glance, so nobody has to scroll to learn the election is
            not open to everyone. */}
        <EligibilityChips policy={election.eligibilityPolicy} />
        {/* On both pages now. It was on the public one only, which had it
            backwards: a voter about to cast a ballot has more use for the
            contract than a passer by. */}
        <BlockchainBadge href={explorerAddressUrl(election.contractAddress) ?? undefined} />
      </div>
      <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-2 leading-tight wrap-break-word">
        {election.title}
      </h1>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-sm text-on-surface-meta">
          {t('election.by')} {election.organizer}
        </p>
        {/* The check link belongs here most of all: this is where someone
            deciding whether to trust the election lands. */}
        <DomainBadge
          domain={election.organizerDomain}
          organizerAddress={election.organizerAddress}
          showCheckLink
          interactive
        />
      </div>
    </div>
  );
}

/**
 * One figure and what it is, in the panel beside the schedule.
 *
 * The icon carries the colour, not the number. Four coloured numbers would
 * compete with each other and with the phase pill at the top of the page,
 * and the number is what should be read first; the tint is there to tell the
 * rows apart at a glance.
 *
 * A FIGURE WITH AN EXPLANATION IS A BUTTON, and that is the whole reason this
 * is not a `title`. A tooltip is a hover, and a phone has no hover, so the
 * explanation existed only for people on a mouse: the figures that need one,
 * what the reserve pays for, what the quorum withholds and why there are more
 * ballots than voters, are exactly the ones a reader is least likely to
 * already know.
 *
 * And ONLY a button. The tooltip stayed for a while beside it and was simply
 * the same sentence twice, one of them slower to appear and in the operating
 * system's styling rather than the page's.
 */
function Figure({
  icon: Icon,
  tint,
  label,
  value,
  hint,
  open,
  onToggle,
}: {
  icon: typeof Users;
  tint: string;
  label: string;
  value: string;
  hint?: string;
  open?: boolean;
  onToggle?: () => void;
}) {
  const body = (
    <>
      <p className="text-lg font-bold text-on-surface tabular-nums leading-tight">{value}</p>
      <p className="flex items-center gap-1.5 text-xs text-on-surface-meta min-w-0">
        <Icon className={cn('w-3.5 h-3.5 shrink-0', tint)} strokeWidth={2.5} />
        {/* `wrap-break-word`: a label is one word in most languages and a very
            long one in a few, and Russian's "Zaregistrirovano" is wider than
            a third of a phone. Without this it does not wrap, it simply
            draws over the figure beside it. */}
        <span className="min-w-0 wrap-break-word">{label}</span>
        {hint && <Info className="w-3 h-3 shrink-0 opacity-50" />}
      </p>
    </>
  );

  if (!hint) return <div className="min-w-0">{body}</div>;

  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        'min-w-0 text-left rounded-lg -m-1 p-1 cursor-pointer transition-colors',
        'hover:bg-white/5',
        open && 'bg-white/5',
      )}
    >
      {body}
    </button>
  );
}

/** One figure in the panel, before it is drawn. */
interface FigureSpec {
  id: string;
  icon: typeof Users;
  tint: string;
  label: string;
  value: string;
  /** A sentence the reader can open. Only the figures that need one have it. */
  hint?: string;
}

/**
 * Every date the election has, and the numbers that go with them.
 *
 * WHY THE FIGURES MOVED HERE. The schedule is a narrow list of rows, so on a
 * wide screen it left half the card empty while the facts that belong next to
 * it, how many people are in and how many ballots are paid for, were a line of
 * small grey text further down the page among the promises. A count belongs
 * beside the clock it is counting against.
 *
 * WHAT IS IN IT. Who is enrolled, how many have voted once there are any, how
 * many ballots the reserve can still pay for, and the quorum. That last one
 * has never been shown to a voter at all: it is set when the election is
 * created and only the organizer's tally screen mentions it, yet it is a
 * promise the voter is relying on, that no result appears until enough
 * ballots exist for one to reveal nothing about any single person.
 *
 * BOTH PAGES USE IT. The organizer's had a bare timeline and a separate row
 * of stat cards saying the same numbers; the two flags below are the whole
 * difference between what the two readers get.
 *
 * ON A PHONE it wraps under the schedule and becomes a row of figures rather
 * than a column, which is why the panel sets its own direction at `sm` rather
 * than inheriting one.
 */
export function ElectionSchedule({
  election,
  showReserve = true,
  showParticipation = false,
}: {
  election: Election;
  /**
   * The ballots the reserve can still pay for.
   *
   * Off for the organizer, whose page carries a whole gas card stating the
   * same number next to the buttons that change it. One page should not
   * report one fact twice.
   */
  showReserve?: boolean;
  /**
   * How many of the enrolled have voted, as a percentage.
   *
   * The organizer's figure rather than the voter's: it is what they came to
   * check, and it tells a voter nothing they can act on.
   */
  showParticipation?: boolean;
}) {
  const { t } = useTranslation();
  /**
   * Which explanation is open, by figure id.
   *
   * Shown UNDER the grid rather than inside the cell that was pressed, and
   * that is deliberate: a sentence inside a third of a phone would either
   * stretch that column or wrap into a tower, and either one moves the two
   * figures beside it. Below, it is full width and nothing else shifts.
   */
  const [openHint, setOpenHint] = useState<string | null>(null);
  /**
   * The sentence still being shown, which outlives the press that closed it.
   *
   * A ref and not state: nothing should re-render because a hint finished
   * closing, and the value is only ever read in the same pass that writes it.
   */
  const lastHint = useRef<string | null>(null);
  if (openHint) lastHint.current = openHint;
  const funding = useElectionFunding(election.contractAddress);
  const voteCost = useVoteCost();
  const reservedBallots = Math.floor(funding.reserved / voteCost.matic);

  const voters = votersOf(election);
  const replaced = replacedBallots(election);
  const quorumMet = election.privacyQuorum > 0 && voters >= election.privacyQuorum;

  /**
   * The figures, in reading order, with the ones that do not apply left out.
   *
   * SHORT LABELS, and `quorum_short` is not the only one: "Ballots reserved"
   * and "Votes cast" are sentences, and under a number in a third of a phone
   * they wrapped onto a second line while their neighbours did not, which left
   * the row ragged. The number says what it is; the label only has to name it.
   */
  const figures: FigureSpec[] = [
    {
      id: 'enrolled',
      icon: Users,
      tint: 'text-tertiary',
      label: t('election.enrolled'),
      value: election.totalEnrolled.toLocaleString(),
    },
  ];

  // PEOPLE, which is what a reader means by "how many have voted". This panel
  // used to show `castVotes` under the same word, so an election with one
  // voter who changed their mind read "1 enrolled, 2 votes".
  if (voters > 0) {
    figures.push({
      id: 'voters',
      icon: Vote,
      tint: 'text-primary',
      label: t('election.voters_short'),
      value: voters.toLocaleString(),
    });
  }

  // ONLY WHEN THEY DIFFER, because that is the only time the difference says
  // anything: somebody voted again, the later ballot replaced the earlier one,
  // and the tally will still count one. A figure that repeats the one beside it
  // on every ordinary election teaches people to stop reading the row.
  if (replaced > 0) {
    figures.push({
      id: 'ballots',
      icon: Repeat2,
      tint: 'text-tertiary',
      label: t('election.ballots_short'),
      value: election.castVotes.toLocaleString(),
      hint: t('election.ballots_hint'),
    });
  }

  // Nobody enrolled is not 0% turnout, it is no turnout to speak of, and a
  // bold "0%" beside the two other figures reads as a failure rather than as
  // an election that has not opened yet.
  if (showParticipation && election.totalEnrolled > 0) {
    figures.push({
      id: 'turnout',
      icon: Percent,
      tint: 'text-warning',
      label: t('election.participation'),
      value: `${turnoutPct(election)}%`,
    });
  }

  if (showReserve && reservedBallots > 0) {
    figures.push({
      id: 'reserved',
      icon: Fuel,
      tint: 'text-success',
      label: t('election.reserved_short'),
      value: reservedBallots.toLocaleString(),
      hint: t('election.reserved_hint'),
    });
  }

  // PROGRESS, not a target. As a bare number it said what the rule was and
  // nothing about whether it had been met, and the only screen that answered
  // that was the tally dialog, at the moment of publishing: an organizer with
  // a quorum of three and two voters found out by trying. What fixed that is
  // the VALUE, which counts up to the rule instead of stating it.
  //
  // A FIXED TINT, though it used to turn green once the quorum was met. It was
  // the only colour in this app that carried state, and it carried it in the
  // one row where every other colour is decoration: `Reserved` two figures to
  // the left is permanently the same green, so an election that met its quorum
  // showed two green icons of which only one meant anything by being green, and
  // one that had not showed the meaningless green alone. Nobody can learn a
  // signal that a neighbour is already wearing for no reason, which is why this
  // read as elections having differently coloured icons rather than as an
  // answer. Met or not is said twice over anyway, by the value and by the hint.
  if (election.privacyQuorum > 0) {
    figures.push({
      id: 'quorum',
      icon: EyeOff,
      tint: 'text-secondary',
      label: t('election.quorum_short'),
      value: `${voters.toLocaleString()}/${election.privacyQuorum.toLocaleString()}`,
      hint: `${t('create.quorum_hint')} ${t(quorumMet ? 'election.quorum_met' : 'election.quorum_pending')}`,
    });
  }


  const shownHint = figures.find(f => f.id === (openHint ?? lastHint.current))?.hint;

  return (
    <Card className="p-4 mb-4 flex flex-col sm:flex-row items-start gap-4">
      <PhaseTimeline election={election} className="flex-1 min-w-0 sm:min-w-60" />
      {/* A GRID ON A PHONE, a column on a wide screen. Wrapping a flex row
          put two figures on one line and the third on the next, ragged and
          for no reason; three columns give every figure the same width and
          fit them all on one row. A fourth, which only exists once somebody
          has voted, starts a second row underneath and stays aligned with
          the first. */}
      {/* `sm:self-stretch` so the rule down its left is the full height of the
          card rather than the height of whatever is in the panel, and a fixed
          width so the sentence below wraps the same way every time. */}
      <div
        className="w-full sm:w-60 sm:shrink-0 sm:self-stretch grid grid-cols-3 sm:flex sm:flex-col
                   gap-x-3 gap-y-3 pt-3 sm:pt-0 border-t sm:border-t-0 sm:border-l
                   border-white/5 sm:pl-4"
      >
        {figures.map(figure => (
          <Figure
            key={figure.id}
            icon={figure.icon}
            tint={figure.tint}
            label={figure.label}
            value={figure.value}
            hint={figure.hint}
            open={openHint === figure.id}
            onToggle={() => setOpenHint(openHint === figure.id ? null : figure.id)}
          />
        ))}
        {/* IT OPENS, RATHER THAN APPEARING. Letting the slot exist only while a
            hint was open grew the card by 33px and with it the rule down the
            panel's left, so pressing an info glyph shifted the page under the
            reader's finger. The answer used to be to hold the room open
            permanently, every sentence drawn and stacked in one grid cell with
            all but the open one invisible. That did stop the jump, and it cost
            61 measured pixels of empty card under the figures on every election
            nobody had pressed anything on, which is all of them.

            A row that animates from `0fr` to `1fr` gives both: nothing is held
            at rest, and the growth is something the eye follows instead of a
            jump it has to recover from.

            ONE SENTENCE, NOT ALL OF THEM. They used to be drawn stacked in a
            single cell, every one of them, so the open height was the TALLEST:
            the quorum's short line opened a box built for the gas one and left
            the difference empty. `1fr` measures whatever is actually in the
            cell, so drawing only the open sentence makes the box its size,
            still read from the reader's own language and text size rather than
            a hard-coded number that fits in Spanish and overflows in German.

            IT KEEPS DRAWING THE LAST ONE while it closes. `1fr` resolves to the
            height of the content, so emptying the cell at the moment of closing
            would collapse the row from zero to zero and there would be nothing
            to watch: the sentence has to outlive the press that dismissed it,
            by exactly one animation.

            `min-h-0` and `overflow-hidden` on the inner box are what make `0fr`
            actually collapse: without them a grid child keeps its content's
            height and the row never closes.

            On a phone none of this runs. The panel is the last thing in the
            card and grows downwards into nothing. */}
        <div
          className={cn(
            'col-span-3 sm:grid sm:transition-[grid-template-rows] sm:duration-200 sm:ease-out',
            openHint ? 'sm:grid-rows-[1fr]' : 'sm:grid-rows-[0fr]',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            {/* `hidden` on a phone and `invisible` above it, and the difference
                matters: the phone has no animating row, so a closed sentence
                that merely could not be seen would still hold its own height
                open. Above `sm` it has to keep occupying, or the row would have
                nothing left to shrink. */}
            <p
              className={cn(
                'text-[11px] text-on-surface-meta leading-snug',
                !openHint && 'hidden sm:block sm:invisible',
              )}
            >
              {shownHint}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * What the election is, how it is decided, and the facts the schedule does
 * not cover.
 *
 * Shown in every phase, so a finished election is never just a bare title.
 * No dates here: the schedule above carries all of them, to the minute, with
 * the phase each belongs to.
 */
export function ElectionAbout({
  election,
  asOrganizer = false,
}: {
  election: Election;
  /** The reader owns this election, so the promises speak to them. */
  asOrganizer?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Card className="p-5 mb-4">
      <h2 className="text-sm font-semibold text-on-surface mb-2">{t('election.about')}</h2>
      <ExpandableText text={election.description} />
      <div className="mt-4 pt-4 border-t border-white/5">
        <VotingRule type={election.votingType} thresholdValue={election.thresholdValue} />
      </div>
      {/* The counts used to be here and are in the schedule card now, beside
          the dates they are counted against. What is left is what no figure
          can say: the two promises the organizer cannot take back. */}
      <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-white/5 text-xs text-on-surface-meta">
        {/* Askable here, where there is a page to open a sentence into. The
            same badges on a card stay plain: see `explainable`. */}
        <SchedulePromise
          fixedSchedule={election.fixedSchedule}
          cancellable={election.cancellable}
          explainable
          asOrganizer={asOrganizer}
        />
      </div>
    </Card>
  );
}
