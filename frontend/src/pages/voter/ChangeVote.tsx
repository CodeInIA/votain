import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { RadioGroup } from '../../components/ui/RadioCard';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { useElection } from '../../hooks/useElections';

export default function ChangeVote() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { election, loading, live } = useElection(id);

  const [selected, setSelected] = useState(election?.userVote ?? '');
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (loading) {
    return (
      <PageLayout role="voter" showNav>
        <div className="flex items-center justify-center min-h-[60vh]"><Spinner /></div>
      </PageLayout>
    );
  }

  if (!election) return null;

  // Reachable by its own URL, so the guard cannot live only on the button that
  // links here. Re-voting runs through the same `castVote` the contract limits
  // to an open voting window, so any other phase would let the voter pick a
  // candidate, generate a proof and only then be refused.
  if (election.phase !== 'active') {
    return (
      <PageLayout role="voter" showNav>
        <div className="max-w-2xl mx-auto pt-4 pb-28">
          <BackButton className="mb-5" />
          <Card className="p-5 flex items-start gap-3">
            <AlertTriangle className="w-4.5 h-4.5 text-warning shrink-0 mt-0.5" />
            <p className="text-sm text-on-surface">{t('change_vote.voting_closed')}</p>
          </Card>
        </div>
      </PageLayout>
    );
  }

  const handleConfirm = () => {
    setConfirmOpen(false);
    // Re-vote is the same castVote path: same nullifier, next nonce is read on-chain.
    const optionIndex = election.candidates.findIndex(c => c.id === selected);
    navigate(`/voter/election/${election.id}/zk-proof`, {
      state: { candidateId: selected, isChangeVote: true, optionIndex, live, address: election.contractAddress },
    });
  };

  const selectedName = election.candidates.find(c => c.id === selected)?.name ?? '';

  return (
    <PageLayout role="voter" showNav>
      <div className="max-w-2xl mx-auto pt-4 pb-28">
        <BackButton className="mb-5" />

        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white mb-1">{t('change_vote.title')}</h1>
        <p className="text-xs text-on-surface-meta mb-6">{election.title}</p>

        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-warning/10 border border-warning/20 mb-6">
          <AlertTriangle className="w-4.5 h-4.5 text-warning shrink-0" />
          <p className="text-xs text-warning">{t('change_vote.warning')}</p>
        </div>

        <Card className="p-5 mb-6">
          <h2 className="text-sm font-semibold text-on-surface mb-3">{t('change_vote.new_choice')}</h2>
          <RadioGroup
            value={selected}
            onChange={setSelected}
            options={election.candidates.map(c => ({
              value: c.id,
              label: c.name,
              description: c.description,
            }))}
          />
        </Card>

        <Button
          variant="gradient"
          size="lg"
          className="w-full rounded-full h-14"
          disabled={!selected || selected === election.userVote}
          onClick={() => setConfirmOpen(true)}
        >
          {t('change_vote.confirm_change')}
        </Button>

        <Modal
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title={t('change_vote.modal_title')}
          description={t('change_vote.modal_desc', { candidate: selectedName })}
        >
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="gradient" className="flex-1" onClick={handleConfirm}>
              {t('change_vote.confirm_change')}
            </Button>
          </div>
        </Modal>
      </div>
    </PageLayout>
  );
}
