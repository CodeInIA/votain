import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

export function Footer({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <footer className={cn("bg-slate-950/40 backdrop-blur-md w-full py-[min(0.75rem,2dvh)] sm:py-4 mt-auto border-t border-white/5 shrink-0 z-20", className)}>
      <div className="flex flex-col md:flex-row justify-between items-center px-6 md:px-12 xl:px-20 w-full gap-[min(0.5rem,1.5dvh)] sm:gap-3">
        <div className="text-slate-400 font-bold text-[min(0.65rem,1.5dvh)] sm:text-xs tracking-tight">
          {t('landing.footer.protocol')}
        </div>      
        <div className="flex flex-wrap justify-center items-center gap-x-[min(1rem,3vw)] sm:gap-x-6 gap-y-1 text-slate-500 text-[min(0.6rem,1.25dvh)] sm:text-xs">     
          <a className="hover:text-slate-200 active:text-slate-200 focus-visible:text-slate-200 outline-none focus-visible:underline transition-colors cursor-pointer" href="#">{t('landing.footer.terms')}</a>
          <a className="hover:text-slate-200 active:text-slate-200 focus-visible:text-slate-200 outline-none focus-visible:underline transition-colors cursor-pointer" href="#">{t('landing.footer.privacy')}</a>
          <a className="hover:text-slate-200 active:text-slate-200 focus-visible:text-slate-200 outline-none focus-visible:underline transition-colors cursor-pointer" href="#">{t('landing.footer.language')}</a>
        </div>
        <div className="text-slate-500 text-[min(0.6rem,1.25dvh)] sm:text-xs text-center">
          {t('landing.footer.copyright')}
        </div>
      </div>
    </footer>
  );
}