import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ExternalLink, Users, Calendar } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { RadioGroup } from '../../components/ui/RadioCard';
import { EligibilityRow } from '../../components/ui/EligibilityRow';
import { Countdown } from '../../components/ui/Countdown';
import { StatusNotice } from '../../components/ui/StatusNotice';
import { TransactionPendingModal, type TxState } from '../../components/ui/TransactionPendingModal';
import { useElection } from '../../hooks/useElections';
import { enrollInElection } from '../../lib/voting';
import { nextBoundary, PULSE_PHASES } from '../../lib/phase';

export default function ElectionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { election, loading, live, refresh } = useElection(id);

  const [selectedCandidate, setSelectedCandidate] = useState('');
  const [showGasWarning] = useState(false);
  const [txState, setTxState] = useState<TxState>('idle');

  if (loading) {
    return (
      <PageLayout role="voter" showNav>
        <div className="flex items-center justify-center min-h-[60vh]"><Spinner /></div>
      </PageLayout>
    );
  }

  if (!election) {
    return (
      <PageLayout role="voter" showNav>
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
  const hasResults    = election.phase === 'closed' && election.ipfsCid;
  const boundary      = nextBoundary(election);
  // The ballot is only interactive for an enrolled voter who has not voted yet;
  // every other case still gets to *see* the options, just read-only.
  const canPickCandidate = isActivePhase && election.isEnrolled && !election.hasVoted;

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
        return hasResults
          ? (
            <Button variant="default" className="w-full rounded-full"
              onClick={() => navigate(`/election/${election.id}/results`)}>
              {t('election.view_results')}
              <ExternalLink className="w-4 h-4 ml-2" />
            </Button>
          )
          : infoPanel(t('results.not_available'));
    }

    if (isEnrollPhase) {
      return election.isEnrolled
        ? (
          <div className="flex items-center justify-center gap-2 py-4 text-success text-sm font-semibold">
            ✓ {t('election.already_enrolled')}
          </div>
        )
        : (
          <Button variant="gradient" size="lg" className="w-full rounded-full h-14" onClick={handleEnroll}>
            {t('election.enroll')}
          </Button>
        );
    }

    // active — already-voted voters get the change-vote card above instead.
    if (election.hasVoted) return null;
    if (!election.isEnrolled) return infoPanel(t('election.cta_not_enrolled'));
    return (
      <Button
        variant="gradient"
        size="lg"
        className="w-full rounded-full h-14"
        disabled={!selectedCandidate}
        onClick={handleVote}
      >
        {t('election.cast_vote')}
      </Button>
    );
  };

  const handleEnroll = async () => {
    // Phase A / no chain: simulate. Live: real sponsored enroll UserOp.
    if (!live) {
      setTxState('pending');
      setTimeout(() => setTxState('success'), 2500);
      return;
    }
    setTxState('pending');
    try {
      await enrollInElection(election.contractAddress);
      setTxState('success');
      void refresh();
    } catch (e) {
      console.error('Enroll failed:', e);
      setTxState('failed');
    }
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
    <PageLayout role="voter" showNav>
      <div className="max-w-2xl mx-auto pt-4 pb-28">
        <BackButton className="mb-5" />

        {/* Phase badge + title */}
        <div className="mb-5">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant={election.phase as Parameters<typeof Badge>[0]['variant']} dot={PULSE_PHASES.has(election.phase)}>
              {t(`phase.${election.phase}`)}
            </Badge>
            {election.hasVoted && <Badge variant="voted" dot>{t('phase.voted')}</Badge>}
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white leading-tight">
            {election.title}
          </h1>
          <p className="text-xs text-on-surface-meta mt-1">{t('election.by')} {election.organizer}</p>
        </div>

        {/* Countdown to the phase's next boundary (null in terminal phases). */}
        {boundary && (
          <Card className="p-4 mb-4 flex items-center gap-4 flex-wrap">
            <div>
              <p className="text-xs text-on-surface-meta mb-1">{t(boundary.labelKey)}</p>
              <Countdown deadline={boundary.deadline} size="md" />
            </div>
            {isActivePhase && (
              <div className="text-right ml-auto">
                <p className="text-lg font-bold text-on-surface">{election.castVotes.toLocaleString()}</p>
                <p className="text-xs text-on-surface-meta">{t('election.votes_cast')}</p>
              </div>
            )}
          </Card>
        )}

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

        {/* Description — shown in every phase, so a finished election is never
            just a bare title. */}
        <Card className="p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface mb-2">{t('election.about')}</h2>
          <p className="text-sm text-on-surface-variant leading-relaxed">{election.description}</p>
          <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-white/5 text-xs text-on-surface-meta">
            <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />{election.totalEnrolled.toLocaleString()} {t('election.enrolled')}</span>
            <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{election.voteEnd.toLocaleDateString()}</span>
          </div>
        </Card>

        {/* Eligibility (while the voter can still act on it) */}
        {isLivePhase && (
          <Card className="p-5 mb-4">
            <h2 className="text-sm font-semibold text-on-surface mb-3">{t('election.eligibility')}</h2>
            {election.eligibility.map(e => (
              <EligibilityRow key={e.id} label={e.label} status={e.status} description={e.description} />
            ))}
          </Card>
        )}

        {/* Ballot — interactive only when this voter can actually cast it. */}
        <Card className="p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface mb-3">
            {canPickCandidate ? t('election.select_candidate') : t('election.candidates')}
          </h2>
          {canPickCandidate ? (
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

        {/* Already voted */}
        {election.hasVoted && (
          <Card className="p-5 mb-4">
            <p className="text-sm font-medium text-on-surface mb-1">{t('election.already_voted')}</p>
            <p className="text-xs text-on-surface-meta mb-3">{t('election.reference')}: <span className="font-mono">{election.referenceNumber}</span></p>
            <Button variant="ghost" size="sm" onClick={() => navigate(`/voter/election/${election.id}/change-vote`)}>
              {t('election.change_vote')}
            </Button>
          </Card>
        )}

        {/* No gas widget for voters: their votes are sponsored by the organizer's
            gas tank via ERC-4337, so a voter never holds or spends a balance. */}

        {renderFooter()}
      </div>

      <TransactionPendingModal
        state={txState}
        onClose={() => setTxState('idle')}
      />
    </PageLayout>
  );
}
