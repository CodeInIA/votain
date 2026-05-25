import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass, Vote, Clock, User, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { LanguageSelector } from '../ui/LanguageSelector';

interface NavItem {
  to: string;
  labelKey: string;
  icon: React.ReactNode;
}

const VOTER_ITEMS: NavItem[] = [
  { to: '/discover',        labelKey: 'nav.discover',  icon: <Compass className="w-4 h-4" /> },
  { to: '/voter/elections', labelKey: 'nav.elections', icon: <Vote    className="w-4 h-4" /> },
  { to: '/voter/history',   labelKey: 'nav.history',   icon: <Clock   className="w-4 h-4" /> },
  { to: '/voter/profile',   labelKey: 'nav.profile',   icon: <User    className="w-4 h-4" /> },
];

const PUBLIC_ITEMS: NavItem[] = [
  { to: '/discover',     labelKey: 'nav.discover',     icon: <Compass className="w-4 h-4" /> },
  { to: '/how-it-works', labelKey: 'nav.how_it_works', icon: null },
];

interface TopNavProps {
  role?: 'voter' | 'organizer' | 'public';
}

export function TopNav({ role = 'public' }: TopNavProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const items = role === 'voter' ? VOTER_ITEMS : PUBLIC_ITEMS;

  return (
    <nav
      className="hidden md:flex items-center gap-6 px-8 py-3 border-b border-white/5 bg-surface/60 backdrop-blur-xl"
      aria-label="Top navigation"
    >
      {/* Logo */}
      <button
        type="button"
        onClick={() => navigate('/')}
        className="flex items-center gap-3 shrink-0 hover:opacity-80 transition-opacity"
      >
        <img src="/votain-logo.webp" alt="Votain" className="w-8 h-8 object-contain" />
        <img src="/votain-wordmark.svg" alt="" className="h-4 object-contain translate-y-0.5" />
      </button>

      {/* Nav links */}
      <div className="flex items-center gap-1 flex-1">
        {items.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all',
              isActive
                ? 'bg-primary/10 text-primary-dim'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
            )}
          >
            {item.icon}
            {t(item.labelKey)}
          </NavLink>
        ))}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-3 shrink-0">
        <LanguageSelector />
        {role === 'organizer' ? (
          <Button
            variant="gradient"
            size="sm"
            onClick={() => navigate('/organizer/elections/new')}
            className="rounded-full gap-1.5 px-4"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('nav.create_election')}
          </Button>
        ) : role === 'voter' ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-tertiary/10 text-tertiary text-xs font-semibold ring-1 ring-tertiary/20">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary" />
            {t('nav.verified_voter')}
          </div>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={() => navigate('/voter/signin')}
            className="rounded-full border-white/10 hover:bg-white/10 px-5"
          >
            {t('landing.login')}
          </Button>
        )}
      </div>
    </nav>
  );
}
