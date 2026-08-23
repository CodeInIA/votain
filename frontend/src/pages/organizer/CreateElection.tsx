import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, ChevronRight, AlertTriangle } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Stepper } from '../../components/ui/Stepper';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { Card } from '../../components/ui/Card';
import { Input, Textarea } from '../../components/ui/Input';
import { DatePicker } from '../../components/ui/DatePicker';
import { SelectMenu } from '../../components/ui/SelectMenu';
import { Switch } from '../../components/ui/Switch';
import { Modal } from '../../components/ui/Modal';
import { TransactionPendingModal, type TxState } from '../../components/ui/TransactionPendingModal';
import { useOrganizerWallet } from '../../hooks/useOrganizerWallet';
import { isChainConfigured, chainInfo } from '../../lib/deployments';
import { createElection, getOrganizerName, type VOTING_TYPE_ENUM } from '../../lib/organizer';

interface Candidate { name: string; description: string }

interface FormState {
  title: string;
  description: string;
  votingType: keyof typeof VOTING_TYPE_ENUM;
  threshold: string;
  /** When false there is no separate enrollment window: it opens on deploy and
   *  closes when voting starts. Enrollment itself is never optional: voting
   *  proves membership of the election's Semaphore group. */
  separateEnrollment: boolean;
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
  title: '', description: '', votingType: 'simple_plurality', threshold: '2',
  separateEnrollment: true,
  enrollStart: '', enrollEnd: '', voteStart: '', voteEnd: '',
  candidates: [{ name: '', description: '' }, { name: '', description: '' }],
  requireOrb: false, privacyQuorum: '10', depositAmount: '0.05',
};

const isYesNo = (vt: string) => vt === 'two_thirds' || vt === 'witness_threshold';

// Local-time 'yyyy-mm-dd' lower bound for each picker: these mirror
// validateStep's ordering rules so the calendar cannot even offer a day it
// would reject. Days are the granularity here; validateStep still enforces the
// strict ordering of the times within a shared day.
const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

type FieldErrors = Partial<Record<
  'title' | 'description' | 'threshold' | 'enrollStart' | 'enrollEnd' | 'voteStart'
  | 'voteEnd' | 'candidates' | 'privacyQuorum' | 'depositAmount', string>>;

/**
 * Per-step validation.
 *
 * These rules mirror `ElectionV4`'s constructor requirements (which revert with
 * `InvalidConfig`). Catching them here avoids sending a transaction that is
 * guaranteed to fail: the organizer would pay gas for nothing and get an
 * opaque revert instead of a readable message.
 */
function validateStep(step: number, form: FormState, t: (k: string) => string): FieldErrors {
  const e: FieldErrors = {};
  const day = (s: string) => (s ? new Date(s).getTime() : NaN);

  if (step === 0) {
    if (!form.title.trim()) e.title = t('validation.required');
    if (!form.description.trim()) e.description = t('validation.required');
    if (form.votingType === 'witness_threshold') {
      const n = Number(form.threshold);
      if (!Number.isInteger(n) || n < 1) e.threshold = t('validation.threshold_min');
    }
  }

  if (step === 1) {
    const [es, ee, vs, ve] = [
      day(form.enrollStart), day(form.enrollEnd), day(form.voteStart), day(form.voteEnd),
    ];
    if (!form.voteStart) e.voteStart = t('validation.required');
    if (!form.voteEnd) e.voteEnd = t('validation.required');

    if (form.separateEnrollment) {
      if (!form.enrollStart) e.enrollStart = t('validation.required');
      if (!form.enrollEnd) e.enrollEnd = t('validation.required');

      // Contract: enrollStart < enrollEnd <= voteStart < voteEnd
      if (!e.enrollEnd && !Number.isNaN(es) && ee <= es) e.enrollEnd = t('validation.after_enroll_start');
      if (!e.voteStart && !Number.isNaN(ee) && vs < ee) e.voteStart = t('validation.after_enroll_end');
    } else if (!e.voteStart && !Number.isNaN(vs) && vs <= Date.now()) {
      // Enrollment will run from deploy until voting opens, so that window has
      // to be in the future or the contract's enrollStart < enrollEnd fails.
      e.voteStart = t('validation.must_be_future');
    }

    if (!e.voteEnd && !Number.isNaN(vs) && ve <= vs) e.voteEnd = t('validation.after_vote_start');
    if (!e.voteEnd && !Number.isNaN(ve) && ve < Date.now()) e.voteEnd = t('validation.must_be_future');
  }

  if (step === 2 && !isYesNo(form.votingType)) {
    const names = form.candidates.map(c => c.name.trim()).filter(Boolean);
    if (names.length < 2) e.candidates = t('validation.candidates_min');
    else if (new Set(names.map(n => n.toLowerCase())).size !== names.length) {
      e.candidates = t('validation.candidates_unique');
    }
  }

  if (step === 3) {
    const q = Number(form.privacyQuorum);
    if (!Number.isInteger(q) || q < 1) e.privacyQuorum = t('validation.quorum_min');
    const d = Number(form.depositAmount);
    if (Number.isNaN(d) || d < 0) e.depositAmount = t('validation.number_positive');
  }

  return e;
}

