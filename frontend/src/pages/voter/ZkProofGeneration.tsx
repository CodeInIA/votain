import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { OverlayStepper } from '../../components/ui/Stepper';
import { PageLayout } from '../../components/layout/PageLayout';
import { getElection } from '../../data/seed';

type StepStatus = 'pending' | 'active' | 'done';

export default function ZkProofGeneration() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const election = getElection(id ?? '');

  const [stepIdx, setStepIdx] = useState(0);

  const steps: { labelKey: string; status: StepStatus }[] = [
    { labelKey: 'zk.step1', status: stepIdx > 0 ? 'done' : stepIdx === 0 ? 'active' : 'pending' },
    { labelKey: 'zk.step2', status: stepIdx > 1 ? 'done' : stepIdx === 1 ? 'active' : 'pending' },
    { labelKey: 'zk.step3', status: stepIdx > 2 ? 'done' : stepIdx === 2 ? 'active' : 'pending' },
  ];

  useEffect(() => {
    if (stepIdx >= 3) {
      navigate(`/voter/election/${id}/confirmation`, {
        state: { ...location.state, electionId: id },
        replace: true,
      });
      return;
    }
    const timer = setTimeout(() => setStepIdx(s => s + 1), 1500);
    return () => clearTimeout(timer);
  }, [stepIdx, id, navigate, location.state]);

  return (
    <PageLayout role="voter" showNav={false}>
      <div className="min-h-dvh flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm bg-surface-low/30 backdrop-blur-3xl rounded-4xl p-8 border border-white/5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] flex flex-col items-center text-center">
          {/* Animated ring */}
          <div className="relative w-24 h-24 mb-8">
            <div className="absolute inset-0 rounded-full border-4 border-primary/20 animate-pulse" />
            <div className="absolute inset-2 rounded-full border-2 border-t-primary border-r-primary/40 border-b-transparent border-l-transparent animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl">🔐</span>
            </div>
          </div>

          <h1 className="text-xl font-bold text-white mb-2">{t('zk.title')}</h1>
          {election && (
            <p className="text-xs text-on-surface-meta mb-8 px-2 line-clamp-2">{election.title}</p>
          )}

          <OverlayStepper
            steps={steps.map(s => ({ label: t(s.labelKey), status: s.status }))}
            className="w-full max-w-xs"
          />

          <p className="text-xs text-on-surface-meta mt-6">{t('zk.do_not_close')}</p>
        </div>
      </div>
    </PageLayout>
  );
}
