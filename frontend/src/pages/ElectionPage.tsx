import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ExternalLink, Copy, Check, Lock, Bookmark } from 'lucide-react';
import { PageLayout } from '../components/layout/PageLayout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { BackButton } from '../components/ui/BackButton';
import { useAuth } from '../contexts/AuthContext';
import { useSavedElections } from '../hooks/useSavedElections';
import { usePageMeta } from '../seo/usePageMeta';
import { useOrganizerWallet } from '../hooks/useOrganizerWallet';
import { ViewAsSwitch } from '../components/ui/ViewAsSwitch';
import { organizerViewHref, canManageElection } from '../lib/electionViews';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { RadioGroup } from '../components/ui/RadioCard';
import { EligibilityRow } from '../components/ui/EligibilityRow';
import {
  ElectionAbout,
  ElectionHeader,
  ElectionSchedule,
} from '../components/ui/ElectionSummary';
import { StatusNotice } from '../components/ui/StatusNotice';
import { TransactionPendingModal, type TxState } from '../components/ui/TransactionPendingModal';
import { useElection } from '../hooks/useElections';
import { shortenReference, cn } from '../lib/utils';
import { usePolicyRequirements } from '../hooks/usePolicyRequirements';
import { ResultBarChart } from '../components/ui/BarChart';
import { hasPublishedResults, tallyTotal } from '../data/seed';
import { enrollInElection, votingIdentity } from '../lib/voting';
import { FundingNotice } from '../components/ui/FundingNotice';
import { useElectionFunding } from '../hooks/useElectionFunding';
import { canFundOneVote } from '../lib/gasNeeds';
import { useVoteCost } from '../hooks/useVoteCost';
import { EligibilityCheck } from '../components/voter/EligibilityCheck';
import { relayErrorMessage } from '../lib/relay';
import { isEmptyPolicy } from '../lib/eligibility';
import { getStoredCommitment } from '../lib/semaphore';
import { useVoterIdentity } from '../hooks/useVoterIdentity';
import { rememberReturnTo } from '../lib/returnTo';

/**
 * One election, for whoever is looking at it.
 *
 * THERE USED TO BE TWO OF THESE. `/election/:id` served a public preview and
 * `/voter/election/:id` served the ballot, and the two had converged until
 * they held byte-identical markup and had begun to drift inside it. Their
 * shared description came out into `ElectionSummary` first; this is the rest
 * of the answer, and it removes the question of which link to hand someone.
 *
 * ONE ROUTE, `/election/:id`, public and crawlable. The old voter path
 * redirects to it so links already sent out keep working.
 *
 * WHAT A SESSION CHANGES is the footer and the ballot, and nothing above
 * them. A reader with no session gets the same schedule, the same rules and
 * the same candidates, and is asked to verify only at the point where acting
 * begins. Everything that needs a session to be ANSWERED, rather than to be
 * acted on, is guarded here rather than assumed: `isEnrolled` and `hasVoted`
 * are undefined without one, which is not the same as false.
 *
 * The voting steps that follow, the proof, the confirmation and the change of
 * vote, stay behind `RequireVoter` at their own paths. They cannot begin
 * without a session and there is nothing to show a reader who lacks one.
 */
