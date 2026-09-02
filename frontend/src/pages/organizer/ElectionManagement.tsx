import { useState, useRef, type ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { XCircle, Clock, BarChart3, Users, KeyRound } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Badge } from '../../components/ui/Badge';
import { EligibilityChips } from '../../components/ui/EligibilityChips';
import { ExpandableText } from '../../components/ui/ExpandableText';
import { VotingRule } from '../../components/ui/VotingRule';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { ViewAsSwitch } from '../../components/ui/ViewAsSwitch';
import { voterViewHref } from '../../lib/electionViews';
import { PERSONHOOD_LABEL_KEY } from '../../lib/chainElections';
import { DomainBadge } from '../../components/ui/DomainBadge';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Countdown } from '../../components/ui/Countdown';
import { ResultBarChart } from '../../components/ui/BarChart';
import { BlockchainBadge } from '../../components/ui/BlockchainBadge';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/useToast';
import { useElection } from '../../hooks/useElections';
import { usePolicyRequirements } from '../../hooks/usePolicyRequirements';
import { EligibilityRow } from '../../components/ui/EligibilityRow';
import { hasPublishedResults } from '../../data/seed';
import { useOrganizerWallet } from '../../hooks/useOrganizerWallet';
import { useAuth } from '../../contexts/AuthContext';
import { cancelElection, closeVotingEarly, closeEnrollmentEarly, markVoided, publishResults } from '../../lib/organizer';
import { computeTally, hasTallyKey, resolveTallyKey, importTallyKey, MissingTallyKeyError, type TallyResult } from '../../lib/tally';
import { nextBoundary, PULSE_PHASES } from '../../lib/phase';
import { explorerAddressUrl } from '../../lib/deployments';

