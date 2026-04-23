import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

export function Footer({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <footer className={cn("bg-slate-950/40 backdrop-blur-md w-full py-[min(0.5rem,1.2dvh)] sm:py-3 border-t border-white/5 shrink-0 z-20", className)}>
      <div className="flex flex-col md:flex-row justify-between items-center px-5 md:px-8 xl:px-12 w-full gap-[min(0.35rem,1dvh)] sm:gap-2">
        <div className="text-slate-400 font-bold text-[min(0.6rem,1.3dvh)] sm:text-xs tracking-tight">
          {t('landing.footer.protocol')}
        </div>      
        <div className="flex flex-wrap justify-center items-center gap-x-[min(0.8rem,2.5vw)] sm:gap-x-5 gap-y-1 text-slate-500 text-[min(0.58rem,1.15dvh)] sm:text-xs">     
          <a className="hover:text-slate-200 active:text-slate-200 focus-visible:text-slate-200 outline-none focus-visible:underline transition-colors cursor-pointer" href="#">{t('landing.footer.terms')}</a>
          <a className="hover:text-slate-200 active:text-slate-200 focus-visible:text-slate-200 outline-none focus-visible:underline transition-colors cursor-pointer" href="#">{t('landing.footer.privacy')}</a>
          <a className="hover:text-slate-200 active:text-slate-200 focus-visible:text-slate-200 outline-none focus-visible:underline transition-colors cursor-pointer" href="#">{t('landing.footer.language')}</a>
        </div>
        <div className="text-slate-500 text-[min(0.58rem,1.15dvh)] sm:text-xs text-center">
          {t('landing.footer.copyright')}
        </div>
      </div>
    </footer>
  );
}