export default function ElectionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { election, loading, live, refresh } = useElection(id);
  const { voterLoggedIn, organizerLoggedIn } = useAuth();
  const { isSaved, toggle } = useSavedElections();
  // Public and crawlable, so the tab and the crawler snapshot need the real
  // title rather than the site name. Falls back until the chain answers.
  usePageMeta({ title: election?.title, description: election?.description });
  const wallet = useOrganizerWallet();
  // Computed with optional chaining so it sits above the loading and not-found
  // early returns, where the election may not exist yet.
  const canManage = canManageElection(
    organizerLoggedIn,
    wallet.address,
    election?.organizerAddress,
  );

  const [selectedCandidate, setSelectedCandidate] = useState('');
  const [showGasWarning] = useState(false);
  const [referenceCopied, setReferenceCopied] = useState(false);
  const [txState, setTxState] = useState<TxState>('idle');
  const [txError, setTxError] = useState<string | null>(null);

  // The policy travels with the election, verified against the contract's hash
  // in `chainElections`. It used to be a separate request to the backend, which
  // meant a second thing that could fail and a state for not knowing. Reading it
  // from data the page already had to load removes both.
  const [showEligibility, setShowEligibility] = useState(false);
  const eligibilityPolicy = election?.eligibilityPolicy ?? null;
  // Truthiness is not the question: a policy object can exist and demand
  // nothing, and a policy that demands only a document has no attributes to
  // show but still has to go through the scan.
  const isGated = !isEmptyPolicy(eligibilityPolicy);
  const policyRequirements = usePolicyRequirements(eligibilityPolicy);
  // ABOVE THE EARLY RETURNS, with every other hook, and it has to be. It sat
  // below them, so the first render (still loading) never reached it and the
  // one after did: React counts hooks by call order, saw one more than last
  // time and threw "Rendered more hooks than during the previous render",
  // which took the whole election page down rather than degrading it.
  //
  // `live` comes from `useElection` above and does not depend on the election
  // having loaded, so there was never a reason for it to be down there. The
  // comment on `canManage` says the same thing about the same two returns.
  const { ready: identityReady, unlocking, unlock } = useVoterIdentity(live);
  /**
   * Whether this election can pay for a ballot at all.
   *
   * Read before the voter commits to anything, because the alternative is a
   * revert after the proof has been generated, which on a phone is two minutes
   * of work thrown away.
   *
   * UP HERE for the same reason as the line above it, and the test that guards
   * this file caught it sitting below: an optional argument is not what makes a
   * hook conditional, its POSITION is, and this one had been written next to
   * the code that uses it. The hook tolerates `undefined` and does nothing with
   * it, which is what makes calling it before the election has loaded correct.
   */
  const funding = useElectionFunding(election?.contractAddress);
  // Above the early returns with every other hook, for the reason written there.
  const voteCost = useVoteCost();
  // A slow read must never look like an empty tank, so nothing is blocked while
  // it is loading, or if the chain refused to answer.
  const canPayForAVote =
    funding.loading ||
    funding.error ||
    canFundOneVote(funding.reserved, funding.free, voteCost.matic);
  // Only the reserve is counted. The organizer's free balance would pay too, and
  // they can also withdraw it whenever they like, so it is not theirs to promise.


  // The chrome follows the reader: a visitor with no session must not be
  // given the voter's navigation.
  const layoutRole = voterLoggedIn ? 'voter' : 'public';

  if (loading) {
    return (
      <PageLayout role={layoutRole} showNav>
        <div className="flex items-center justify-center min-h-[60vh]"><Spinner /></div>
      </PageLayout>
    );
  }

  if (!election) {
    return (
      <PageLayout role={layoutRole} showNav>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <span className="text-5xl mb-4">🗳️</span>
          <h2 className="text-xl font-bold text-on-surface mb-2">{t('errors.not_found')}</h2>
          <Button variant="ghost" onClick={() => navigate(-1)}>{t('common.back')}</Button>
        </div>
      </PageLayout>
    );
  }

  const isEnrollPhase = election.phase === 'enrolling';
  const isActivePhase = election.phase === 'active';
  const isLivePhase   = isEnrollPhase || isActivePhase;
  const hasResults     = hasPublishedResults(election);
  // The ballot is only interactive for an enrolled voter who has not voted yet;
  // every other case still gets to *see* the options, just read-only.
  const canPickCandidate = isActivePhase && election.isEnrolled && !election.hasVoted;

  /**
   * Whether this device can even tell if the voter is enrolled.
   *
   * Enrolment is read from the chain by commitment, and the commitment comes
   * from the identity, which is sealed. With nothing stored here the answer is
   * UNKNOWN, and that is not the same as "not enrolled": showing the enrol
   * button then invites somebody to enrol twice.
   *
   * This used to resolve itself in an effect, so opening an election summoned
   * an authenticator dialog on its own, unannounced, exactly the pattern the
   * sign-in step was rebuilt to avoid. Now it is asked for, with a reason.
   */
  // `voterLoggedIn` first, and it is not redundant. Without a session
  // `isEnrolled` is undefined and no commitment is stored, which is exactly
  // the shape of "we cannot tell" and would have offered a visitor a button
  // to unlock an identity they have not got.
  const enrolmentUnknown =
    voterLoggedIn &&
    live &&
    election.isEnrolled === undefined &&
    getStoredCommitment() === null &&
    !identityReady;

  const infoPanel = (message: string) => (
    <StatusNotice message={message} />
  );

  /** Phase-appropriate footer: an action while the election is live, a status once it is not. */
  const renderFooter = () => {
    switch (election.phase) {
      case 'upcoming':
        return infoPanel(t('election.cta_upcoming'));
      case 'pending_vote':
        return infoPanel(t('election.cta_pending_vote'));
      case 'cancelled':
        return infoPanel(t('election.cta_cancelled'));
      case 'voided':
        return infoPanel(t('election.cta_voided'));
      case 'tallying':
        return infoPanel(t('election.cta_tallying'));
      case 'closed':
        // No footer action once the results are on the page: the breakdown is
        // above with its own link to the full view, and repeating it as the
        // main call to action would send the reader away from what they came for.
        return hasResults ? null : infoPanel(t('results.not_available'));
    }

    /**
     * The live phases need an identity, so this is where a reader without one
     * is asked for it, and not a moment earlier. Everything above is worth
     * reading signed out.
     *
     * `/voter/onboarding` rather than the plain sign in: someone arriving on
     * a link to a specific election has most likely never seen Votain, and
     * both doors end at the same World ID verification anyway. What matters
     * more than the door is coming back here afterwards, which is what
     * `rememberReturnTo` is for.
     */
    if (!voterLoggedIn) {
      return (
        <div className="bg-surface-low/30 backdrop-blur-xl rounded-3xl border border-white/5 p-5 flex flex-col sm:flex-row items-center gap-4">
          <div className="flex items-center gap-3">
            <Lock className="w-5 h-5 text-on-surface-meta shrink-0" />
            <p className="text-sm text-on-surface-variant">{t('election.auth_cta')}</p>
          </div>
          <Button
            variant="gradient"
            className="w-full sm:w-auto rounded-full px-6"
            onClick={() => {
              rememberReturnTo(`/election/${election.id}`);
              navigate('/voter/onboarding');
            }}
          >
            {t('election.verify_to_vote')}
          </Button>
        </div>
      );
    }

    // Before any of the live-phase actions: none of them can be right while
    // the answer they depend on is unknown.
    if (enrolmentUnknown) {
      return (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-xs text-on-surface-meta max-w-md">{t('election.enrolment_unknown')}</p>
          <Button
            variant="ghost"
            className="rounded-full px-6 gap-2"
            disabled={unlocking}
            onClick={() => {
              // Derive this election's identity before re-reading: the enrolled
              // check compares against the commitment THIS election holds, and
              // a device that has never enrolled here has never derived it.
              void unlock()
                .then(ok => (ok ? votingIdentity(election.contractAddress) : null))
                .then(() => refresh());
            }}
          >
            <Lock className="w-4 h-4" />
            {unlocking ? t('common.loading') : t('election.check_enrolment')}
          </Button>
        </div>
      );
    }

    if (isEnrollPhase) {
      // The attribute check takes over the footer while it runs: the voter has
      // a phone to pick up, and leaving the enrol button live underneath it
      // would invite a second attempt that the contract would reject anyway.
      if (showEligibility && isGated && eligibilityPolicy) {
        return (
          <EligibilityCheck
            election={election.contractAddress}
            policy={eligibilityPolicy}
            onVerified={sessionId => {
              setShowEligibility(false);
              void submitEnrollment(sessionId);
            }}
            onCancel={() => setShowEligibility(false)}
          />
        );
      }

      return election.isEnrolled
        ? (
          <div className="flex items-center justify-center gap-2 py-4 text-success text-sm font-semibold">
            ✓ {t('election.already_enrolled')}
          </div>
        )
        : (
          <div className="flex flex-col gap-2">
            {/* THE HARD STOP GOES HERE, not at the ballot. Being turned away
                before enrolling is recoverable: come back when the organizer
                has topped up. Being enrolled and then unable to vote, possibly
                on the last day, is a vote lost. */}
            <FundingNotice
              election={election}
              reserved={funding.reserved}
              organizerFree={funding.free}
              className="mb-1"
            />
            <Button
              variant="gradient"
              size="lg"
              className="w-full rounded-full h-14"
              disabled={!canPayForAVote}
              onClick={handleEnroll}
            >
              {t('election.enroll')}
            </Button>
            {/* Said before the tap, not after: a voter without a passport to
                hand should find that out here rather than mid-flow. */}
            {isGated && (
              <p className="text-xs text-on-surface-meta text-center">
                {t('eligibility.restricted_hint')}
              </p>
            )}
          </div>
        );
    }

    // active: already-voted voters get the change-vote card above instead.
    if (election.hasVoted) return null;
    if (!election.isEnrolled) return infoPanel(t('election.cta_not_enrolled'));
    return (
      <div className="flex flex-col gap-2">
        {/* Warned, not blocked. The balance was read when the page loaded and
            may have changed since, so refusing a ballot that would have gone
            through would be a failure of its own. If it really is empty the
            relay says so, and that message is already written for the voter. */}
        <FundingNotice
          election={election}
          reserved={funding.reserved}
          organizerFree={funding.free}
          className="mb-1"
        />
        <Button
          variant="gradient"
          size="lg"
          className="w-full rounded-full h-14"
          disabled={!selectedCandidate}
          onClick={handleVote}
        >
          {t('election.cast_vote')}
        </Button>
      </div>
    );
  };

  // Copies the FULL reference, never the shortened form on screen.
  const copyReference = async () => {
    if (!election?.voteNullifier) return;
    await navigator.clipboard.writeText(election.voteNullifier);
    setReferenceCopied(true);
    setTimeout(() => setReferenceCopied(false), 2000);
  };

  const submitEnrollment = async (sessionId?: string) => {
    setTxError(null);
    setTxState('pending');
    try {
      await enrollInElection(election.contractAddress, sessionId);
      setTxState('success');
      void refresh();
    } catch (e) {
      console.error('Enroll failed:', e);
      // The reason used to stop here, at the console. A voter turned away by an
      // organizer's empty gas tank saw "transaction failed" and had no way to
      // know it was not their fault, nor that the fix is somebody else's.
      setTxError(relayErrorMessage(e));
      setTxState('failed');
    }
  };

  const handleEnroll = async () => {
    // Phase A / no chain: simulate. Live: real relayed enrollment.
    if (!live) {
      setTxState('pending');
      setTimeout(() => setTxState('success'), 2500);
      return;
    }

    // A restricted election cannot be enrolled in directly: the contract
    // refuses the plain entry point, so the attribute check has to come first.
    if (isGated) {
      setShowEligibility(true);
      return;
    }

    await submitEnrollment();
  };

  const handleVote = () => {
    if (!selectedCandidate) return;
    // Option index = position in the candidates array (last entry is blank vote).
    const optionIndex = election.candidates.findIndex(c => c.id === selectedCandidate);
    navigate(`/voter/election/${election.id}/zk-proof`, {
      state: { candidateId: selectedCandidate, optionIndex, live, address: election.contractAddress },
    });
  };

  return (
    <PageLayout role={layoutRole} showNav>
      <div className="max-w-2xl mx-auto pt-4 pb-28">
        <div className="flex items-center justify-between gap-3 mb-5">
          <BackButton />
          <div className="flex items-center gap-2">
            {/* HERE AS WELL AS ON THE CARD, because this is where somebody
                decides. A voter reads the question, the dates and the rules on
                this page and then wants to keep it for when enrolment opens;
                sending them back to the list to find the bookmark they just
                scrolled past is the kind of detour that makes a feature go
                unused. Labelled rather than a bare icon: there is room, and the
                page is read slowly.

                Not for the organizer of this election, who has a panel for it
                and no reason to follow their own vote. */}
            {voterLoggedIn && !canManage && (
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={isSaved(election.id)}
                className="rounded-full gap-2"
                onClick={() => toggle(election.id)}
              >
                <Bookmark className={cn('w-4 h-4', isSaved(election.id) && 'fill-current text-primary')} />
                {t(isSaved(election.id) ? 'saved.remove' : 'saved.add')}
              </Button>
            )}
            {canManage && (
              <ViewAsSwitch to="organizer" href={organizerViewHref(election.id)} />
            )}
          </div>
        </div>

        <ElectionHeader
          election={election}
          extraBadges={election.hasVoted ? <Badge variant="voted" dot>{t('phase.voted')}</Badge> : null}
        />

        <ElectionSchedule election={election} />

        {/* Gas warning banner */}
        {showGasWarning && isActivePhase && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-warning/10 border border-warning/20 mb-4">
            <AlertTriangle className="w-4.5 h-4.5 text-warning shrink-0" />
            <p className="text-xs text-warning">{t('election.gas_low_banner')}</p>
            <Button variant="ghost" size="sm" className="ml-auto shrink-0 text-warning hover:text-warning/80"
              onClick={() => navigate('/voter/profile')}>
              {t('election.top_up')}
            </Button>
          </div>
        )}

        <ElectionAbout election={election} />

        {/* Eligibility (while the voter can still act on it) */}
        {isLivePhase && (
          <Card className="p-5 mb-4">
            <h2 className="text-sm font-semibold text-on-surface mb-3">{t('election.eligibility')}</h2>
            {election.eligibility.map(e => (
              <EligibilityRow key={e.id} label={e.label} status={e.status} description={e.description} />
            ))}
            {/* The attribute restrictions belong here, beside the other entry
                conditions, not hidden until the voter presses enrol. Someone
                without a passport to hand should be able to see that this
                election is not for them without starting a flow to find out.

                `unknown` until enrolled, and MET after. Not a guess either way:
                the proof happens on the voter's phone and never reaches this
                browser, so before enrollment nothing here knows their age or
                nationality and a green tick would be an invention. Afterwards
                the chain knows: the contract refuses `enrollAttested` without a
                signature the attester only produces once a document proof has
                cleared this exact policy, so membership IS the evidence that
                every line below was satisfied. Leaving them grey for the rest of
                the election said less than the page actually knew. */}
            {policyRequirements.map(requirement => (
              <EligibilityRow
                key={requirement}
                label={requirement}
                status={election.isEnrolled ? 'met' : 'unknown'}
              />
            ))}
          </Card>
        )}

        {/* Ballot, or the result once there is one.
            A decided election has its totals on chain already, so listing the
            candidates with no numbers and a button to go and see them elsewhere
            withholds what the page is for. The full results view still exists
            for the verification badges and the audit trail; this is the answer. */}
        <Card className="p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface mb-3">
            {hasResults
              ? t('results.breakdown')
              : canPickCandidate ? t('election.select_candidate') : t('election.candidates')}
          </h2>
          {hasResults ? (
            <>
              <ResultBarChart
                candidates={election.candidates as Parameters<typeof ResultBarChart>[0]['candidates']}
                totalVotes={tallyTotal(election)}
              />
              <Button
                variant="ghost"
                size="sm"
                className="mt-4"
                onClick={() => navigate(`/election/${election.id}/results`)}
              >
                {t('election.view_results')}
                <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </>
          ) : canPickCandidate ? (
            <RadioGroup
              value={selectedCandidate}
              onChange={setSelectedCandidate}
              options={election.candidates.map(c => ({
                value: c.id,
                label: c.name,
                description: c.description,
              }))}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {election.candidates.map(c => (
                <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-lowest/40 border border-white/5">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                    {c.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface">{c.name}</p>
                    {c.description && <p className="text-xs text-on-surface-meta">{c.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Already voted. The receipt stays visible for the life of the election,
            because it is the voter's own proof that they took part. The button
            does not: re-voting is only possible while voting is open, so offering
            it on a closed, tallying, cancelled or voided election invites an
            action the contract would reject. */}
        {election.hasVoted && (
          <Card className="p-5 mb-4">
            <p className="text-sm font-medium text-on-surface mb-1">{t('election.already_voted')}</p>
            {/* Shortened for display and copied in full, the same treatment the
                confirmation screen gives it. A reference is one unbroken hex
                token, so at full length it does not wrap and simply leaves the
                card on a phone. */}
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs text-on-surface-meta min-w-0">
                {t('election.reference')}:{' '}
                <span className="font-mono">{shortenReference(election.voteNullifier ?? '')}</span>
              </p>
              <button
                type="button"
                aria-label={t('common.copy')}
                onClick={() => { void copyReference(); }}
                className="text-on-surface-meta hover:text-on-surface cursor-pointer shrink-0"
              >
                {referenceCopied
                  ? <Check className="w-3.5 h-3.5 text-success" />
                  : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            {isActivePhase && (
              <Button variant="ghost" size="sm" onClick={() => navigate(`/voter/election/${election.id}/change-vote`)}>
                {t('election.change_vote')}
              </Button>
            )}
          </Card>
        )}

        {/* No gas widget for voters: their votes are sponsored by the organizer's
            gas tank through the relay contract, so a voter never holds or spends a balance. */}

        {renderFooter()}
      </div>

      <TransactionPendingModal
        state={txState}
        errorMessage={txError ?? undefined}
        onClose={() => { setTxState('idle'); setTxError(null); }}
      />
    </PageLayout>
  );
}
