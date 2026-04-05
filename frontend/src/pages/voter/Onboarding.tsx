import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Fingerprint, ShieldAlert, CheckCircle, ChevronRight, ChevronLeft } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Button } from '../../components/ui/Button';

// Helper for tailwind classes 
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const stepsData = [
    {
      id: 'what',
      title: t('onboarding.what_title'),
      description: t('onboarding.what_desc'),
      icon: <img src="/votain-logo.png" alt="Votain" className="w-16 h-16 sm:w-20 sm:h-20 object-contain drop-shadow-[0_0_10px_rgba(79,142,247,0.3)]" />
    },
    {
      id: 'privacy',
      title: t('onboarding.privacy_title'),
      description: t('onboarding.privacy_desc'),
      icon: <Fingerprint className="w-16 h-16 text-secondary-dim" strokeWidth={1.5} />
    },
    {
      id: 'coercion',
      title: t('onboarding.coercion_title'),
      description: t('onboarding.coercion_desc'),
      icon: <ShieldAlert className="w-16 h-16 text-primary" strokeWidth={1.5} />
    },
    {
      id: 'free',
      title: t('onboarding.free_title'),
      description: t('onboarding.free_desc'),
      icon: <CheckCircle className="w-16 h-16 text-tertiary" strokeWidth={1.5} />
    }
  ];

  const handleNext = () => {
    if (step < stepsData.length - 1) {
      setStep(step + 1);
    } else {
      // Navigate to the next step in the voter flow (identity validation)
      navigate('/voter/verify'); 
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    } else {
      // Navigate back to the landing page
      navigate(-1);
    }
  };

  const currentData = stepsData[step];

  return (
    <div className="relative min-h-dvh w-full bg-background text-on-surface font-body selection:bg-primary selection:text-white overflow-x-hidden flex flex-col items-center justify-center p-4">

      {/* Liquid Background Atmosphere */}
      <div className="fixed inset-0 z-0 pointer-events-none liquid-mesh" />
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 blur-[150px] rounded-full" />

      {/* Decorative Visual Asset */}
      <div className="fixed inset-0 z-0 w-full h-full opacity-20 pointer-events-none mix-blend-screen">       
        <div
          className="w-full h-full bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/landing-background.jpg')" }}
        />
      </div>

      {/* global back button */}
      <Button
        onClick={handleBack}
        variant="ghost"
        className="absolute top-4 left-4 sm:top-6 sm:left-6 z-50 w-12 h-12 p-0 flex items-center justify-center rounded-full bg-surface-low/30 hover:bg-surface-low/50 backdrop-blur-xl border border-white/5 text-white shadow-lg"
        aria-label="Go back"
      >
        <ChevronLeft className="w-6 h-6" />
      </Button>
      
      <motion.div 
        layout
        className={cn(
          "w-full max-w-120 bg-surface-low/30 backdrop-blur-3xl rounded-4xl p-6 sm:p-10 border border-white/5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] flex flex-col items-center text-center relative z-10"
        )}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="w-full flex flex-col items-center min-h-72 sm:min-h-80"
          >
            {/* Icon Circle */}
            <div className="mb-6 sm:mb-8 w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center bg-surface-lowest/40 rounded-full shadow-[inset_0_2px_20px_rgba(255,255,255,0.02)] border border-white/5 shrink-0">
              {currentData.icon}
            </div>

            <div className="min-h-16 sm:min-h-20 flex items-center mb-3 sm:mb-4">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white drop-shadow-sm leading-tight px-2">
                {currentData.title}
              </h1>
            </div>
            <p className="text-on-surface-variant text-sm sm:text-base leading-relaxed mb-6 sm:mb-8 min-h-20 sm:min-h-24 px-4 shrink-0">
              {currentData.description}
            </p>
            
          </motion.div>
        </AnimatePresence>

        {/* Navigation & Dots */}
        <div className="w-full mt-4 sm:mt-6 flex flex-col items-center">
          <div className="flex gap-2 mb-6 sm:mb-8">
            {stepsData.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-500 cursor-pointer",
                  i === step ? "w-8 bg-primary" : "w-1.5 bg-outline-variant hover:bg-primary/50"
                )}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          <div className="flex w-full gap-3">
            <Button 
              onClick={handleNext}
              size="lg"
              variant="gradient"
              className="w-full rounded-full flex items-center justify-center gap-2 group text-lg font-semibold"
            >
              {step === stepsData.length - 1 ? t('onboarding.btn_start') : t('onboarding.btn_next')}
              <ChevronRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
