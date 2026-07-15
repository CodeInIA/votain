import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, XCircle, Clock, BarChart3, Users } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Countdown } from '../../components/ui/Countdown';
import { ResultBarChart } from '../../components/ui/BarChart';
import { BlockchainBadge } from '../../components/ui/BlockchainBadge';
import { useToast } from '../../components/ui/Toast';
import { getElection } from '../../data/seed';

export default function ElectionManagement() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const election = getElection(id ?? '');
  const [cancelModal, setCancelModal] = useState(false);
  const [closeModal, setCloseModal]   = useState(false);
  const [tallyModal, setTallyModal]   = useState(false);

  if (!election) {
    return (
      <PageLayout role="organizer" showNav>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <Button variant="ghost" onClick={() => navigate(-1)}>{t('common.back')}</Button>
        </div>
      </PageLayout>
    );
  }

  const action = (msg: string) => {
    toast({ title: msg, description: t('common.integration_pending'), variant: 'info' });
  };

  const canCancel  = ['enrolling', 'active'].includes(election.phase);
  const canClose   = election.phase === 'active';
  const canTally   = election.phase === 'tallying';
  const hasResults = election.phase === 'closed' && election.candidates.some(c => c.votes !== undefined);
  const totalVotes = election.candidates.reduce((s, c) => s + (c.votes ?? 0), 0);

  return (
    <PageLayout role="organizer" showNav>
      <div className="max-w-3xl mx-auto pt-4 pb-24">
        <button type="button" onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-on-surface-meta hover:text-on-surface mb-5 transition-colors cursor-pointer">
          <ChevronLeft className="w-4 h-4" />{t('common.back')}
        </button>

        {/* Header */}
        <div className="mb-5">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge variant={election.phase as Parameters<typeof Badge>[0]['variant']} dot={election.phase === 'active' || election.phase === 'enrolling'}>
              {t(`phase.${election.phase}`)}
            </Badge>
            <BlockchainBadge href={`https://amoy.polygonscan.com/address/${election.contractAddress}`} />
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white leading-tight">{election.title}</h1>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { icon: Users,    value: election.totalEnrolled, labelKey: 'election.enrolled' },
            { icon: BarChart3, value: election.castVotes,    labelKey: 'election.votes_cast' },
            { icon: Clock,    value: `${election.totalEnrolled > 0 ? Math.round((election.castVotes / election.totalEnrolled) * 100) : 0}%`, labelKey: 'election.participation' },
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

        {/* Countdown */}
        {(election.phase === 'active' || election.phase === 'enrolling') && (
          <Card className="p-4 mb-4 flex items-center gap-4 flex-wrap">
            <div>
              <p className="text-xs text-on-surface-meta mb-1">
                {election.phase === 'enrolling' ? t('election.enrollment_closes') : t('election.voting_closes')}
              </p>
              <Countdown deadline={election.phase === 'enrolling' ? election.enrollEnd : election.voteEnd} size="md" />
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

        {/* Organizer actions */}
        <Card className="p-5 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-on-surface mb-1">{t('election_mgmt.actions')}</h2>

          {canClose && (
            <Button variant="default" className="w-full rounded-2xl gap-2 border-warning/30 text-warning hover:bg-warning/10"
              onClick={() => setCloseModal(true)}>
              <Clock className="w-4 h-4" />
              {t('election_mgmt.close_early')}
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
        </Card>

        {/* Modals */}
        <Modal open={cancelModal} onClose={() => setCancelModal(false)}
          title={t('election_mgmt.cancel_title')} description={t('election_mgmt.cancel_desc')}>
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setCancelModal(false)}>{t('common.cancel')}</Button>
            <Button variant="default" className="flex-1 border-error/30 text-error hover:bg-error/10"
              onClick={() => { setCancelModal(false); action(t('election_mgmt.cancel_title')); }}>
              {t('election_mgmt.cancel_confirm')}
            </Button>
          </div>
        </Modal>
        <Modal open={closeModal} onClose={() => setCloseModal(false)}
          title={t('election_mgmt.close_title')} description={t('election_mgmt.close_desc')}>
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setCloseModal(false)}>{t('common.cancel')}</Button>
            <Button variant="gradient" className="flex-1"
              onClick={() => { setCloseModal(false); action(t('election_mgmt.close_title')); }}>
              {t('election_mgmt.close_confirm')}
            </Button>
          </div>
        </Modal>
        <Modal open={tallyModal} onClose={() => setTallyModal(false)}
          title={t('election_mgmt.tally_title')} description={t('election_mgmt.tally_desc')}>
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setTallyModal(false)}>{t('common.cancel')}</Button>
            <Button variant="gradient" className="flex-1"
              onClick={() => { setTallyModal(false); action(t('election_mgmt.tally_title')); }}>
              {t('election_mgmt.tally_confirm')}
            </Button>
          </div>
        </Modal>
      </div>
    </PageLayout>
  );
}