export default function CreateElection() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const wallet = useOrganizerWallet();
  const live = isChainConfigured();
  const [step, setStep]       = useState(0);
  const [form, setForm]       = useState<FormState>(INITIAL);
  const [deployModal, setDeployModal] = useState(false);
  const [txState, setTxState] = useState<TxState>('idle');
  // Errors are only surfaced after the user tries to advance, so the form does
  // not shout at them while it is still empty.
  const [showErrors, setShowErrors] = useState(false);

  const isDirty = JSON.stringify(form) !== JSON.stringify(INITIAL);
  const [leaveModal, setLeaveModal] = useState(false);
  const pendingNav = useRef<(() => void) | null>(null);

  const guardedNavigate = (action: () => void) => {
    if (isDirty) {
      pendingNav.current = action;
      setLeaveModal(true);
    } else {
      action();
    }
  };
  const cancelLeave = () => { setLeaveModal(false); pendingNav.current = null; };
  const confirmLeave = () => {
    setLeaveModal(false);
    const action = pendingNav.current;
    pendingNav.current = null;
    action?.();
  };

  // Full page unload (refresh, close tab, typed URL, external link): the SPA
  // router never sees these, so this is the only hook available for them.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // In-app navigation (top/bottom nav tabs, logo, profile) is a same-document
  // history change, so beforeunload never fires for it: the click has to be
  // caught before React Router acts on it. Nav links carry a real href;
  // TopNav's logo/profile buttons carry a data-nav-href for the same purpose.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('a[href], [data-nav-href]');
      if (!el) return;
      let href: string;
      if (el instanceof HTMLAnchorElement) {
        const url = new URL(el.href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        if (url.pathname + url.search === window.location.pathname + window.location.search) return;
        href = url.pathname + url.search + url.hash;
      } else {
        href = el.getAttribute('data-nav-href') ?? '';
        if (!href || href === window.location.pathname) return;
      }
      e.preventDefault();
      e.stopPropagation();
      guardedNavigate(() => navigate(href));
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, navigate]);

  const stepErrors = validateStep(step, form, t);
  const stepValid = Object.keys(stepErrors).length === 0;
  const err = (field: keyof FieldErrors) => (showErrors ? stepErrors[field] : undefined);

  // Every step must be valid before deploying: the user could otherwise skip
  // back and blank a field after passing its step.
  const allStepsValid = [0, 1, 2, 3].every(
    s => Object.keys(validateStep(s, form, t)).length === 0,
  );

  const goNext = () => {
    if (!stepValid) { setShowErrors(true); return; }
    setShowErrors(false);
    setStep(s => s + 1);
  };

  const STEPS = [
    { label: t('create.step_info') },
    { label: t('create.step_timeline') },
    { label: t('create.step_candidates') },
    { label: t('create.step_deploy') },
  ];

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  // Yes/No voting types force exactly two options.
  const effectiveCandidates = isYesNo(form.votingType)
    ? [{ name: 'Yes', description: '' }, { name: 'No', description: '' }]
    : form.candidates;

  const addCandidate = () =>
    set('candidates', [...form.candidates, { name: '', description: '' }]);

  const removeCandidate = (i: number) =>
    set('candidates', form.candidates.filter((_, j) => j !== i));

  const updateCandidate = (i: number, field: keyof Candidate, v: string) =>
    set('candidates', form.candidates.map((c, j) => j === i ? { ...c, [field]: v } : c));

  const handleDeploy = async () => {
    setDeployModal(false);

    // Last line of defence: never send a transaction the contract would reject.
    if (!allStepsValid) {
      setShowErrors(true);
      return;
    }

    // Phase A / no chain: simulate the deploy.
    if (!live) {
      setTxState('pending');
      setTimeout(() => {
        setTxState('success');
        setTimeout(() => navigate('/organizer/dashboard'), 1800);
      }, 2500);
      return;
    }

    setTxState('pending');
    try {
      if (wallet.wrongNetwork) await wallet.switchToAmoy();
      const signer = await wallet.getSigner();
      const candidates = effectiveCandidates
        .filter(c => c.name.trim())
        .map(c => ({ name: c.name.trim(), description: c.description.trim() || undefined }));

      const { address } = await createElection(signer, {
        name: form.title,
        description: form.description,
        votingType: form.votingType,
        thresholdValue: form.votingType === 'witness_threshold' ? Number(form.threshold) : 0,
        organizerName: getOrganizerName(), // from the organizer's profile, not the election title
        candidates,
        privacyQuorum: Number(form.privacyQuorum),
        // No separate window: enrollment opens now and closes when voting does.
        // (The contract requires enrollStart < enrollEnd <= voteStart.)
        enrollStart: form.separateEnrollment ? new Date(form.enrollStart) : new Date(),
        enrollEnd: form.separateEnrollment ? new Date(form.enrollEnd) : new Date(form.voteStart),
        voteStart: new Date(form.voteStart),
        voteEnd: new Date(form.voteEnd),
        depositMatic: form.depositAmount,
      });

      setTxState('success');
      setTimeout(() => navigate(`/organizer/election/${address}`), 1800);
    } catch (e) {
      console.error('Deploy failed:', e);
      setTxState('failed');
    }
  };

  return (
    <PageLayout role="organizer" showNav>
      <div className="max-w-2xl mx-auto pt-4 pb-24">
        <BackButton
          className="mb-5"
          onClick={() => step > 0 ? setStep(s => s - 1) : guardedNavigate(() => navigate(-1))}
        />

        <h1 className="text-xl font-black tracking-tight text-white mb-6">{t('create.title')}</h1>
        <Stepper steps={STEPS} current={step} className="mb-8" />

        {/* Step 0: Info */}
        {step === 0 && (
          <Card className="p-5 flex flex-col gap-4">
            <Input label={t('create.election_name')} value={form.title} onChange={e => set('title', e.target.value)} placeholder={t('create.election_name_placeholder')} error={err('title')} />
            <Textarea label={t('create.description')} value={form.description} onChange={e => set('description', e.target.value)} rows={3} placeholder={t('create.description_placeholder')} error={err('description')} />
            <SelectMenu
              label={t('create.voting_type')}
              value={form.votingType}
              onChange={v => set('votingType', v as keyof typeof VOTING_TYPE_ENUM)}
              options={[
                { value: 'simple_plurality',  label: t('voting_type.simple_plurality'),  description: t('voting_type.simple_plurality_desc') },
                { value: 'absolute_majority', label: t('voting_type.absolute_majority'), description: t('voting_type.absolute_majority_desc') },
                { value: 'two_thirds',        label: t('voting_type.two_thirds'),        description: t('voting_type.two_thirds_desc') },
                { value: 'witness_threshold', label: t('voting_type.witness_threshold'), description: t('voting_type.witness_threshold_desc') },
              ]}
            />
            {form.votingType === 'witness_threshold' && (
              <Input
                label={t('create.witness_threshold_n')}
                type="number"
                min="1"
                value={form.threshold}
                onChange={e => set('threshold', e.target.value)}
                hint={t('create.witness_threshold_hint')}
                error={err('threshold')}
              />
            )}
          </Card>
        )}

        {/* Step 1: Timeline */}
        {step === 1 && (
          <Card className="p-5 flex flex-col gap-4">
            <Switch
              label={t('create.separate_enrollment')}
              description={t('create.separate_enrollment_desc')}
              checked={form.separateEnrollment}
              onChange={v => set('separateEnrollment', v)}
            />
            {/* One column on phones: a date + time label does not fit in a half-width field. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {form.separateEnrollment && (
                <>
                  <DatePicker withTime label={t('create.enroll_start')} value={form.enrollStart} min={today()} onChange={v => set('enrollStart', v)} error={err('enrollStart')} />
                  <DatePicker withTime label={t('create.enroll_end')}   value={form.enrollEnd}   min={form.enrollStart || today()} onChange={v => set('enrollEnd', v)} error={err('enrollEnd')} />
                </>
              )}
              <DatePicker withTime label={t('create.vote_start')} value={form.voteStart}
                min={(form.separateEnrollment ? form.enrollEnd : '') || today()}
                onChange={v => set('voteStart', v)} error={err('voteStart')} />
              <DatePicker withTime label={t('create.vote_end')} value={form.voteEnd}
                min={form.voteStart || today()}
                onChange={v => set('voteEnd', v)} error={err('voteEnd')} />
            </div>
            {!form.separateEnrollment && (
              <p className="text-xs text-on-surface-meta">{t('create.enrollment_until_vote_start')}</p>
            )}
          </Card>
        )}

        {/* Step 2: Candidates.
            For Yes/No types the block below is a PREVIEW of the ballot, not a
            choice. Both chips carry identical, muted styling on purpose:
            highlighting one read as a selected toggle and had organizers trying
            to click it. Voters pick between the two later, at vote time. */}
        {step === 2 && isYesNo(form.votingType) && (
          <Card className="p-5 text-center">
            <p className="text-sm text-on-surface">{t('create.yes_no_note')}</p>
            <p className="text-xs text-on-surface-meta mt-1">{t('create.yes_no_hint')}</p>
            <p className="text-xs text-on-surface-meta mt-4 mb-2">{t('create.yes_no_preview')}</p>
            <div className="flex justify-center gap-3" aria-hidden="true">
              <span className="px-4 py-2 rounded-xl bg-surface-high/40 text-on-surface-variant text-sm font-semibold">
                {t('common.yes')}
              </span>
              <span className="px-4 py-2 rounded-xl bg-surface-high/40 text-on-surface-variant text-sm font-semibold">
                {t('common.no')}
              </span>
            </div>
          </Card>
        )}
        {step === 2 && !isYesNo(form.votingType) && (
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
            {err('candidates') && (
              <p className="text-xs text-error text-center">{err('candidates')}</p>
            )}
            <p className="text-xs text-on-surface-meta text-center">{t('create.blank_vote_note')}</p>
          </div>
        )}

        {/* Step 3: Deploy */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <Card className="p-5 flex flex-col gap-4">
              <Switch label={t('create.require_orb')} description={t('create.require_orb_desc')} checked={form.requireOrb} onChange={v => set('requireOrb', v)} />
              <Input label={t('create.privacy_quorum')} type="number" min="1" max="100" value={form.privacyQuorum} onChange={e => set('privacyQuorum', e.target.value)} hint={t('create.quorum_hint')} error={err('privacyQuorum')} />
              <Input label={t('create.deposit_token', { currency: chainInfo.currency })} type="number" step="0.01" min="0" value={form.depositAmount} onChange={e => set('depositAmount', e.target.value)} hint={t('create.deposit_hint')} error={err('depositAmount')} />
            </Card>

            {/* Errors from earlier steps are invisible here, so surface them. */}
            {showErrors && !allStepsValid && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-error/10 border border-error/25">
                <AlertTriangle className="w-4 h-4 text-error shrink-0 mt-0.5" />
                <p className="text-xs text-error">{t('validation.fix_previous_steps')}</p>
              </div>
            )}

            <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-warning/10 border border-warning/20">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-warning">{t('create.immutability_warning')}</p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-8">
          {/* Buttons stay enabled on purpose: clicking reveals *why* the step is
              invalid. A disabled button with no explanation is a dead end. */}
          {step < 3 ? (
            <Button variant="gradient" size="lg" className="flex-1 rounded-full h-14 gap-2" onClick={goNext}>
              {t('common.continue')}
              <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              variant="gradient"
              size="lg"
              className="flex-1 rounded-full h-14"
              onClick={() => { setShowErrors(true); if (allStepsValid) setDeployModal(true); }}
            >
              {t('create.deploy')}
            </Button>
          )}
        </div>

        <Modal
          open={deployModal}
          onClose={() => setDeployModal(false)}
          title={t('create.deploy_confirm_title')}
          description={t('create.deploy_confirm_desc', { amount: form.depositAmount, currency: chainInfo.currency })}
        >
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setDeployModal(false)}>{t('common.cancel')}</Button>
            <Button variant="gradient" className="flex-1" onClick={handleDeploy}>{t('create.deploy')}</Button>
          </div>
        </Modal>

        <Modal
          open={leaveModal}
          onClose={cancelLeave}
          title={t('create.leave_confirm_title')}
          description={t('create.leave_confirm_desc')}
        >
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" onClick={cancelLeave}>{t('common.cancel')}</Button>
            <Button variant="gradient" className="flex-1" onClick={confirmLeave}>{t('create.discard_changes')}</Button>
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
