import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Fingerprint,
  ShieldAlert,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  Loader2,
  X,
} from 'lucide-react';
import { IDKit, orbLegacy, type IDKitResult } from '@worldcoin/idkit-core';
import { QRCodeSVG } from 'qrcode.react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Button } from '../../components/ui/Button';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [connectorURI, setConnectorURI] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleVerify = async (proof: IDKitResult) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/verify-human`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proof),
      });

      if (!res.ok) {
        const errorData = await res.json();
        console.error('Backend verification failed:', errorData);
        throw new Error('Backend verification failed');
      }

      const data = await res.json();

      if (data.sdJwt) {
        localStorage.setItem('voter_vc', data.sdJwt);
        localStorage.setItem('voter_nullifier', data.nullifier);
      }

      setConnectorURI(null);
      setIsSuccess(true);
      setTimeout(() => navigate('/voter/dashboard'), 1500);
    } catch (error) {
      console.error('Verification failed:', error);
      setQrError(t('verify.error_backend'));
      setIsVerifying(false);
      setConnectorURI(null);
    }
  };

  const handleOpenWorldId = async () => {
    setQrError(null);
    try {
      // 1. Obtener firma RP del backend
      const rpSigRes = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/rp-signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: import.meta.env.VITE_WORLD_ID_ACTION }),
      });

      if (!rpSigRes.ok) throw new Error('Failed to fetch rp-signature');
      const rpSig = await rpSigRes.json();

      // 2. Crear el request con IDKit v4
      const request = await IDKit.request({
        app_id: import.meta.env.VITE_WORLD_ID_APP_ID,
        action: import.meta.env.VITE_WORLD_ID_ACTION,
        rp_context: {
          rp_id: import.meta.env.VITE_WORLD_ID_RP_ID,
          nonce: rpSig.nonce,
          created_at: rpSig.created_at,
          expires_at: rpSig.expires_at,
          signature: rpSig.sig,
        },
        allow_legacy_proofs: true,
        environment: 'production',
      }).preset(orbLegacy({}));

      // 3. Mostrar el QR en la UI
      setConnectorURI(request.connectorURI);
      setIsVerifying(true);

      // 4. Esperar a que el usuario escanee y complete el flujo
      const completion = await request.pollUntilCompletion();
      if (!completion.success) {
        setQrError(t('verify.error_generic'));
        setIsVerifying(false);
        setConnectorURI(null);
        return;
      }
      await handleVerify(completion.result);
    } catch (e) {
      console.error('World ID flow failed:', e);
      setQrError(t('verify.error_generic'));
      setIsVerifying(false);
      setConnectorURI(null);
    }
  };

  const handleCancelQr = () => {
    setConnectorURI(null);
    setIsVerifying(false);
    setQrError(null);
  };

  const stepsData = [
    {
      id: 'what',
      title: t('onboarding.what_title'),
      description: t('onboarding.what_desc'),
      icon: (
        <img
          src="/votain-logo.webp"
          alt="Votain"
          className="w-16 h-16 sm:w-20 sm:h-20 object-contain drop-shadow-[0_0_10px_rgba(79,142,247,0.3)]"
        />
      ),
    },
    {
      id: 'privacy',
      title: t('onboarding.privacy_title'),
      description: t('onboarding.privacy_desc'),
      icon: <Fingerprint className="w-16 h-16 text-secondary-dim" strokeWidth={1.5} />,
    },
    {
      id: 'coercion',
      title: t('onboarding.coercion_title'),
      description: t('onboarding.coercion_desc'),
      icon: <ShieldAlert className="w-16 h-16 text-primary" strokeWidth={1.5} />,
    },
    {
      id: 'free',
      title: t('onboarding.free_title'),
      description: t('onboarding.free_desc'),
      icon: <CheckCircle className="w-16 h-16 text-tertiary" strokeWidth={1.5} />,
    },
    {
      id: 'verify',
      title: t('verify.title'),
      description: t('verify.description'),
      icon: (
        <img
          src="/world-id-logo.svg"
          alt="World ID"
          className="w-16 h-16 sm:w-20 sm:h-20"
          style={{ filter: 'invert(1) brightness(200%)' }}
        />
      ),
    },
  ];

  const handleNext = () => {
    if (step < stepsData.length - 1) setStep(step + 1);
  };

  const handleBack = () => {
    if (isVerifying) return;
    if (step > 0) setStep(step - 1);
    else navigate(-1);
  };

  const currentData = stepsData[step];

  return (
    <div className="relative min-h-dvh w-full bg-background text-on-surface font-body selection:bg-primary selection:text-white overflow-x-hidden flex flex-col items-center justify-center p-4">

      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none liquid-mesh" />
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 blur-[150px] rounded-full" />
      <div className="fixed inset-0 z-0 w-full h-full opacity-20 pointer-events-none mix-blend-screen">
        <div
          className="w-full h-full bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/landing-background.jpg')" }}
        />
      </div>

      {/* Back button */}
      <Button
        onClick={handleBack}
        variant="ghost"
        className="absolute top-4 left-4 sm:top-6 sm:left-6 z-50 w-12 h-12 p-0 flex items-center justify-center rounded-full bg-surface-low/30 hover:bg-surface-low/50 backdrop-blur-xl border border-white/5 text-white shadow-lg"
        aria-label={t('common.back')}
        disabled={isVerifying || isSuccess}
      >
        <ChevronLeft className="w-6 h-6" />
      </Button>

      <motion.div
        layout
        className="w-full max-w-120 bg-surface-low/30 backdrop-blur-3xl rounded-4xl p-6 sm:p-10 border border-white/5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] flex flex-col items-center text-center relative z-10"
      >
        <AnimatePresence mode="wait">

          {/* ── Estado: éxito ── */}
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
                <ShieldCheck
                  className="w-14 h-14 text-green-400 drop-shadow-[0_0_15px_rgba(74,222,128,0.8)] z-10"
                  strokeWidth={2}
                />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">{t('verify.success_toast')}</h2>
              <p className="text-on-surface-variant text-sm">{t('verify.redirecting')}</p>
            </motion.div>

          ) : connectorURI ? (
            /* ── Estado: mostrar QR ── */
            <motion.div
              key="qr"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="w-full flex flex-col items-center min-h-72 sm:min-h-80"
            >
              <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
                {t('verify.qr_title')}
              </h2>
              <p className="text-on-surface-variant text-sm mb-6 px-4">
                {t('verify.qr_desc')}
              </p>

              {/* QR */}
              <div className="p-4 bg-white rounded-2xl shadow-lg mb-6">
                <QRCodeSVG
                  value={connectorURI}
                  size={200}
                  level="M"
                  includeMargin={false}
                />
              </div>

              <div className="flex items-center gap-2 text-on-surface-variant text-xs mb-6">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>{t('verify.qr_waiting')}</span>
              </div>

              <Button
                onClick={handleCancelQr}
                variant="ghost"
                size="sm"
                className="flex items-center gap-1.5 text-on-surface-variant hover:text-white"
              >
                <X className="w-4 h-4" />
                {t('common.cancel')}
              </Button>
            </motion.div>

          ) : (
            /* ── Estado: paso normal ── */
            <motion.div
              key={step}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-full flex flex-col items-center min-h-72 sm:min-h-80"
            >
              <div className="mb-6 sm:mb-8 w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center bg-surface-lowest/40 rounded-full shadow-[inset_0_2px_20px_rgba(255,255,255,0.02)] border border-white/5 shrink-0">
                {currentData.icon}
              </div>
              <div className="min-h-16 sm:min-h-20 flex items-center mb-3 sm:mb-4">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white drop-shadow-sm leading-tight px-2">
                  {currentData.title}
                </h1>
              </div>
              <p className="text-on-surface-variant text-sm sm:text-base leading-relaxed mb-6 sm:mb-8 h-28 sm:h-32 px-4 shrink-0 overflow-y-auto w-full scrollbar-none">
                {currentData.description}
              </p>

              {/* Error inline */}
              {qrError && (
                <p className="text-red-400 text-sm mb-4">{qrError}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Dots + botones de navegación ── */}
        {!isSuccess && !connectorURI && (
          <div className="w-full mt-4 sm:mt-6 flex flex-col items-center">
            <div className="flex gap-2 mb-6 sm:mb-8">
              {stepsData.map((_, i) => (
                <button
                  key={i}
                  onClick={() => !isVerifying && setStep(i)}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-500 cursor-pointer',
                    i === step
                      ? 'w-8 bg-primary'
                      : 'w-1.5 bg-outline-variant hover:bg-primary/50'
                  )}
                  aria-label={t('onboarding.go_to_step', { step: i + 1 })}
                  disabled={isVerifying}
                />
              ))}
            </div>

            <div className="flex w-full gap-3">
              {step === stepsData.length - 1 ? (
                <Button
                  onClick={handleOpenWorldId}
                  size="lg"
                  variant="gradient"
                  disabled={isVerifying}
                  className="w-full rounded-full flex items-center justify-center gap-2 group text-lg font-semibold h-14"
                >
                  {isVerifying ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="opacity-80">{t('verify.btn_verifying')}</span>
                    </>
                  ) : (
                    <>
                      <img src="/world-id-logo.svg" alt="World ID" className="w-5 h-5" />
                      {t('verify.btn_verify')}
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handleNext}
                  size="lg"
                  variant="gradient"
                  className="w-full rounded-full flex items-center justify-center gap-2 group text-lg font-semibold h-14"
                >
                  {t('onboarding.btn_next')}
                  <ChevronRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                </Button>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}