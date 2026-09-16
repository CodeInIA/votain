import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, Lock } from 'lucide-react';
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
import type { Election } from '../../data/seed';

/**
 * The parts of an election page that are the same whoever is reading it.
 *
 * WHY THESE EXIST. There are two routes to an election: `/election/:id` is
 * public and crawlable, and `/voter/election/:id` is behind a session and
 * carries the ballot. The pages behind them had converged to the point of
 * holding byte-identical markup, and had started to drift inside it: the
 * titles were set at different sizes, only one of them linked to the
 * contract, only one showed what gas was reserved, and a comment in one
 * described behaviour the other had stopped having.
 *
 * WHY NOT ONE PAGE BEHIND BOTH ROUTES, which is the obvious next step. What
 * they share is the description of the election; what they do not share is
 * everything that acts on it. The voter's page is twice the size and pulls in
 * enrolment, the attestation, the ZK proof handoff, the ballot, the receipt
 * and the transaction modal. Serving that from `/election/:id` would load the
 * whole voting stack for a reader with no session and for the crawler that
 * indexes the page, and would put a session check down the middle of one
 * component. Sharing the description and not the machinery keeps the public
 * page small and the two impossible to drift apart.
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
      <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-2 leading-tight break-words">
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
 * Every date the election has, and the count of ballots while it is running.
 *
 * Always drawn. A countdown to the next boundary used to sit here and could
 * say nothing about what came after, and on the public page it appeared only
 * while voting was open, so a closed or upcoming election showed no dates at
 * all on the one page a shared link opens.
 */
export function ElectionSchedule({ election }: { election: Election }) {
  const { t } = useTranslation();
  return (
    <Card className="p-4 mb-4 flex items-start gap-4 flex-wrap">
      <PhaseTimeline election={election} className="flex-1 min-w-[15rem]" />
      {election.phase === 'active' && (
        <div className="text-right ml-auto">
          <p className="text-lg font-bold text-on-surface">
            {election.castVotes.toLocaleString()}
          </p>
          <p className="text-xs text-on-surface-meta">{t('election.votes_cast')}</p>
        </div>
      )}
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
export function ElectionAbout({ election }: { election: Election }) {
  const { t } = useTranslation();
  const funding = useElectionFunding(election.contractAddress);
  const voteCost = useVoteCost();
  const reservedBallots = Math.floor(funding.reserved / voteCost.matic);

  return (
    <Card className="p-5 mb-4">
      <h2 className="text-sm font-semibold text-on-surface mb-2">{t('election.about')}</h2>
      <ExpandableText text={election.description} />
      <div className="mt-4 pt-4 border-t border-white/5">
        <VotingRule type={election.votingType} thresholdValue={election.thresholdValue} />
      </div>
      <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-white/5 text-xs text-on-surface-meta">
        <span className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          {election.totalEnrolled.toLocaleString()} {t('election.enrolled')}
        </span>
        {/* Together and last: the longest labels in the row, so wrapping
            takes both at once. */}
        <SchedulePromise
          fixedSchedule={election.fixedSchedule}
          cancellable={election.cancellable}
        />
        {/* WHAT IS RESERVED, stated as a fact among the other facts rather
            than as a banner, and on both pages rather than only the voter's.
            The reserve is a promise made on chain that the organizer cannot
            revoke, and a promise nobody can see is worth a great deal less;
            whether an election can pay for its own ballots is exactly what
            someone reads a shared link to find out.

            A line, not a coloured box: a box that appears when all is well on
            every election is how people learn to stop reading the one that
            appears when it is not. */}
        {reservedBallots > 0 && (
          <span className="flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            {t('funding.reserved_votes', { votes: reservedBallots })}
          </span>
        )}
      </div>
    </Card>
  );
}
