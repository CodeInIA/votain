import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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

/** One figure and what it is, in the panel beside the schedule. */
function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-lg font-bold text-on-surface tabular-nums leading-tight">{value}</p>
      <p className="text-xs text-on-surface-meta">{label}</p>
      {hint && <p className="text-[11px] text-on-surface-meta/80 leading-snug mt-0.5">{hint}</p>}
    </div>
  );
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
 * ON A PHONE it wraps under the schedule and becomes a row of figures rather
 * than a column, which is why the panel sets its own direction at `sm` rather
 * than inheriting one.
 */
export function ElectionSchedule({ election }: { election: Election }) {
  const { t } = useTranslation();
  const funding = useElectionFunding(election.contractAddress);
  const voteCost = useVoteCost();
  const reservedBallots = Math.floor(funding.reserved / voteCost.matic);

  // Ballots, not people: `castVotes` counts re-votes too, which is the whole
  // point of being able to change your mind. `tallyTotal` is what a published
  // result adds up to, and that is drawn elsewhere.
  const showVotes = election.castVotes > 0;

  return (
    <Card className="p-4 mb-4 flex flex-col sm:flex-row items-start gap-4">
      <PhaseTimeline election={election} className="flex-1 min-w-0 sm:min-w-[15rem]" />
      <div
        className="w-full sm:w-auto sm:min-w-[9.5rem] flex flex-row flex-wrap sm:flex-col gap-x-6 gap-y-3
                   pt-3 sm:pt-0 border-t sm:border-t-0 sm:border-l border-white/5 sm:pl-4"
      >
        <Figure
          label={t('election.enrolled')}
          value={election.totalEnrolled.toLocaleString()}
        />
        {showVotes && (
          <Figure
            label={t('election.votes_cast')}
            value={election.castVotes.toLocaleString()}
          />
        )}
        {reservedBallots > 0 && (
          <Figure
            label={t('election.reserved_ballots')}
            value={reservedBallots.toLocaleString()}
          />
        )}
        {election.privacyQuorum > 0 && (
          <Figure
            label={t('create.privacy_quorum')}
            value={election.privacyQuorum.toLocaleString()}
            hint={t('create.quorum_hint')}
          />
        )}
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
export function ElectionAbout({ election }: { election: Election }) {
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
        <SchedulePromise
          fixedSchedule={election.fixedSchedule}
          cancellable={election.cancellable}
        />
      </div>
    </Card>
  );
}