export default function ElectionManagement() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const wallet = useOrganizerWallet();
  // Only to pick which voter view Discover would have led to.
  const { voterLoggedIn } = useAuth();
  const { election, loading, live, refresh } = useElection(id);
  // Above the early returns: hooks must run in the same order on every render.
  const policyRequirements = usePolicyRequirements(election?.eligibilityPolicy);
  const [cancelModal, setCancelModal] = useState(false);
  const [closeModal, setCloseModal]   = useState(false);
  const [tallyModal, setTallyModal]   = useState(false);
  const [busy, setBusy] = useState(false);
  const [tallyPreview, setTallyPreview] = useState<TallyResult | null>(null);
  const [tallyError, setTallyError]     = useState<string | null>(null);
  const keyFileInput = useRef<HTMLInputElement>(null);

  if (loading) {
    return (
      <PageLayout role="organizer" showNav>
        <div className="flex items-center justify-center min-h-[60vh]"><Spinner /></div>
      </PageLayout>
    );
  }

  if (!election) {
    return (
      <PageLayout role="organizer" showNav>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <Button variant="ghost" onClick={() => navigate('/organizer/dashboard')}>{t('common.back')}</Button>
        </div>
      </PageLayout>
    );
  }

  // Runs a lifecycle tx (live) or shows the "integration pending" toast (seed).
  // `successLabel` states what happened ("Voting closed"), not what was asked
  // ("Close voting now?"): the confirmation modal already asked the question.
  const runAction = async (
    successLabel: string,
    fn: (signer: Awaited<ReturnType<typeof wallet.getSigner>>, address: string) => Promise<string>,
    close: () => void,
  ) => {
    close();
    if (!live) {
      toast({ title: successLabel, description: t('common.integration_pending'), variant: 'info' });
      return;
    }
    setBusy(true);
    try {
      if (wallet.wrongNetwork) await wallet.switchToAmoy();
      const signer = await wallet.getSigner();
      await fn(signer, election.contractAddress);
      toast({ title: successLabel, variant: 'success' });
      void refresh();
    } catch (e) {
      toast({ title: t('errors.generic_title'), description: e instanceof Error ? e.message : String(e), variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // Cancel is allowed any time before the election is decided (contract: before
  // voteEnd), including before enrollment opens and in the pending-vote gap.
  const canCancel  = ['upcoming', 'enrolling', 'pending_vote', 'active'].includes(election.phase);
  const closingEnrollment = election.phase === 'enrolling';
  // Only an *open* phase can be closed early: enrollment while enrolling, voting
  // while active. Nothing to close in upcoming or the pending-vote gap.
  const canClose   = ['enrolling', 'active'].includes(election.phase);
  const canTally   = election.phase === 'tallying';
  const boundary   = nextBoundary(election);
  // Known before the organizer clicks anything: without the key there is nothing
  // to try, so say so up front instead of failing on the button press.
  const tallyKeyPresent = hasTallyKey(election.contractAddress, election.keyNonce);
  // The key exists to make the tally possible. A decided election has either had
  // its tally published or will never have one, so from here it is only a
  // liability to be disposed of.
  const keyStillNeeded = !['closed', 'voided', 'cancelled'].includes(election.phase);

  // Drop the decrypted counts on close so reopening always recomputes from the
  // current chain state rather than showing a stale tally.
  const closeTallyModal = () => {
    setTallyModal(false);
    setTallyPreview(null);
    setTallyError(null);
  };

  const handleComputeTally = async () => {
    setBusy(true);
    setTallyError(null);
    try {
      setTallyPreview(await computeTally(election.contractAddress));
    } catch (e) {
      setTallyError(
        e instanceof MissingTallyKeyError
          ? t('election_mgmt.tally_key_missing')
          : e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  // Optional backup: download the decryption key so the tally can still be run
  // from a device without the passkey (e.g. the offline CLI, or a hardware key
  // that does not sync). The key is sensitive, so this is an explicit action.
  const handleExportKey = async () => {
    setBusy(true);
    setTallyError(null);
    try {
      const keys = await resolveTallyKey(election.contractAddress, election.keyNonce);
      if (!keys) { setTallyError(t('election_mgmt.tally_key_missing')); return; }
      const blob = new Blob([JSON.stringify(keys, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `votain-tally-key-${election.contractAddress}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: t('election_mgmt.key_exported'), variant: 'success' });
    } catch (e) {
      setTallyError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Import a key exported on another device so this one can run the tally.
  const handleImportKey = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setBusy(true);
    setTallyError(null);
    try {
      await importTallyKey(election.contractAddress, await file.text());
      toast({ title: t('election_mgmt.key_imported'), variant: 'success' });
      setTallyModal(true); // key is now present, so let them compute the tally
    } catch (err) {
      setTallyError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePublishResults = async () => {
    if (!tallyPreview) return;
    setBusy(true);
    try {
      if (wallet.wrongNetwork) await wallet.switchToAmoy();
      const signer = await wallet.getSigner();
      await publishResults(signer, election.contractAddress, tallyPreview.counts);
      toast({ title: t('election_mgmt.results_published'), variant: 'success' });
      closeTallyModal();
      void refresh();
    } catch (e) {
      toast({ title: t('errors.generic_title'), description: e instanceof Error ? e.message : String(e), variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const hasResults = hasPublishedResults(election);
  const totalVotes = election.candidates.reduce((s, c) => s + (c.votes ?? 0), 0);

  return (
    <PageLayout role="organizer" showNav>
      <div className="max-w-3xl mx-auto pt-4 pb-24">
        {/* Explicit target rather than history back: this page is reached from
            the dashboard, from the members list and from a direct link, and
            after a reload there is no history to step into at all. */}
        <div className="flex items-center justify-between gap-3 mb-5">
          <BackButton onClick={() => navigate('/organizer/dashboard')} />
          {/* What a voter sees is the thing an organizer most needs to check
              before an election opens, and there was no way to get to it. */}
          <ViewAsSwitch to="voter" href={voterViewHref(election.id, voterLoggedIn)} />
        </div>

        {/* Header */}
        <div className="mb-5">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge variant={election.phase as Parameters<typeof Badge>[0]['variant']} dot={PULSE_PHASES.has(election.phase)}>
              {t(`phase.${election.phase}`)}
            </Badge>
            {/* The rules themselves, in the same chips the lists use. The
                full sentences are further down the page; this row is for
                things you can read at a glance. */}
            <EligibilityChips policy={election?.eligibilityPolicy} />
            <BlockchainBadge href={explorerAddressUrl(election.contractAddress) ?? undefined} />
          </div>
          {/* `break-words`: a title is up to 100 characters and nothing forces
              them to contain a space. One long token cannot wrap by default, so
              it pushed the page wider than the viewport and left a horizontal
              scrollbar under everything. */}
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white leading-tight break-words">{election.title}</h1>
          {/* The organizer sees exactly what a voter sees, lapsed state included.
              They are the only one who can republish the TXT record if it has
              stopped verifying, so hiding it here would hide it from the one
              person able to act on it. */}
          {election.organizerDomain && (
            <div className="mt-2">
              <DomainBadge
                domain={election.organizerDomain}
                organizerAddress={election.organizerAddress}
                interactive
              />
            </div>
          )}
        </div>

        {/* How the election is decided, which no view of an election showed.
            Its own card rather than a line in the description card below,
            because that card is conditional on there being a description and
            the rule is not optional: it is what the ballot means. */}
        <Card className="p-5 mb-5">
          <h2 className="text-sm font-semibold text-on-surface mb-3">{t('election.voting_rule')}</h2>
          <VotingRule type={election.votingType} thresholdValue={election.thresholdValue} />
        </Card>

        {/* The organizer wrote this and could not read it back: this view went
            from the title straight to the counters, so the one person able to
            correct a description was the only one never shown it. */}
        {election.description && (
          <Card className="p-5 mb-5">
            <h2 className="text-sm font-semibold text-on-surface mb-2">{t('election.about')}</h2>
            <ExpandableText text={election.description} />
          </Card>
        )}

        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { icon: Users,    value: election.totalEnrolled, labelKey: 'election.enrolled' },
            { icon: BarChart3, value: election.castVotes,    labelKey: 'election.votes_cast' },
            { icon: Clock,    value: `${election.totalEnrolled > 0 ? Math.min(100, Math.round((election.castVotes / election.totalEnrolled) * 100)) : 0}%`, labelKey: 'election.participation' },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <Card key={i} className="p-4 flex flex-col items-center text-center">
                <Icon className="w-4 h-4 text-on-surface-meta mb-1.5" />
                <p className="text-lg font-bold text-on-surface">{s.value.toLocaleString()}</p>
                <p className="text-xs text-on-surface-meta">{t(s.labelKey)}</p>
              </Card>
            );
          })}
        </div>

        {/* Countdown to the phase's next boundary (null in terminal phases). */}
        {boundary && (
          <Card className="p-4 mb-4 flex items-center gap-4 flex-wrap">
            <div>
              <p className="text-xs text-on-surface-meta mb-1">{t(boundary.labelKey)}</p>
              <Countdown deadline={boundary.deadline} size="md" />
            </div>
          </Card>
        )}

        {/* Results (if closed) */}
        {hasResults && (
          <Card className="p-5 mb-5">
            <h2 className="text-sm font-semibold text-on-surface mb-4">{t('results.breakdown')}</h2>
            <ResultBarChart candidates={election.candidates as Parameters<typeof ResultBarChart>[0]['candidates']} totalVotes={totalVotes} />
          </Card>
        )}

        {/* Entry restrictions. The organizer chose these at creation and cannot
            change them afterwards, so this is a record of what the election was
            gated on, and the only place they can check it without reading the
            contract. It also explains a low turnout that would otherwise look
            like a problem. */}
        {/* Always rendered, because there is always at least one requirement:
            every election demands a World ID, and which KIND it demands is a
            decision the organizer made and should be able to check. Previously
            this card only appeared for attribute policies, so an organizer had
            no way to see the platform requirement at all. */}
        <Card className="p-5 mb-5">
          <h2 className="text-sm font-semibold text-on-surface mb-3">
            {t('election_mgmt.entry_requirements')}
          </h2>
          <EligibilityRow
            label={t(PERSONHOOD_LABEL_KEY[election.personhood ?? 'device'])}
            status="unknown"
          />
          {policyRequirements.map(requirement => (
            <EligibilityRow key={requirement} label={requirement} status="unknown" />
          ))}
        </Card>

        {/* The ballot itself, which this view never showed.
            The organizer wrote these options and had no way to read them back:
            checking that a candidate's name is spelled right is the thing they
            most need to do before enrollment opens, and it was the one thing
            only the voter view offered. Numbers are deliberately absent, since
            the results card below is where a decided election reports them. */}
        {election.candidates.length > 0 && (
          <Card className="p-5 mb-5">
            <h2 className="text-sm font-semibold text-on-surface mb-3">
              {t('election.candidates')}
            </h2>
            <div className="flex flex-col gap-2">
              {election.candidates.map((candidate, index) => (
                <div
                  key={candidate.id}
                  className="flex items-start gap-3 p-3 rounded-2xl bg-surface-lowest/40 border border-white/5"
                >
                  {/* The position on the ballot, not an initial: a yes/no
                      motion would show two identical letters, and the order is
                      what the voter sees. */}
                  <span className="w-7 h-7 shrink-0 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-on-surface break-words">{candidate.name}</p>
                    {candidate.description && (
                      <p className="text-xs text-on-surface-meta mt-0.5 break-words">
                        {candidate.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Organizer actions */}
        <Card className="p-5 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-on-surface mb-1">{t('election_mgmt.actions')}</h2>

          {canClose && (
            <Button variant="default" className="w-full rounded-2xl gap-2 border-warning/30 text-warning hover:bg-warning/10"
              onClick={() => setCloseModal(true)}>
              <Clock className="w-4 h-4" />
              {t(closingEnrollment ? 'election_mgmt.close_enrollment_early' : 'election_mgmt.close_early')}
            </Button>
          )}
          {canTally && (
            <Button variant="gradient" className="w-full rounded-2xl gap-2"
              onClick={() => setTallyModal(true)}>
              <BarChart3 className="w-4 h-4" />
              {t('election_mgmt.unlock_tally')}
            </Button>
          )}
          {hasResults && (
            <Button variant="default" className="w-full rounded-2xl gap-2"
              onClick={() => navigate(`/election/${election.id}/results`)}>
              <BarChart3 className="w-4 h-4" />
              {t('election_mgmt.view_results')}
            </Button>
          )}
          {canCancel && (
            <Button variant="default" className="w-full rounded-2xl gap-2 border-error/30 text-error hover:bg-error/10"
              onClick={() => setCancelModal(true)}>
              <XCircle className="w-4 h-4" />
              {t('election_mgmt.cancel')}
            </Button>
          )}
          <Button variant="ghost" className="w-full rounded-2xl"
            onClick={() => navigate(`/organizer/members?election=${election.id}`)}>
            <Users className="w-4 h-4 mr-2" />
            {t('election_mgmt.view_members')}
          </Button>
          {/* Decryption key. Both actions exist for one reason: making sure the
              tally CAN be run, from this device or another. Once the election is
              decided that reason is gone, and offering the export is worse than
              useless. Every ballot is a Paillier ciphertext sitting publicly on
              chain, and this key is the only thing between those ciphertexts and
              reading them one by one, so writing a fresh unencrypted copy of it
              into a Downloads folder is exactly the wrong end of the election to
              do it at. The right move afterwards is to delete the copies, which
              is what the note says. */}
          {keyStillNeeded ? (
            <>
              <input ref={keyFileInput} type="file" accept="application/json,.json"
                className="hidden" onChange={handleImportKey} />
              {tallyKeyPresent ? (
                <Button variant="ghost" className="w-full rounded-2xl" disabled={busy}
                  onClick={handleExportKey}>
                  <KeyRound className="w-4 h-4 mr-2" />
                  {t('election_mgmt.export_key')}
                </Button>
              ) : (
                <Button variant="ghost" className="w-full rounded-2xl" disabled={busy}
                  onClick={() => keyFileInput.current?.click()}>
                  <KeyRound className="w-4 h-4 mr-2" />
                  {t('election_mgmt.import_key')}
                </Button>
              )}
            </>
          ) : (
            <p className="text-xs text-on-surface-meta px-1 pt-1">
              {t('election_mgmt.key_no_longer_needed')}
            </p>
          )}
        </Card>

        {/* Modals */}
        <Modal open={cancelModal} onClose={() => setCancelModal(false)}
          title={t('election_mgmt.cancel_title')} description={t('election_mgmt.cancel_desc')}>
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setCancelModal(false)}>{t('common.cancel')}</Button>
            <Button variant="default" className="flex-1 border-error/30 text-error hover:bg-error/10" disabled={busy}
              onClick={() => runAction(t('election_mgmt.cancelled_done'), cancelElection, () => setCancelModal(false))}>
              {t('election_mgmt.cancel_confirm')}
            </Button>
          </div>
        </Modal>
        <Modal open={closeModal} onClose={() => setCloseModal(false)}
          title={t(closingEnrollment ? 'election_mgmt.close_enrollment_title' : 'election_mgmt.close_title')}
          description={t(closingEnrollment ? 'election_mgmt.close_enrollment_desc' : 'election_mgmt.close_desc')}>
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setCloseModal(false)}>{t('common.cancel')}</Button>
            <Button variant="gradient" className="flex-1" disabled={busy}
              onClick={() => runAction(
                closingEnrollment ? t('election_mgmt.enrollment_closed_done') : t('election_mgmt.voting_closed_done'),
                closingEnrollment ? closeEnrollmentEarly : closeVotingEarly,
                () => setCloseModal(false),
              )}>
              {t('election_mgmt.close_confirm')}
            </Button>
          </div>
        </Modal>
        {/* Tallying phase: decrypt in the browser with the organizer's Paillier
            key (which never leaves the device), review the counts, then sign the
            publishing transaction. If the privacy quorum was not met the tally
            must not be published: the election is voided instead. */}
        <Modal open={tallyModal} onClose={closeTallyModal}
          title={t('election_mgmt.tally_title')} description={t('election_mgmt.tally_desc')}>
          <div className="flex flex-col gap-3 mt-2">
            {tallyPreview && (
              <div className="px-4 py-3 rounded-2xl bg-surface-lowest/60 border border-white/8 flex flex-col gap-2">
                <p className="text-xs text-on-surface-meta">
                  {t('election_mgmt.tally_voters', { count: tallyPreview.voters })}
                </p>
                {tallyPreview.counts.map((n, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-on-surface-variant truncate pr-3">
                      {election.candidates[i]?.name ?? `#${i}`}
                    </span>
                    <span className="font-semibold text-on-surface tabular-nums">{n}</span>
                  </div>
                ))}
                {!tallyPreview.quorumMet && (
                  <p className="text-xs text-warning mt-1">
                    {t('election_mgmt.tally_quorum_short', {
                      voters: tallyPreview.voters,
                      quorum: tallyPreview.privacyQuorum,
                    })}
                  </p>
                )}
              </div>
            )}
            {!tallyKeyPresent && (
              <>
                <p className="text-xs text-warning">{t('election_mgmt.tally_key_missing')}</p>
                <Button variant="default" className="w-full gap-2" disabled={busy}
                  onClick={() => keyFileInput.current?.click()}>
                  <KeyRound className="w-4 h-4" />
                  {t('election_mgmt.import_key')}
                </Button>
              </>
            )}
            {tallyError && <p className="text-xs text-error">{tallyError}</p>}

            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={closeTallyModal}>{t('common.close')}</Button>
              {!tallyKeyPresent ? (
                // No key here: the election can still be voided if that's the intent.
                <Button variant="default" className="flex-1 border-error/30 text-error hover:bg-error/10" disabled={busy}
                  onClick={() => runAction(t('election_mgmt.voided_done'), markVoided, () => setTallyModal(false))}>
                  {t('election_mgmt.void_confirm')}
                </Button>
              ) : !tallyPreview ? (
                <Button variant="gradient" className="flex-1" disabled={busy} onClick={handleComputeTally}>
                  {busy ? t('election_mgmt.tally_computing') : t('election_mgmt.tally_compute')}
                </Button>
              ) : tallyPreview.quorumMet ? (
                <Button variant="gradient" className="flex-1" disabled={busy} onClick={handlePublishResults}>
                  {busy ? t('election_mgmt.tally_publishing') : t('election_mgmt.tally_publish')}
                </Button>
              ) : (
                <Button variant="default" className="flex-1 border-error/30 text-error hover:bg-error/10" disabled={busy}
                  onClick={() => runAction(t('election_mgmt.voided_done'), markVoided, () => setTallyModal(false))}>
                  {t('election_mgmt.void_confirm')}
                </Button>
              )}
            </div>
          </div>
        </Modal>
      </div>
    </PageLayout>
  );
}
