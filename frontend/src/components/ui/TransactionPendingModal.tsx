import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, type Transition } from 'framer-motion';
import { CheckCircle2, XCircle, ExternalLink, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { buttonVariants } from './button-variants';
import { Spinner } from './Spinner';
import { cn } from '../../lib/utils';

export type TxState = 'idle' | 'pending' | 'success' | 'failed';

interface TxStep {
  label: string;
  done: boolean;
}

interface TransactionPendingModalProps {
  state: TxState;
  steps?: TxStep[];
  txHash?: string;
  errorMessage?: string;
  onClose?: () => void;
  onRetry?: () => void;
}

function usePrefersReducedMotion() {
  // Lazy state (not a ref) so the value is read purely during render.
  const [reduced] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  return reduced;
}

export function TransactionPendingModal({
  state,
  steps,
  txHash,
  errorMessage,
  onClose,
  onRetry,
}: TransactionPendingModalProps) {
  const { t } = useTranslation();
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (state === 'idle') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [state]);

  const transition: Transition = reduced
    ? { duration: 0 }
    : { duration: 0.25, ease: 'easeOut' };

  const defaultSteps: TxStep[] = steps ?? [
    { label: t('tx.step_submitting'), done: state === 'success' || state === 'failed' },
    { label: t('tx.step_confirming'), done: state === 'success' },
    { label: t('tx.step_done'),       done: state === 'success' },
  ];

  const polygonScanUrl = txHash
    ? `https://amoy.polygonscan.com/tx/${txHash}`
    : null;

  return createPortal(
    <AnimatePresence>
      {state !== 'idle' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          aria-modal="true"
          role="dialog"
          aria-label={t('tx.aria_label')}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-background/70 backdrop-blur-lg" />

          {/* Card */}
          <motion.div
            initial={{ opacity: 0, scale: reduced ? 1 : 0.94, y: reduced ? 0 : 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.94, y: reduced ? 0 : 12 }}
            transition={transition}
            className="relative z-10 w-full max-w-sm bg-surface-high/85 backdrop-blur-3xl rounded-3xl border border-white/8 shadow-[0_32px_80px_rgba(0,0,0,0.8)] p-8 flex flex-col items-center text-center"
          >
            {/* Icon / spinner area */}
            <div className="mb-6">
              {state === 'pending' && (
                <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 border border-primary/20">
                  <Spinner className="w-8 h-8 text-primary" />
                </div>
              )}
              {state === 'success' && (
                <motion.div
                  initial={reduced ? {} : { scale: 0, rotate: -15 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 18 }}
                  className="flex items-center justify-center w-16 h-16 rounded-full bg-green-500/15 border border-green-500/30"
                >
                  <CheckCircle2 className="w-8 h-8 text-green-400" />
                </motion.div>
              )}
              {state === 'failed' && (
                <motion.div
                  initial={reduced ? {} : { scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 18 }}
                  className="flex items-center justify-center w-16 h-16 rounded-full bg-red-500/15 border border-red-500/30"
                >
                  <XCircle className="w-8 h-8 text-red-400" />
                </motion.div>
              )}
            </div>

            {/* Title */}
            <h2 className="text-xl font-bold text-on-surface mb-1">
              {state === 'pending' && t('tx.title_pending')}
              {state === 'success' && t('tx.title_success')}
              {state === 'failed'  && t('tx.title_failed')}
            </h2>

            {/* Description / steps */}
            {state === 'pending' && (
              <div className="w-full mt-4 space-y-2">
                {defaultSteps.map((step, i) => (
                  <div key={i} className="flex items-center gap-3 text-left">
                    <div className={cn(
                      'w-2 h-2 rounded-full shrink-0 transition-colors',
                      step.done ? 'bg-primary' : 'bg-on-surface-meta/30'
                    )} />
                    <span className={cn(
                      'text-sm transition-colors',
                      step.done ? 'text-on-surface' : 'text-on-surface-meta'
                    )}>
                      {step.label}
                    </span>
                  </div>
                ))}
                <p className="text-xs text-on-surface-meta mt-3 pt-3 border-t border-white/5">
                  {t('tx.do_not_close')}
                </p>
              </div>
            )}

            {state === 'success' && txHash && (
              <p className="text-xs text-on-surface-meta mt-2 font-mono truncate max-w-full px-2">
                {txHash}
              </p>
            )}

            {state === 'failed' && errorMessage && (
              <p className="text-sm text-red-400 mt-2 leading-relaxed">{errorMessage}</p>
            )}

            {/* Actions */}
            <div className="mt-6 w-full flex flex-col gap-2">
              {state === 'success' && (
                <>
                  {polygonScanUrl && (
                    <a
                      href={polygonScanUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(buttonVariants({ variant: 'ghost' }), 'gap-2 w-full justify-center')}
                    >
                      <ExternalLink className="w-4 h-4" />
                      {t('tx.view_tx')}
                    </a>
                  )}
                  {onClose && (
                    <Button onClick={onClose} className="w-full">
                      {t('common.close')}
                    </Button>
                  )}
                </>
              )}
              {state === 'failed' && (
                <>
                  {onRetry && (
                    <Button onClick={onRetry} className="w-full gap-2">
                      <RotateCcw className="w-4 h-4" />
                      {t('common.retry')}
                    </Button>
                  )}
                  {onClose && (
                    <Button variant="ghost" onClick={onClose} className="w-full">
                      {t('common.close')}
                    </Button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
