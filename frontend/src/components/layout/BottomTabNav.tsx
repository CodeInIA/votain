import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass, Vote, Clock, User } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Tab {
  to: string;
  icon: React.ReactNode;
  labelKey: string;
}

const TABS: Tab[] = [
  { to: '/discover',         icon: <Compass className="w-5 h-5" />, labelKey: 'nav.discover'  },
  { to: '/voter/elections',  icon: <Vote    className="w-5 h-5" />, labelKey: 'nav.elections' },
  { to: '/voter/history',    icon: <Clock   className="w-5 h-5" />, labelKey: 'nav.history'   },
  { to: '/voter/profile',    icon: <User    className="w-5 h-5" />, labelKey: 'nav.profile'   },
];

export function BottomTabNav() {
  const { t } = useTranslation();
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden bg-surface/80 backdrop-blur-xl border-t border-white/5 safe-area-pb"
      aria-label="Main navigation"
    >
      {TABS.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) => cn(
            'flex-1 flex flex-col items-center justify-center gap-0.5 py-3 px-1 min-h-[60px]',
            'text-xs font-medium transition-colors',
            isActive ? 'text-primary' : 'text-on-surface-meta hover:text-on-surface-variant'
          )}
        >
          {tab.icon}
          <span>{t(tab.labelKey)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
