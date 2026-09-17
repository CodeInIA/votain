import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass, Vote, Clock, LayoutDashboard, Users, Zap, Bookmark } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';

interface Tab {
  to: string;
  icon: React.ReactNode;
  labelKey: string;
}

const VOTER_TABS: Tab[] = [
  { to: '/voter/elections', icon: <Vote    className="w-5 h-5" />, labelKey: 'nav.elections' },
  { to: '/discover',        icon: <Compass className="w-5 h-5" />, labelKey: 'nav.discover'  },
  { to: '/voter/history',   icon: <Clock   className="w-5 h-5" />, labelKey: 'nav.history'   },
];

const ORGANIZER_TABS: Tab[] = [
  { to: '/organizer/dashboard', icon: <LayoutDashboard className="w-5 h-5" />, labelKey: 'nav.dashboard' },
  { to: '/discover',            icon: <Compass         className="w-5 h-5" />, labelKey: 'nav.discover'  },
  { to: '/organizer/members',   icon: <Users           className="w-5 h-5" />, labelKey: 'nav.members'   },
  { to: '/organizer/gas',       icon: <Zap             className="w-5 h-5" />, labelKey: 'nav.gas'       },
  // Here as well as in the top bar: on a phone this IS the navigation, and a
  // page reachable only on a desktop is a page most people never see.
  { to: '/organizer/saved',     icon: <Bookmark        className="w-5 h-5" />, labelKey: 'saved.nav'     },
];

const PUBLIC_TABS: Tab[] = [
  { to: '/discover', icon: <Compass className="w-5 h-5" />, labelKey: 'nav.discover' },
];

export function BottomTabNav() {
  const { t } = useTranslation();
  const { activeRole } = useAuth();
  // Same source as `TopNav`, so the bar at the top and the bar at the bottom
  // can never disagree about which role is on screen.
  const tabs = activeRole === 'organizer' ? ORGANIZER_TABS :
               activeRole === 'voter'     ? VOTER_TABS :
                                             PUBLIC_TABS;
  return (
    <nav
      /* NO `safe-area-pb` HERE, and that is not an oversight.
       *
       * The class was on this element and was defined nowhere: not in
       * `index.css`, not in a Tailwind config (v4 has none, it configures
       * through CSS), and zero occurrences in the built stylesheet. It read as
       * safe-area handling and did nothing at all.
       *
       * Defining it was tried and reverted. `index.html` sets
       * `viewport-fit=cover`, so the page does reach the physical edge and the
       * padding makes this bar taller by the reported inset. On the phone it
       * was checked against, that produced a band of empty bar below the labels
       * and no system indicator drawn into it: space given away for nothing.
       *
       * So the false claim is removed rather than made true. What this leaves
       * open, and it is worth knowing before anyone adds it back: on a device
       * that does draw a home indicator, the labels sit under it. The fix then
       * is padding driven by a real measurement on such a device, not by a
       * class name that looked like it was already doing the job.
       */
      className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden bg-surface/80 backdrop-blur-xl border-t border-white/5"
      aria-label="Main navigation"
    >
      {tabs.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) => cn(
            'flex-1 flex flex-col items-center justify-center gap-0.5 py-3 px-1 min-h-15',
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
