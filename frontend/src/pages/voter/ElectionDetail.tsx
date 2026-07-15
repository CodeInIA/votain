import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { Card } from '../../components/ui/Card';
import { RadioGroup } from '../../components/ui/RadioCard';
import { EligibilityRow } from '../../components/ui/EligibilityRow';
import { Countdown } from '../../components/ui/Countdown';
import { GasWidget } from '../../components/ui/GasWidget';
import { TransactionPendingModal, type TxState } from '../../components/ui/TransactionPendingModal';
import { getElection } from '../../data/seed';

export default function ElectionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const election = getElection(id ?? '');

  const [selectedCandidate, setSelectedCandidate] = useState('');
  const [showGasWarning] = useState(false);
  const [txState, setTxState] = useState<TxState>('idle');

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

  const handleEnroll = () => {
    setTxState('pending');
    setTimeout(() => setTxState('success'), 2500);
  };

  const handleVote = () => {
    if (!selectedCandidate) return;
    navigate(`/voter/election/${election.id}/zk-proof`, {
      state: { candidateId: selectedCandidate },
    });
  };

  return (
    <PageLayout role="voter" showNav>
      <div className="max-w-2xl mx-auto pt-4 pb-28">
        <BackButton className="mb-5" />

        {/* Phase badge + title */}
        <div className="mb-5">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant={election.phase as Parameters<typeof Badge>[0]['variant']} dot={isEnrollPhase || isActivePhase}>
              {t(`phase.${election.phase}`)}
            </Badge>
            {election.hasVoted && <Badge variant="voted" dot>{t('phase.voted')}</Badge>}
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white leading-tight">
            {election.title}
          </h1>
          <p className="text-xs text-on-surface-meta mt-1">{t('election.by')} {election.organizer}</p>
        </div>

        {/* Countdown */}
        {(isEnrollPhase || isActivePhase) && (
          <Card className="p-4 mb-4 flex items-center gap-4 flex-wrap">
            <div>
              <p className="text-xs text-on-surface-meta mb-1">
                {isEnrollPhase ? t('election.enrollment_closes') : t('election.voting_closes')}
              </p>
              <Countdown deadline={isEnrollPhase ? election.enrollEnd : election.voteEnd} size="md" />
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

        {/* Eligibility (enrollment phase) */}
        {isEnrollPhase && (
          <Card className="p-5 mb-4">
            <h2 className="text-sm font-semibold text-on-surface mb-3">{t('election.eligibility')}</h2>
            {election.eligibility.map(e => (
              <EligibilityRow key={e.id} label={e.label} status={e.status} description={e.description} />
            ))}
          </Card>
        )}

        {/* Candidate selector (active phase) */}
        {isActivePhase && !election.hasVoted && (
          <Card className="p-5 mb-4">
            <h2 className="text-sm font-semibold text-on-surface mb-3">{t('election.select_candidate')}</h2>
            <RadioGroup
              value={selectedCandidate}
              onChange={setSelectedCandidate}
              options={election.candidates.map(c => ({
                value: c.id,
                label: c.name,
                description: c.description,
              }))}
            />
          </Card>
        )}

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

        {/* Gas widget */}
        {isActivePhase && !election.hasVoted && (
          <GasWidget balanceMatic={2.5} estimatedVotesLeft={84} className="mb-4" />
        )}

        {/* CTA */}
        {isEnrollPhase && !election.isEnrolled && (
          <Button variant="gradient" size="lg" className="w-full rounded-full h-14" onClick={handleEnroll}>
            {t('election.enroll')}
          </Button>
        )}
        {isEnrollPhase && election.isEnrolled && (
          <div className="flex items-center justify-center gap-2 py-4 text-success text-sm font-semibold">
            ✓ {t('election.already_enrolled')}
          </div>
        )}
        {isActivePhase && election.isEnrolled && !election.hasVoted && (
          <Button
            variant="gradient"
            size="lg"
            className="w-full rounded-full h-14"
            disabled={!selectedCandidate}
            onClick={handleVote}
          >
            {t('election.cast_vote')}
          </Button>
        )}
      </div>

      <TransactionPendingModal
        state={txState}
        onClose={() => setTxState('idle')}
      />
    </PageLayout>
  );
}
