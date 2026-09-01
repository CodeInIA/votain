import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Users, Calendar, ChevronRight, Clock } from 'lucide-react';
import { Badge } from './Badge';
import { DomainBadge } from './DomainBadge';
import { EligibilityChips } from './EligibilityChips';
import { Countdown } from './Countdown';
import { Button } from './Button';
import { cn } from '../../lib/utils';
import { endsSoon, nextBoundary } from '../../lib/phase';
import type { Election, ElectionPhase } from '../../data/seed';

function phaseVariant(phase: ElectionPhase) {
  return phase as Parameters<typeof Badge>[0]['variant'];
}

/**
 * Phases where "you are enrolled" is news the voter can still use. Voting is
 * covered by the button, and a closed or tallying election is not something
 * being enrolled in changes, so a badge there would be decoration.
 */
const ENROLLED_PHASES: ElectionPhase[] = ['enrolling', 'pending_vote'];

interface ElectionCardProps {
  election: Election;
  voterView?: boolean;
  className?: string;
}

export function ElectionCard({ election, voterView = false, className }: ElectionCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // Each waiting/live phase counts down to its own next boundary.
  const deadline = nextBoundary(election)?.deadline;
  const isLive = election.phase === 'active' || election.phase === 'enrolling';
  // Only ever said to the person it is a deadline FOR, which is what the
  // predicate already encodes; `voterView` keeps it off the public listing,
  // where it would be somebody else's clock.
  const urgent = voterView && endsSoon(election);
  /**
   * Turnout, as closely as the chain can tell it.
   *
   * `castVotes` counts BALLOTS, and a voter changing their mind casts a second
   * one, so the raw ratio passes 100%: a card showing one enrolled voter who
   * had voted twice read "200% voted". The chain keeps no count of distinct
   * voters, only a per-nullifier nonce, so recovering the exact figure would
   * mean reading every VoteCast event of every election in the list. Capped
   * instead, which is right whenever the re-voters had already been counted and
   * an over-estimate otherwise. Never absurd, which the raw number was.
   */
  const pct = election.totalEnrolled > 0
    ? Math.min(100, Math.round((election.castVotes / election.totalEnrolled) * 100))
    : 0;
  const turnoutLabel = t('election.turnout_detail', {
    voted: Math.min(election.castVotes, election.totalEnrolled),
    total: election.totalEnrolled,
  });

  const href = voterView
    ? `/voter/election/${election.id}`
    : `/election/${election.id}`;

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
          <div className="flex items-center gap-2 mb-1.5 min-w-0">
            <p className="text-xs text-on-surface-meta truncate">{election.organizer}</p>
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
          {/* A card is where someone decides whether to open an election at
              all, so the rules they would have to meet belong here rather than
              three screens in. The rules themselves, not the word: "18+" and a
              flag answer "do I qualify" where "Restricted" only asks it. */}
          <EligibilityChips policy={election.eligibilityPolicy} className="justify-end" />
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2 break-words">
        {election.description}
      </p>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-on-surface-meta">
        <span className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          {election.totalEnrolled.toLocaleString()} {t('election.enrolled')}
        </span>
        {election.phase === 'active' && (
          <span className="text-on-surface-meta">{pct}% {t('election.voted')}</span>
        )}
        <span className="flex items-center gap-1.5 ml-auto">
          <Calendar className="w-3.5 h-3.5" />
          {election.voteEnd.toLocaleDateString()}
        </span>
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
      {election.phase === 'active' && election.totalEnrolled > 0 && (
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
