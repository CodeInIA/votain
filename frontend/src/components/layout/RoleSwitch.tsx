/**
 * Changes which of two live sessions the navigation is dressed for.
 *
 * Only rendered when a person actually holds both, which is the only time there
 * is anything to choose. One session resolves to itself and the control would
 * be a switch with nowhere to go.
 *
 * Switching navigates to that role's home rather than staying put, because the
 * current page usually belongs to the role being left: flipping to the voter
 * view while standing on the gas tank would leave voter navigation wrapped
 * around an organizer screen. The routes themselves are unaffected either way,
 * since guards ask the sessions and not this.
 */
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Vote } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import { homeRouteFor, type Role } from '../../lib/activeRole';

const OPTIONS: { role: Role; labelKey: string; icon: typeof Vote }[] = [
  { role: 'voter', labelKey: 'nav.role_voter', icon: Vote },
  { role: 'organizer', labelKey: 'nav.role_organizer', icon: LayoutDashboard },
];

export function RoleSwitch({ className }: { className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { voterLoggedIn, organizerLoggedIn, activeRole, setActiveRole } = useAuth();

  if (!voterLoggedIn || !organizerLoggedIn) return null;

  const switchTo = (role: Role) => {
    if (role === activeRole) return;
    setActiveRole(role);
    navigate(homeRouteFor(role));
  };

  return (
    <div
      role="group"
      aria-label={t('nav.role_switch')}
      className={cn(
        'flex items-center gap-0.5 p-0.5 rounded-full bg-surface-lowest/60 ring-1 ring-outline-variant/30',
        className,
      )}
    >
      {OPTIONS.map(({ role, labelKey, icon: Icon }) => {
        const active = role === activeRole;
        return (
          <button
            key={role}
            type="button"
            onClick={() => switchTo(role)}
            aria-pressed={active}
            title={t(labelKey)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full',
              'text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer',
              active
                ? 'bg-primary/15 text-primary-dim'
                : 'text-on-surface-meta hover:text-on-surface hover:bg-white/5',
            )}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />
            {/* The icons carry it on a phone, where the bar is already tight.
                `title` and the pressed state keep it readable without them. */}
            <span className="hidden sm:inline">{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
