import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Users, Calendar, ChevronRight } from 'lucide-react';
import { Badge } from './Badge';
import { DomainBadge } from './DomainBadge';
import { EligibilityChips } from './EligibilityChips';
import { Countdown } from './Countdown';
import { Button } from './Button';
import { cn } from '../../lib/utils';
import { nextBoundary } from '../../lib/phase';
import type { Election, ElectionPhase } from '../../data/seed';

function phaseVariant(phase: ElectionPhase) {
  return phase as Parameters<typeof Badge>[0]['variant'];
}

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
  const pct = election.totalEnrolled > 0
    ? Math.round((election.castVotes / election.totalEnrolled) * 100)
    : 0;

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
          <h3 className="text-sm sm:text-base font-semibold text-on-surface leading-tight line-clamp-2">
            {election.title}
          </h3>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0 mt-0.5">
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
      <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2">
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

      {/* Participation bar for active elections */}
      {election.phase === 'active' && (
        <div className="h-1 rounded-full bg-surface-high overflow-hidden">
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
        {!voterView && !election.hasVoted && (
          <span className="text-xs text-on-surface-meta">{election.candidates.length - 1} {t('election.candidates')}</span>
        )}
        <ChevronRight className="w-4 h-4 text-on-surface-meta group-hover:text-on-surface transition-colors ml-auto" />
      </div>
    </div>
  );
}
