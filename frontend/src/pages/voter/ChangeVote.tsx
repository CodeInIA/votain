import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, AlertTriangle } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { RadioGroup } from '../../components/ui/RadioCard';
import { Modal } from '../../components/ui/Modal';
import { getElection } from '../../data/seed';

export default function ChangeVote() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const election = getElection(id ?? '');

  const [selected, setSelected] = useState(election?.userVote ?? '');
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!election) return null;

  const handleConfirm = () => {
    setConfirmOpen(false);
    navigate(`/voter/election/${election.id}/zk-proof`, {
      state: { candidateId: selected, isChangeVote: true },
    });
  };

  const selectedName = election.candidates.find(c => c.id === selected)?.name ?? '';

  return (
    <PageLayout role="voter" showNav>
      <div className="max-w-2xl mx-auto pt-4 pb-28">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-on-surface-meta hover:text-on-surface mb-5 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          {t('common.back')}
        </button>

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
