import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CircleHelp, SquarePlus, UserCog } from 'lucide-react';
import { ActionCard } from '../components/ui/ActionCard';
import { Footer } from '../components/layout/Footer';

export default function Landing() {
  const { t } = useTranslation();

  return (
    <div className="relative min-h-dvh w-full bg-background text-on-surface font-body selection:bg-primary selection:text-white overflow-x-hidden flex flex-col items-center">
      
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

      {/* Content Wrapper */}
      <div className="relative z-10 flex flex-col flex-1 w-full">
        
        {/* Splash Content */}
        <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 md:px-8 pt-[max(4rem,8dvh)] pb-[min(1.5rem,3dvh)] sm:pt-16 sm:pb-8 w-full">
          
          {/* Brand Anchor Section */}
          <header className="text-center mb-[min(1.5rem,3dvh)] sm:mb-12 shrink-0">
            <div className="inline-flex items-center justify-center mb-[min(0.75rem,2dvh)] sm:mb-6">
              <div className="w-[min(5.5rem,12dvh)] h-[min(5.5rem,12dvh)] sm:w-28 sm:h-28 bg-linear-to-br from-primary to-secondary p-px rounded-2xl shrink-0">
                <div className="w-full h-full bg-surface-lowest rounded-[15px] flex items-center justify-center">
                  <img 
                    alt="Votain Logo" 
                    className="w-[60%] h-[60%] object-contain drop-shadow-[0_0_15px_rgba(79,142,247,0.5)]" 
                    src="/votain-logo.png"
                  />
                </div>
              </div>
            </div>
            <h1 className="text-[min(2.5rem,7dvh)] md:text-5xl lg:text-6xl font-black tracking-tighter text-on-surface mb-[min(0.25rem,1dvh)] leading-none">{t('landing.title')}</h1>
            <p className="text-[min(0.875rem,2.5dvh)] sm:text-base text-on-surface-variant font-medium tracking-tight mb-0 leading-snug">{t('landing.subtitle')}</p>
          </header>

          {/* Path Selection Grid (Bento Style) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-[min(0.75rem,2dvh)] md:gap-6 w-full max-w-4xl shrink-0 py-1 px-1">
            
            <ActionCard
              ariaLabel={t('landing.voter_title')}
              title={t('landing.voter_title')}
              description={t('landing.voter_desc')}
              ctaText={t('landing.voter_cta')}
              variant="primary"
              icon={
                <img alt="" aria-hidden="true" className="w-[50%] h-[50%] object-contain" style={{ filter: "invert(1) brightness(200%)" }} src="/world-id-logo.svg" />
              }
            />

            <ActionCard
              ariaLabel={t('landing.org_title')}
              title={t('landing.org_title')}
              description={t('landing.org_desc')}
              ctaText={t('landing.org_cta')}
              variant="secondary"
              ctaIcon={
                <SquarePlus className="w-full h-full" strokeWidth={2.5} />
              }
              icon={
                <UserCog className="w-[50%] h-[50%]" strokeWidth={1.5} />
              }
            />
          </div>

          {/* Secondary Actions */}
          <div className="my-auto flex flex-col items-center justify-center gap-[min(0.75rem,2dvh)] shrink-0 px-2 py-[min(1rem,2dvh)]">
            <Link 
              to="/discover" 
              className="px-[min(1.5rem,4vw)] sm:px-8 py-[min(0.5rem,1.5dvh)] md:py-3 text-[min(0.875rem,2dvh)] sm:text-sm rounded-full bg-surface-high/40 text-on-surface font-medium backdrop-blur-xl border border-outline-variant/10 hover:bg-surface-high/60 active:bg-surface-high/60 focus-visible:ring-2 focus-visible:ring-primary outline-none transition-all cursor-pointer text-center whitespace-nowrap"
            >
              {t('landing.browse')}
            </Link>
            <Link 
              to="/how-it-works" 
              className="text-on-surface-variant hover:text-on-surface active:text-on-surface focus-visible:text-on-surface focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-4 focus-visible:ring-offset-background outline-none rounded-sm text-[min(0.65rem,1.5dvh)] sm:text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer pb-[min(0.25rem,1dvh)]"
            >
              {t('landing.how_it_works')}
              <CircleHelp className="w-[1.25em] h-[1.25em]" />
            </Link>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}