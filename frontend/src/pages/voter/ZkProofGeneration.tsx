import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { OverlayStepper } from '../../components/ui/Stepper';
import { Button } from '../../components/ui/Button';
import { PageLayout } from '../../components/layout/PageLayout';
import { getElection as getSeedElection } from '../../data/seed';
import { castVote } from '../../lib/voting';
import { relayErrorMessage } from '../../lib/relay';

type StepStatus = 'pending' | 'active' | 'done';

interface VoteNavState {
  optionIndex?: number;
  live?: boolean;
  address?: string;
  candidateId?: string;
}

/**
 * Runs the real vote pipeline (encrypt → ZK proof → sponsored submit) when the
 * chain is configured, driving the stepper by actual stage. Falls back to the
 * Phase A simulated animation otherwise.
 */
export default function ZkProofGeneration() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const seedElection = id && !id.startsWith('0x') ? getSeedElection(id) : undefined;
  const title = seedElection?.title;

  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const steps: { labelKey: string; status: StepStatus }[] = [
    { labelKey: 'zk.step1', status: stepIdx > 0 ? 'done' : stepIdx === 0 ? 'active' : 'pending' },
    { labelKey: 'zk.step2', status: stepIdx > 1 ? 'done' : stepIdx === 1 ? 'active' : 'pending' },
    { labelKey: 'zk.step3', status: stepIdx > 2 ? 'done' : stepIdx === 2 ? 'active' : 'pending' },
  ];

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const state = (location.state ?? {}) as VoteNavState;

    // Simulated path (no chain configured)
    if (!state.live || !state.address || state.optionIndex === undefined) {
      const advance = (n: number) => {
        if (n >= 3) {
          navigate(`/voter/election/${id}/confirmation`, {
            state: { ...location.state, electionId: id },
            replace: true,
          });
          return;
        }
        setStepIdx(n + 1);
        setTimeout(() => advance(n + 1), 1500);
      };
      setTimeout(() => advance(0), 1500);
      return;
    }

    // Real path
    void (async () => {
      try {
        setStepIdx(1); // building identity/commitment (implicit in proof gen)
        setStepIdx(2); // encrypt + generate proof happen inside castVote
        const result = await castVote(state.address!, state.optionIndex!);
        setStepIdx(3);
        navigate(`/voter/election/${id}/confirmation`, {
          state: {
            electionId: id,
            referenceNumber: result.referenceNumber,
            txHash: result.txHash,
            nullifier: result.nullifier.toString(),
          },
          replace: true,
        });
      } catch (e) {
        console.error('Vote failed:', e);
        // Named rather than raw: the commonest failure here is an organizer's
        // drained gas tank, which is not the voter's doing and not something a
        // revert string explains.
        setError(relayErrorMessage(e));
      }
    })();
  }, [id, navigate, location.state]);

  return (
    <PageLayout role="voter" showNav={false}>
      <div className="min-h-dvh flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm bg-surface-low/30 backdrop-blur-3xl rounded-4xl p-8 border border-white/5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] flex flex-col items-center text-center">
          {error ? (
            <>
              <span className="text-4xl mb-4">⚠️</span>
              <h1 className="text-xl font-bold text-white mb-2">{t('errors.generic_title')}</h1>
              <p className="text-xs text-error mb-6 break-words">{error}</p>
              <Button variant="ghost" onClick={() => navigate(`/voter/election/${id}`)}>
                {t('common.back')}
              </Button>
            </>
          ) : (
            <>
              <div className="relative w-24 h-24 mb-8">
                <div className="absolute inset-0 rounded-full border-4 border-primary/20 animate-pulse" />
                <div className="absolute inset-2 rounded-full border-2 border-t-primary border-r-primary/40 border-b-transparent border-l-transparent animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-3xl">🔐</span>
                </div>
              </div>

              <h1 className="text-xl font-bold text-white mb-2">{t('zk.title')}</h1>
              {title && <p className="text-xs text-on-surface-meta mb-8 px-2 line-clamp-2">{title}</p>}

              <OverlayStepper
                steps={steps.map(s => ({ label: t(s.labelKey), status: s.status }))}
                className="w-full max-w-xs"
              />

              <p className="text-xs text-on-surface-meta mt-6">{t('zk.do_not_close')}</p>
            </>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
