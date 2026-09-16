import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Users, Calendar, ChevronRight, Clock } from 'lucide-react';
import { Badge } from './Badge';
import { DomainBadge } from './DomainBadge';
import { EligibilityChips } from './EligibilityChips';
import { Countdown } from './Countdown';
import { SchedulePromise } from './SchedulePromise';
import { CreatedOn } from './CreatedOn';
import { Button } from './Button';
import { cn } from '../../lib/utils';
import { endsSoon, nextBoundary } from '../../lib/phase';
import type { Election, ElectionPhase } from '../../data/seed';
import { VOTING_TYPE_ICONS, votingTypeLabelKey } from '../../lib/votingTypes';

function phaseVariant(phase: ElectionPhase) {
  return phase as Parameters<typeof Badge>[0]['variant'];
}

/**
 * Phases where "you are enrolled" is news the voter can still use. Voting is
 * covered by the button, and a closed or tallying election is not something
 * being enrolled in changes, so a badge there would be decoration.
 */
const ENROLLED_PHASES: ElectionPhase[] = ['enrolling', 'pending_vote'];

/**
 * Who is looking, which decides where the card leads and what it may claim.
 *
 * `public` is Discover with nobody signed in: no clock is the visitor's, and no
 * statement about enrolment can be made about them.
 * `voter` adds their own standing and the deadlines that are theirs.
 * `organizer` is the dashboard, where every card is their own election.
 */
export type ElectionCardView = 'public' | 'voter' | 'organizer';

/**
 * Phases where a vote count is still worth a line on the organizer's own list.
 *
 * Wider than the voter's, which stops at `active`: to someone browsing, a
 * finished election's turnout is trivia, and to the organizer running it, it is
 * the number they came to the dashboard for. It was on the plain row this card
 * replaced, in every phase, and dropping it would be the one regression in the
 * change.
 */
const ORGANIZER_TURNOUT_PHASES: ElectionPhase[] = ['active', 'tallying', 'closed'];

interface ElectionCardProps {
  election: Election;
  /**
   * One prop rather than a boolean per audience. It was `voterView`, and a
   * third audience would have made it two booleans that cannot both be true,
   * which is a state the type would not have ruled out.
   */
  view?: ElectionCardView;
  className?: string;
}

