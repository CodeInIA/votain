import { useTranslation } from 'react-i18next';
import { OrganizerEntryHint } from './OrganizerEntryHint';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ChevronLeft, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { WorldIdConnector } from './WorldIdConnector';
import { useWorldIdVerify } from '../../hooks/useWorldIdVerify';

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

interface WorldIdVerifyProps {
  onBack: () => void;
}

export function WorldIdVerify({ onBack }: WorldIdVerifyProps) {
  const { t } = useTranslation();
  const {
    isLoadingQr, isVerifying, connectorURI, qrError,
    handleOpenWorldId, handleCancelQr,
  } = useWorldIdVerify();

  return (
    <div className="relative min-h-dvh w-full bg-background text-on-surface font-body selection:bg-primary selection:text-white overflow-x-hidden flex flex-col items-center justify-center p-4">
      <div className="fixed inset-0 z-0 pointer-events-none liquid-mesh" />
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 blur-[150px] rounded-full" />
      <div className="fixed inset-0 z-0 w-full h-full opacity-20 pointer-events-none mix-blend-screen">
        <div className="w-full h-full bg-cover bg-center bg-no-repeat" style={{ backgroundImage: "url('/landing-background.webp')" }} />
      </div>

      <Button
        onClick={onBack}
        variant="ghost"
        className="absolute top-4 left-4 sm:top-6 sm:left-6 z-50 w-12 h-12 p-0 flex items-center justify-center rounded-full bg-surface-low/30 hover:bg-surface-low/50 backdrop-blur-xl border border-white/5 text-white shadow-lg"
        aria-label={t('common.back')}
        disabled={isVerifying || isLoadingQr}
      >
        <ChevronLeft className="w-6 h-6" />
      </Button>

      <motion.div
        layout
        className="w-full max-w-120 bg-surface-low/30 backdrop-blur-3xl rounded-4xl p-6 sm:p-10 border border-white/5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] flex flex-col items-center text-center relative z-10"
      >
        <AnimatePresence mode="wait">
          {connectorURI ? (
            <motion.div
              key="qr"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="w-full flex flex-col items-center min-h-72 sm:min-h-80"
            >
              <WorldIdConnector uri={connectorURI} className="mb-6" />
              <Button onClick={handleCancelQr} variant="ghost" size="sm" className="flex items-center gap-1.5 text-on-surface-variant hover:text-white">
                <X className="w-4 h-4" />
                {t('common.cancel')}
              </Button>
            </motion.div>

          ) : (
            <motion.div
              key="verify"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-full flex flex-col items-center min-h-72 sm:min-h-80"
            >
              <div className="mb-6 sm:mb-8 w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center bg-surface-lowest/40 rounded-full shadow-[inset_0_2px_20px_rgba(255,255,255,0.02)] border border-white/5 shrink-0">
                <img src="/world-id-logo.svg" alt="World ID" className="w-16 h-16 sm:w-20 sm:h-20" style={{ filter: 'invert(1) brightness(200%)' }} />
              </div>
              <div className="min-h-16 sm:min-h-20 flex items-center mb-3 sm:mb-4">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white drop-shadow-sm leading-tight px-2">{t('verify.title')}</h1>
              </div>
              <p className="text-on-surface-variant text-sm sm:text-base leading-relaxed mb-6 sm:mb-8 h-28 sm:h-32 px-4 shrink-0 overflow-y-auto w-full scrollbar-none">{t('verify.description')}</p>
              {qrError && <p className="text-red-400 text-sm mb-4">{qrError}</p>}
            </motion.div>
          )}
        </AnimatePresence>

        {!connectorURI && (
          <div className="w-full mt-4 sm:mt-6">
            <Button
              onClick={handleOpenWorldId}
              size="lg"
              variant="gradient"
              disabled={isVerifying || isLoadingQr}
              className="w-full rounded-full flex items-center justify-center gap-2 group text-lg font-semibold h-14"
            >
              {isLoadingQr ? (
                <><Loader2 className="w-5 h-5 animate-spin" /><span className="opacity-80">{t(isMobile ? 'verify.btn_loading_mobile' : 'verify.btn_loading')}</span></>
              ) : (
                <><img src="/world-id-logo.svg" alt="World ID" className="w-5 h-5" />{t('verify.btn_verify')}</>
              )}
            </Button>
            <OrganizerEntryHint className="mt-4" />
          </div>
        )}
      </motion.div>
    </div>
  );
}
