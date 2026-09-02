import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass, Vote, Clock, User, LayoutDashboard, Users, Zap, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { homeRouteFor } from '../../lib/activeRole';
import { RoleSwitch } from './RoleSwitch';

interface NavItem {
  to: string;
  labelKey: string;
  icon: React.ReactNode;
}

const VOTER_ITEMS: NavItem[] = [
  { to: '/voter/elections', labelKey: 'nav.elections', icon: <Vote    className="w-4 h-4" /> },
  { to: '/discover',        labelKey: 'nav.discover',  icon: <Compass className="w-4 h-4" /> },
  { to: '/voter/history',   labelKey: 'nav.history',   icon: <Clock   className="w-4 h-4" /> },
];

const ORGANIZER_ITEMS: NavItem[] = [
  { to: '/organizer/dashboard', labelKey: 'nav.dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: '/discover',            labelKey: 'nav.discover',  icon: <Compass         className="w-4 h-4" /> },
  { to: '/organizer/members',   labelKey: 'nav.members',   icon: <Users           className="w-4 h-4" /> },
  { to: '/organizer/gas',       labelKey: 'nav.gas',       icon: <Zap             className="w-4 h-4" /> },
];

// The verifier belongs here and not only in the voter's profile. It takes no
// session and checks anyone's receipt, so reaching it required being the one
// person who least needed it.
const PUBLIC_ITEMS: NavItem[] = [
  { to: '/discover',       labelKey: 'nav.discover', icon: <Compass     className="w-4 h-4" /> },
  { to: '/verify-receipt', labelKey: 'nav.verify',   icon: <ShieldCheck className="w-4 h-4" /> },
];

// No props: the nav is fully determined by auth state, so the page's role hint
// is not needed here. Which role that is comes from `activeRole` rather than
// from the flags directly, because someone holding both sessions gets to say.
export function TopNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeRole } = useAuth();

  const items = activeRole === 'organizer' ? ORGANIZER_ITEMS :
                activeRole === 'voter'     ? VOTER_ITEMS :
                                              PUBLIC_ITEMS;

  const homeRoute = homeRouteFor(activeRole);

  return (
    <nav
      className="flex items-center gap-3 md:gap-6 px-4 md:px-8 py-3 border-b border-white/5 bg-surface/60 backdrop-blur-xl"
      aria-label="Top navigation"
    >
      {/* Logo */}
      <button
        type="button"
        data-nav-href={homeRoute}
        onClick={() => navigate(homeRoute)}
        className="flex items-center gap-3 shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
      >
        <img src="/votain-logo.webp" alt="Votain" className="w-8 h-8 object-contain" />
        <img src="/votain-wordmark.svg" alt="" className="h-4 object-contain translate-y-0.5" />
      </button>

      {/* Nav links, desktop only */}
      <div className="hidden md:flex items-center gap-1 flex-1">
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
      <div className="flex items-center gap-3 shrink-0 ml-auto">
        <RoleSwitch />
        {activeRole === 'organizer' ? (
          <button
            type="button"
            data-nav-href="/organizer/profile"
            onClick={() => navigate('/organizer/profile')}
            className="relative w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center hover:bg-primary/20 transition-colors cursor-pointer"
            aria-label={t('nav.profile')}
          >
            <User className="w-4 h-4 text-primary" />
          </button>
        ) : activeRole === 'voter' ? (
          <button
            type="button"
            onClick={() => navigate('/voter/profile')}
            className="relative w-8 h-8 rounded-full bg-tertiary/10 border border-tertiary/20 flex items-center justify-center hover:bg-tertiary/20 transition-colors cursor-pointer"
            aria-label={t('nav.profile')}
          >
            <User className="w-4 h-4 text-tertiary" />
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-tertiary border-2 border-background" />
          </button>
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