export function ElectionCard({ election, view = 'public', className }: ElectionCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const voterView = view === 'voter';
  const organizerView = view === 'organizer';
  // Each waiting/live phase counts down to its own next boundary.
  const deadline = nextBoundary(election)?.deadline;
  const isLive = election.phase === 'active' || election.phase === 'enrolling';
  // Only ever said to the person it is a deadline FOR, which is what the
  // predicate already encodes; `voterView` keeps it off the public listing,
  // where it would be somebody else's clock.
  const urgent = voterView && endsSoon(election);
  /**
   * Turnout: PEOPLE who voted, over people enrolled.
   *
   * `castVotes` counts BALLOTS, and a voter who is coerced can vote again, so
   * the raw ratio passes 100%: a card with one enrolled voter who had voted
   * twice read "200% voted". This used to be capped at 100 to hide that, with a
   * comment claiming the chain kept no count of distinct voters and that
   * recovering the figure would mean reading every VoteCast event.
   *
   * That was simply wrong. `ElectionV4.distinctVoters()` exists, is read on
   * every election, and has been sitting on this object the whole time. The
   * capped estimate is gone: the number is exact.
   *
   * `castVotes` remains the fallback for seed elections, which carry no such
   * count, and the cap with it.
   */
  const voted = election.distinctVoters ?? Math.min(election.castVotes, election.totalEnrolled);
  const pct = election.totalEnrolled > 0
    ? Math.min(100, Math.round((voted / election.totalEnrolled) * 100))
    : 0;
  const turnoutLabel = t('election.turnout_detail', {
    voted,
    total: election.totalEnrolled,
  });

  const VotingTypeIcon = VOTING_TYPE_ICONS[election.votingType];

  const href = organizerView
    ? `/organizer/election/${election.id}`
    : voterView
      ? `/voter/election/${election.id}`
      : `/election/${election.id}`;

  // See ORGANIZER_TURNOUT_PHASES. Everyone else sees it only while it moves.
  const showsTurnout = organizerView
    ? ORGANIZER_TURNOUT_PHASES.includes(election.phase)
    : election.phase === 'active';

  return (
    <div
      className={cn(
        'group relative flex flex-col gap-4 p-5 rounded-3xl border border-white/5 bg-surface-low/30 backdrop-blur-xl',
        'hover:border-white/10 hover:bg-surface-low/40 transition-all duration-300 cursor-pointer',
        className
      )}
      onClick={() => navigate(href)}
      role="article"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && navigate(href)}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* STACKED, NOT SIDE BY SIDE, and neither half can give way.
              They shared a row, where the name carried `truncate` and the badge
              carried no width limit at all, so an organizer with a domain saw
              their name crushed to a single letter: "N... votain.app".
              Truncating the badge instead would be worse. A half-shown domain
              is exactly the laundering this badge exists to prevent, since
              `votacion-oficial-gob...` reads like anything at all. So the
              domain is never shortened, the name keeps its own line, and a card
              with a verified domain is one line taller than one without. */}
          <div className="mb-1.5 min-w-0">
            {/* The name goes, and only the name: on the organizer's dashboard
                every card carries their own, so repeating it down the list
                says nothing and costs the title a line. The domain badge
                stays, because it is per election and it is where they find
                out whether the one they published actually verified. */}
            {!organizerView && (
              <p className="text-xs text-on-surface-meta truncate">{election.organizer}</p>
            )}
            <DomainBadge domain={election.organizerDomain} organizerAddress={election.organizerAddress} />
          </div>
          {/* `line-clamp` hides whatever overflows the box, and at
              `leading-tight` the box is shorter than the type: the tails of
              g, p and @ fell outside it and were cut off. Roomier leading
              plus a hair of padding keeps two lines and the descenders. */}
          <h3 className="text-sm sm:text-base font-semibold text-on-surface leading-snug pb-0.5 line-clamp-2 break-words">
            {election.title}
          </h3>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0 mt-0.5">
          {/* Stacked here rather than pinned over the card's top edge, which is
              where it used to live: half outside the border, in the same corner
              and the same green as the phase pill below it, so the two read as
              one control that had come apart. Red because that is what this
              page already calls urgent, in the header count and in the
              countdown that turns the same colour on the same hour. */}
          {urgent && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-error/10 ring-1 ring-error/25 text-error text-[10px] font-semibold tracking-wide uppercase whitespace-nowrap">
              <Clock className="w-3 h-3 shrink-0" />
              {t('voter_elections.ends_soon')}
            </span>
          )}
          <Badge variant={phaseVariant(election.phase)} dot={isLive}>
            {t(`phase.${election.phase}`)}
          </Badge>
        </div>
      </div>

      {/* A card is where someone decides whether to open an election at all, so
          the rules they would have to meet belong here rather than three
          screens in. The rules themselves, not the word: "18+" and a flag
          answer "do I qualify" where "Restricted" only asks it.

          ON ITS OWN ROW, because the column above is `shrink-0` and therefore
          as wide as its widest child. These chips were that child, so an
          election demanding an Orb, an age and a nationality made the whole
          right column wide and took the width out of the organizer's name,
          which truncates: the same organizer read "Notaria Perez y Asociados"
          on one card and "Notaria Perez y ..." on another, and the only
          difference between them was how many rules they had set. Down here the
          chips have the full card to wrap into and compete with nothing. */}
      <EligibilityChips policy={election.eligibilityPolicy} />

      {/* Description */}
      <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2 break-words">
        {election.description}
      </p>

      {/* Stats, on a fixed 2x2 grid rather than a wrapping row.
          Four facts of very different widths ("Two-thirds majority" beside
          "0 enrolled") made a flex row break in a different place on every
          card, and the date, pushed right by `ml-auto`, landed on the first
          line or the second depending on what was beside it. Nothing was
          misaligned within a card and the wall of cards still read as ragged.

          Each fact is now pinned to its own cell, so the columns line up across
          every card in the list and a card without a turnout figure leaves that
          cell empty instead of reflowing the other three. The first column is
          the wider one because it carries the rule, whose label is the longest
          text here in every language. */}
      <div className="grid grid-cols-[1.35fr_1fr] gap-x-3 gap-y-1.5 text-xs text-on-surface-meta">
        {/* How it is decided, which the card never said: a plurality and a
            two-thirds bar look identical here otherwise, and they are not the
            same question being asked of the voter. */}
        <span className="col-start-1 row-start-1 flex items-center gap-1.5 min-w-0">
          <VotingTypeIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{t(votingTypeLabelKey(election.votingType))}</span>
        </span>
        <span className="col-start-2 row-start-1 flex items-center gap-1.5 min-w-0">
          <Users className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            {election.totalEnrolled.toLocaleString()} {t('election.enrolled')}
          </span>
        </span>
        {/* THE TWO DATES SHARE A ROW, AND BOTH SAY WHICH THEY ARE.
            The closing date used to be a bare "9/25/2026" behind a calendar
            icon, which was readable while it was the only date on the card.
            Adding the creation date put two bare numbers a cell apart with
            nothing to tell them apart, so the one that had never needed a
            label now needs one. Side by side rather than at opposite ends of
            the grid, because the useful thing about having both is comparing
            them: an election created yesterday that closes tomorrow reads
            very differently from the same pair a year apart.

            CREATED IS ALWAYS DRAWN when the chain knows it. It used to give
            up its cell whenever there was turnout to show, so it vanished
            from exactly the elections people look at most: every active one,
            and on the organizer's dashboard every counted and closed one
            too. A fact that appears on some cards and not others is worse
            than one that appears on none, because its absence reads as
            meaning something. */}
        <CreatedOn date={election.createdAt} className="col-start-1 row-start-2" />
        <span className="col-start-2 row-start-2 flex items-center gap-1.5 min-w-0">
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            {t('election.ends_on', { date: election.voteEnd.toLocaleDateString() })}
          </span>
        </span>
        {/* Its own row now, where it shared one with a date. Short enough
            that the empty cell beside it costs nothing, and it is the one
            number here that moves while somebody is reading the card. */}
        {showsTurnout && (
          <span className="col-start-1 row-start-3 truncate">
            {pct}% {t('election.voted')}
          </span>
        )}
        {/* Full-width rows under the grid rather than cells of their own: these
            are the longest labels here in every language, and squeezed into one
            column they truncated to nothing. Auto-placement puts them on rows 3
            and 4, so a card that makes both promises is one line taller.

            The same component the detail pages use, where this card used to
            draw its own copy of the fixed/movable line and had never been
            taught the second promise at all: an election that cannot be called
            off looked identical to one that can. */}
        <SchedulePromise
          fixedSchedule={election.fixedSchedule}
          cancellable={election.cancellable}
          compact
          className="col-span-2 min-w-0 [&>span]:truncate"
        />
      </div>

      {/* Countdown to this phase's next boundary */}
      {deadline && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-on-surface-meta">
            {(election.phase === 'upcoming' || election.phase === 'pending_vote')
              ? t('election.starts_in')
              : t('election.ends_in')}:
          </span>
          <Countdown deadline={deadline} size="sm" />
        </div>
      )}

      {/* Participation, while there is participation to show. An election with
          nobody enrolled yet drew an empty grey track: it depicted nothing the
          "0% voted" line beside it did not already say, and an unfilled bar
          reads as a component that failed to load rather than as a zero. */}
      {showsTurnout && election.totalEnrolled > 0 && (
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          // Named, because an unlabelled 1px bar announces nothing to a screen
          // reader and, to everyone else, means whatever they infer from the
          // number it happens to sit under. The label also carries the
          // denominator the percentage hides: "100% voted" is a very different
          // fact at one enrolled voter than at two hundred.
          aria-label={turnoutLabel}
          title={turnoutLabel}
          className="h-1 rounded-full bg-surface-high overflow-hidden"
        >
          <div
            className="h-full rounded-full bg-primary/60 transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* CTA */}
      <div className="flex items-center justify-between mt-auto pt-1">
        {voterView && election.isEnrolled && election.phase === 'active' && !election.hasVoted && (
          <Button
            variant="gradient"
            size="sm"
            className="rounded-full px-4"
            onClick={e => { e.stopPropagation(); navigate(`/voter/election/${election.id}`); }}
          >
            {t('election.vote_now')}
          </Button>
        )}
        {voterView && election.hasVoted && (
          <Badge variant="voted" dot>{t('phase.voted')}</Badge>
        )}
        {/* Enrolled, and nothing else on this card says so. While voting is open
            the button above already implies it, and after enrollment matters the
            fact is history, so this covers the two phases in between: the voter
            is in, and has nothing to do yet. Without it a card they had already
            joined looked exactly like one they had not, and the only way to find
            out was to open it. */}
        {voterView && election.isEnrolled && !election.hasVoted && ENROLLED_PHASES.includes(election.phase) && (
          <Badge variant="enrolled" dot>{t('election.already_enrolled')}</Badge>
        )}
        {!voterView && !election.hasVoted && (
          <span className="text-xs text-on-surface-meta">{election.candidates.length - 1} {t('election.candidates')}</span>
        )}
        <ChevronRight className="w-4 h-4 text-on-surface-meta group-hover:text-on-surface transition-colors ml-auto" />
      </div>
    </div>
  );
}
