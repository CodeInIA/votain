import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Loader2, ChevronLeft, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '../ui/Button';
import { useWorldIdVerify } from '../../hooks/useWorldIdVerify';

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

interface WorldIdVerifyProps {
  onBack: () => void;
}

export function WorldIdVerify({ onBack }: WorldIdVerifyProps) {
  const { t } = useTranslation();
  const {
    isLoadingQr, isVerifying, isSuccess, connectorURI, qrError,
    handleOpenWorldId, handleCancelQr,
  } = useWorldIdVerify();

  return (
    <div className="relative min-h-dvh w-full bg-background text-on-surface font-body selection:bg-primary selection:text-white overflow-x-hidden flex flex-col items-center justify-center p-4">
      <div className="fixed inset-0 z-0 pointer-events-none liquid-mesh" />
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 blur-[150px] rounded-full" />
      <div className="fixed inset-0 z-0 w-full h-full opacity-20 pointer-events-none mix-blend-screen">
        <div className="w-full h-full bg-cover bg-center bg-no-repeat" style={{ backgroundImage: "url('/landing-background.jpg')" }} />
      </div>

      <Button
        onClick={onBack}
        variant="ghost"
        className="absolute top-4 left-4 sm:top-6 sm:left-6 z-50 w-12 h-12 p-0 flex items-center justify-center rounded-full bg-surface-low/30 hover:bg-surface-low/50 backdrop-blur-xl border border-white/5 text-white shadow-lg"
        aria-label={t('common.back')}
        disabled={isVerifying || isLoadingQr || isSuccess}
      >
        <ChevronLeft className="w-6 h-6" />
      </Button>

      <motion.div
        layout
        className="w-full max-w-120 bg-surface-low/30 backdrop-blur-3xl rounded-4xl p-6 sm:p-10 border border-white/5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] flex flex-col items-center text-center relative z-10"
      >
        <AnimatePresence mode="wait">
          {isSuccess ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut', delay: 0.1 }}
              className="w-full flex flex-col items-center justify-center py-8 min-h-72 sm:min-h-80"
            >
              <div className="mb-8 w-28 h-28 flex items-center justify-center rounded-full bg-green-500/10 border border-green-500/20 relative">
                <div className="absolute inset-0 bg-green-500/20 blur-[30px] rounded-full" />
                <ShieldCheck className="w-14 h-14 text-green-400 drop-shadow-[0_0_15px_rgba(74,222,128,0.8)] z-10" strokeWidth={2} />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">{t('verify.success_toast')}</h2>
              <p className="text-on-surface-variant text-sm">{t('verify.redirecting')}</p>
            </motion.div>

          ) : connectorURI ? (
            <motion.div
              key="qr"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="w-full flex flex-col items-center min-h-72 sm:min-h-80"
            >
              {/* A phone cannot photograph its own screen, so it gets a deep
                  link into the app instead of a code. The heading said "scan
                  this code" either way, describing something that was not on
                  screen. */}
              <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
                {t(isMobile ? 'verify.open_title' : 'verify.qr_title')}
              </h2>
              <p className="text-on-surface-variant text-sm mb-6 px-4">
                {t(isMobile ? 'verify.open_desc' : 'verify.qr_desc')}
              </p>
              {isMobile ? (
                <div className="flex flex-col items-center gap-4 mb-6">
                  <a href={connectorURI} target="_blank" rel="noopener noreferrer"
                    className="px-6 py-4 bg-white text-black font-semibold rounded-2xl flex items-center gap-3 shadow-lg active:scale-95 transition-transform">
                    <img src="/world-id-logo.svg" alt="" className="w-6 h-6" />
                    {t('verify.btn_open_app')}
                  </a>
                  <p className="text-on-surface-variant text-xs text-center px-4">{t('verify.mobile_return_hint')}</p>
                </div>
              ) : (
                <div className="p-4 bg-white rounded-2xl shadow-lg mb-6">
                  <QRCodeSVG value={connectorURI} size={200} level="M" includeMargin={false} />
                </div>
              )}
              <div className="flex items-center gap-2 text-on-surface-variant text-xs mb-6">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>{t('verify.qr_waiting')}</span>
              </div>
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

        {!isSuccess && !connectorURI && (
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
          </div>
        )}
      </motion.div>
    </div>
  );
}
