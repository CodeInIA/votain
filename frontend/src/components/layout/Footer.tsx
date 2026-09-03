import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { SITE_LINKS } from './siteLinks';

export function Footer({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <footer
      role="contentinfo"
      className={cn(
        'w-full py-3 sm:py-4 border-t border-white/5 bg-surface-lowest/40 backdrop-blur-sm shrink-0 z-20',
        className
      )}
    >
      <div className="flex flex-col sm:flex-row justify-between items-center px-5 sm:px-8 gap-2 sm:gap-4">
        <span className="text-on-surface-meta font-semibold text-xs tracking-tight">
          {t('landing.footer.protocol')}
        </span>

        <div className="flex items-center gap-5 text-xs text-on-surface-meta">
          {SITE_LINKS.map(({ to, labelKey }) => (
            <Link key={to} to={to} className="hover:text-on-surface transition-colors">
              {t(labelKey)}
            </Link>
          ))}
        </div>

        <span className="text-xs text-on-surface-meta">{t('landing.footer.copyright')}</span>
      </div>
    </footer>
  );
}
