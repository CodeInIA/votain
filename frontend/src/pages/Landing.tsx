import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Footer } from '../components/layout/Footer';
import { Button } from '../components/ui/Button';

export default function Landing() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="relative h-dvh w-full bg-background text-on-surface font-body selection:bg-primary selection:text-white overflow-hidden flex flex-col">
      
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

      <Header />

      <main className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-center px-4 sm:px-6 md:px-8 py-4 sm:py-6 w-full">
        {/* Main Hero Section for Voters */}
        <div className="text-center max-w-4xl mx-auto flex flex-col items-center gap-[min(1.25rem,2.5dvh)]">
          <div className="inline-flex items-center justify-center">
            <img 
              alt="Votain Logo" 
              className="w-[clamp(5rem,10vh,7rem)] h-[clamp(5rem,10vh,7rem)] object-contain drop-shadow-[0_0_20px_rgba(79,142,247,0.4)]" 
              src="/votain-logo.webp"
            />
          </div>
          <h1 className="text-[clamp(2.1rem,4.6vh,4.8rem)] font-black tracking-tighter text-transparent bg-clip-text bg-linear-to-b from-white to-white/70 leading-[1.05] pb-1 pr-2">
            {t('landing.subtitle_1')}<br />{t('landing.subtitle_2')}
          </h1>
          <p className="text-[clamp(0.95rem,1.7vh,1.15rem)] text-on-surface-variant text-center max-w-xl mx-auto leading-snug font-medium">
            {t('landing.hero_desc')}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 w-full pt-[min(1rem,2dvh)]">
            <Button
              variant="gradient"
              size="lg"
              onClick={() => navigate('/voter/onboarding')}
              className="w-full sm:w-72 rounded-full px-8 h-11 sm:h-12 text-sm sm:text-base font-semibold flex items-center justify-center gap-3 shrink-0"
            >
              <img 
                alt="" 
                aria-hidden="true" 
                className="w-5 h-5 object-contain opacity-95 shrink-0" 
                style={{ filter: "brightness(0) saturate(100%) invert(8%) sepia(37%) saturate(5435%) hue-rotate(204deg) brightness(90%) contrast(103%)" }}
                src="/world-id-logo.svg" 
              />
              <span className="truncate">{t('landing.voter_cta')}</span>
            </Button>

            <Button 
              variant="default"
              size="lg"
              onClick={() => navigate('/discover')}
              className="w-full sm:w-72 rounded-full px-8 h-11 sm:h-12 text-sm sm:text-base border border-white/20 text-white hover:bg-white/5 flex items-center justify-center shrink-0"
            >
              <span className="truncate">{t('landing.browse')}</span>
            </Button>
          </div>
          
          <div className="mt-[min(1.5rem,3dvh)] flex flex-col items-center justify-center gap-[min(0.75rem,1.5dvh)] shrink-0 px-2 pb-1">
            <Link 
              to="/how-it-works" 
              className="text-[clamp(0.85rem,1.5vh,1rem)] text-on-surface-variant hover:text-on-surface active:text-on-surface focus-visible:text-on-surface focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-4 focus-visible:ring-offset-background outline-none rounded-sm font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer pb-1"
            >
              {t('landing.how_it_works')}
              <CircleHelp className="w-4 h-4 shrink-0" />
            </Link>
            
            <Link 
              to="/organizer/auth" 
              className="text-[clamp(0.72rem,1.2vh,0.875rem)] text-on-surface-meta hover:text-white active:text-white focus-visible:text-white outline-none rounded-sm font-medium transition-colors cursor-pointer mt-1"
            >
              {t('landing.are_you_organizer')} <span className="underline underline-offset-4">{t('landing.create_election_link')}</span>
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}