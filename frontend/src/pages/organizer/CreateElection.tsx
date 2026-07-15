import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, ChevronRight, AlertTriangle } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Stepper } from '../../components/ui/Stepper';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { Card } from '../../components/ui/Card';
import { Input, Textarea, Select } from '../../components/ui/Input';
import { Switch } from '../../components/ui/Switch';
import { Modal } from '../../components/ui/Modal';
import { TransactionPendingModal, type TxState } from '../../components/ui/TransactionPendingModal';

interface Candidate { name: string; description: string }

interface FormState {
  title: string;
  description: string;
  votingType: string;
  enrollStart: string;
  enrollEnd: string;
  voteStart: string;
  voteEnd: string;
  candidates: Candidate[];
  requireOrb: boolean;
  privacyQuorum: string;
  depositAmount: string;
}

const INITIAL: FormState = {
  title: '', description: '', votingType: 'simple_plurality',
  enrollStart: '', enrollEnd: '', voteStart: '', voteEnd: '',
  candidates: [{ name: '', description: '' }, { name: '', description: '' }],
  requireOrb: false, privacyQuorum: '10', depositAmount: '0.05',
};

export default function CreateElection() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [step, setStep]       = useState(0);
  const [form, setForm]       = useState<FormState>(INITIAL);
  const [deployModal, setDeployModal] = useState(false);
  const [txState, setTxState] = useState<TxState>('idle');

  const STEPS = [
    { label: t('create.step_info') },
    { label: t('create.step_timeline') },
    { label: t('create.step_candidates') },
    { label: t('create.step_deploy') },
  ];

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const addCandidate = () =>
    set('candidates', [...form.candidates, { name: '', description: '' }]);

  const removeCandidate = (i: number) =>
    set('candidates', form.candidates.filter((_, j) => j !== i));

  const updateCandidate = (i: number, field: keyof Candidate, v: string) =>
    set('candidates', form.candidates.map((c, j) => j === i ? { ...c, [field]: v } : c));

  const handleDeploy = () => {
    setDeployModal(false);
    setTxState('pending');
    setTimeout(() => {
      setTxState('success');
      setTimeout(() => navigate('/organizer/dashboard'), 1800);
    }, 2500);
  };

  return (
    <PageLayout role="organizer" showNav>
      <div className="max-w-2xl mx-auto pt-4 pb-24">
        <BackButton
          className="mb-5"
          onClick={() => step > 0 ? setStep(s => s - 1) : navigate(-1)}
        />

        <h1 className="text-xl font-black tracking-tight text-white mb-6">{t('create.title')}</h1>
        <Stepper steps={STEPS} current={step} className="mb-8" />

        {/* Step 0: Info */}
        {step === 0 && (
          <Card className="p-5 flex flex-col gap-4">
            <Input label={t('create.election_name')} value={form.title} onChange={e => set('title', e.target.value)} placeholder={t('create.election_name_placeholder')} />
            <Textarea label={t('create.description')} value={form.description} onChange={e => set('description', e.target.value)} rows={3} placeholder={t('create.description_placeholder')} />
            <Select
              label={t('create.voting_type')}
              value={form.votingType}
              onChange={e => set('votingType', e.target.value)}
              options={[
                { value: 'simple_plurality', label: t('voting_type.simple_plurality') },
                { value: 'absolute_majority', label: t('voting_type.absolute_majority') },
                { value: 'two_thirds', label: t('voting_type.two_thirds') },
                { value: 'witness_threshold', label: t('voting_type.witness_threshold') },
              ]}
            />
          </Card>
        )}

        {/* Step 1: Timeline */}
        {step === 1 && (
          <Card className="p-5 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Input type="date" label={t('create.enroll_start')} value={form.enrollStart} onChange={e => set('enrollStart', e.target.value)} />
              <Input type="date" label={t('create.enroll_end')}   value={form.enrollEnd}   onChange={e => set('enrollEnd',   e.target.value)} />
              <Input type="date" label={t('create.vote_start')}   value={form.voteStart}   onChange={e => set('voteStart',   e.target.value)} />
              <Input type="date" label={t('create.vote_end')}     value={form.voteEnd}     onChange={e => set('voteEnd',     e.target.value)} />
            </div>
            {/* Timeline visual */}
            {form.enrollStart && form.voteEnd && (
              <div className="h-2 rounded-full bg-surface-high overflow-hidden relative mt-2">
                <div className="absolute left-0 top-0 h-full rounded-full bg-primary/40 w-1/3" />
                <div className="absolute left-1/3 top-0 h-full rounded-full bg-primary w-1/2" />
              </div>
            )}
          </Card>
        )}

        {/* Step 2: Candidates */}
        {step === 2 && (
          <div className="flex flex-col gap-3">
            {form.candidates.map((c, i) => (
              <Card key={i} className="p-4 flex gap-3 items-start">
                <div className="flex-1 flex flex-col gap-2">
                  <Input placeholder={t('create.candidate_name')} value={c.name} onChange={e => updateCandidate(i, 'name', e.target.value)} />
                  <Input placeholder={t('create.candidate_desc')} value={c.description} onChange={e => updateCandidate(i, 'description', e.target.value)} />
                </div>
                {form.candidates.length > 2 && (
                  <button type="button" onClick={() => removeCandidate(i)} className="mt-2 text-error hover:text-error/70 transition-colors cursor-pointer">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </Card>
            ))}
            <Button variant="ghost" className="gap-2 rounded-2xl" onClick={addCandidate}>
              <Plus className="w-4 h-4" />
              {t('create.add_candidate')}
            </Button>
            <p className="text-xs text-on-surface-meta text-center">{t('create.blank_vote_note')}</p>
          </div>
        )}

        {/* Step 3: Deploy */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <Card className="p-5 flex flex-col gap-4">
              <Switch label={t('create.require_orb')} description={t('create.require_orb_desc')} checked={form.requireOrb} onChange={v => set('requireOrb', v)} />
              <Input label={t('create.privacy_quorum')} type="number" min="5" max="100" value={form.privacyQuorum} onChange={e => set('privacyQuorum', e.target.value)} hint={t('create.quorum_hint')} />
              <Input label={t('create.deposit_matic')} type="number" step="0.01" value={form.depositAmount} onChange={e => set('depositAmount', e.target.value)} hint={t('create.deposit_hint')} />
            </Card>

            <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-warning/10 border border-warning/20">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-warning">{t('create.immutability_warning')}</p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-8">
          {step < 3 ? (
            <Button variant="gradient" size="lg" className="flex-1 rounded-full h-14 gap-2" onClick={() => setStep(s => s + 1)}>
              {t('common.continue')}
              <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button variant="gradient" size="lg" className="flex-1 rounded-full h-14" onClick={() => setDeployModal(true)}>
              {t('create.deploy')}
            </Button>
          )}
        </div>

        <Modal
          open={deployModal}
          onClose={() => setDeployModal(false)}
          title={t('create.deploy_confirm_title')}
          description={t('create.deploy_confirm_desc', { amount: form.depositAmount })}
        >
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setDeployModal(false)}>{t('common.cancel')}</Button>
            <Button variant="gradient" className="flex-1" onClick={handleDeploy}>{t('create.deploy')}</Button>
          </div>
        </Modal>

        <TransactionPendingModal
          state={txState}
          onClose={() => setTxState('idle')}
        />
      </div>
    </PageLayout>
  );
}
