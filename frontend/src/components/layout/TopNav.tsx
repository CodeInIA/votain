import { useLayoutEffect, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass, Vote, Clock, User, LayoutDashboard, Users, Zap, ShieldCheck, Bookmark } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { homeRouteFor } from '../../lib/activeRole';
import { RoleSwitch } from './RoleSwitch';
import { useNavFit } from './navFit';
import { rememberReturnTo } from '../../lib/returnTo';

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
  // Last, because it is the only one that is not about running an election:
  // it is the elections this organizer follows, which belong to other people.
  { to: '/organizer/saved',     labelKey: 'saved.nav',     icon: <Bookmark        className="w-4 h-4" /> },
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
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { activeRole } = useAuth();
  const { compact, report } = useNavFit();

  const navRef = useRef<HTMLElement>(null);
  const logoRef = useRef<HTMLButtonElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const items = activeRole === 'organizer' ? ORGANIZER_ITEMS :
                activeRole === 'voter'     ? VOTER_ITEMS :
                                              PUBLIC_ITEMS;

  const homeRoute = homeRouteFor(activeRole);

  /**
   * DOES THIS ROW FIT, asked of the row itself.
   *
   * Every breakpoint tried here was wrong for something. The bar carries two
   * links for a visitor, three for a voter and five for an organizer, in
   * thirteen languages, so the width it needs runs from about 700px to about
   * 1080. One number either cut the organizer's bar off at 768 or handed a
   * 1200px window a phone's navigation.
   *
   * The links are measured at their natural width whether or not they are
   * shown: when they do not fit they are made `invisible` and taken out of
   * flow, which leaves them laid out and measurable while removing them from
   * the page, the tab order and the accessibility tree. That is also what
   * keeps this from oscillating, since the measurement does not depend on the
   * answer.
   *
   * Before paint, so the first frame is already right, and again whenever the
   * bar is resized or the fonts land, which change every width in here.
   */
  useLayoutEffect(() => {
    const nav = navRef.current;
    const logo = logoRef.current;
    const links = linksRef.current;
    const actions = actionsRef.current;
    if (!nav || !logo || !links || !actions) return;

    const measure = () => {
      const bar = getComputedStyle(nav);
      const gap = parseFloat(bar.columnGap) || 0;
      const padding = parseFloat(bar.paddingLeft) + parseFloat(bar.paddingRight);
      const linkGap = parseFloat(getComputedStyle(links).columnGap) || 0;
      const items = Array.from(links.children) as HTMLElement[];
      const linksWidth =
        items.reduce((sum, el) => sum + el.offsetWidth, 0) +
        linkGap * Math.max(items.length - 1, 0);
      // A few pixels of margin: `offsetWidth` is rounded, and a bar that fits
      // by half a pixel is a bar that looks wrong.
      const needed = logo.offsetWidth + linksWidth + actions.offsetWidth + gap * 2 + padding + 8;
      report(needed > nav.clientWidth);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    // Web fonts arrive after the first paint and every label gets wider.
    void document.fonts?.ready.then(measure).catch(() => {});
    return () => observer.disconnect();
  }, [report, items, i18n.language]);

  return (
    <nav
      ref={navRef}
      // `relative` and clipped for the sake of the measuring copy of the links
      // below, which sits at its static position and would otherwise be able to
      // stretch the page sideways.
      className="relative overflow-hidden flex items-center gap-3 md:gap-6 px-4 md:px-8 py-3 border-b border-white/5 bg-surface/60 backdrop-blur-xl"
      aria-label="Top navigation"
    >
      {/* Logo */}
      <button
        ref={logoRef}
        type="button"
        data-nav-href={homeRoute}
        onClick={() => navigate(homeRoute)}
        className="flex items-center gap-3 shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
      >
        <img src="/votain-logo.webp" alt="Votain" className="w-8 h-8 object-contain" />
        <img src="/votain-wordmark.svg" alt="" className="h-4 object-contain translate-y-0.5" />
      </button>

      {/* The links, drawn here when they fit and measured here when they do
          not. See the effect above for why they stay in the document either
          way. `invisible` is doing real work: it keeps the layout, and takes
          the row out of the tab order and out of what a screen reader
          announces, which `opacity-0` would not. */}
      <div
        ref={linksRef}
        className={cn(
          'flex items-center gap-1',
          compact ? 'invisible absolute pointer-events-none' : 'flex-1',
        )}
      >
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
      <div ref={actionsRef} className="flex items-center gap-3 shrink-0 ml-auto">
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
          // Remembers the page first, so signing in from here comes back
          // to it. The election's own "verify to vote" did this already and
          // this button did not, which meant the same sign in ended in two
          // different places depending on which control started it.
            onClick={() => {
              rememberReturnTo(location.pathname + location.search);
              navigate('/voter/signin');
            }}
            className="rounded-full border-white/10 hover:bg-white/10 px-5"
          >
            {t('landing.login')}
          </Button>
        )}
      </div>
    </nav>
  );
}
