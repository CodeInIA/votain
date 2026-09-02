/**
 * Which of a person's two sessions the app is currently dressed for.
 *
 * The sessions were always independent: `AuthProvider` keeps a voter cookie and
 * an organizer passkey flag side by side, and nothing stops one person holding
 * both. The CHROME could not represent it. `TopNav` and `BottomTabNav` resolved
 * `organizerLoggedIn ? ORGANIZER : voterLoggedIn ? VOTER : PUBLIC`, so the
 * moment an organizer also signed in as a voter the organizer nav won outright
 * and every voter route vanished from the navigation. The routes still worked;
 * there was simply no link to them.
 *
 * Merging the two navigations was the other option and would have been worse: a
 * single bar carrying Dashboard, Members, Gas, My elections and History says
 * nothing about which hat the person is wearing, and the two roles deliberately
 * see different things about the same election. So the role stays singular and
 * becomes switchable.
 *
 * NOT AN AUTHORISATION DECISION. It picks navigation and nothing else. Route
 * guards keep asking the sessions themselves (`RequireAuth`, `RequireOrganizer`,
 * the backend cookie, `onlyOrganizer` on chain), so a person who switches to the
 * voter view keeps every organizer power they had, and one who tampers with the
 * stored preference gains none.
 */

export type Role = 'voter' | 'organizer' | 'public';

const ROLE_KEY = 'votain_active_role';

export interface RoleSessions {
  voterLoggedIn: boolean;
  organizerLoggedIn: boolean;
}

/** The role this browser last claimed, or null if it never claimed one. */
export function readRolePreference(): Role | null {
  const stored = localStorage.getItem(ROLE_KEY);
  return stored === 'voter' || stored === 'organizer' ? stored : null;
}

export function storeRolePreference(role: Role): void {
  if (role === 'public') localStorage.removeItem(ROLE_KEY);
  else localStorage.setItem(ROLE_KEY, role);
}

export function clearRolePreference(): void {
  localStorage.removeItem(ROLE_KEY);
}

/**
 * The role to dress the app in.
 *
 * The preference only decides anything when BOTH sessions are live, which is
 * the only case where there is a choice to make. With one session the answer is
 * that session, so a stale preference left by a signed-out role cannot strand
 * anybody in navigation for a role they no longer hold.
 *
 * With both live and nothing preferred the answer is `organizer`, which is what
 * the old expression returned. That keeps this change additive: nobody's
 * navigation moves until they ask it to.
 */
export function resolveActiveRole(sessions: RoleSessions, preferred: Role | null): Role {
  const { voterLoggedIn, organizerLoggedIn } = sessions;
  if (voterLoggedIn && organizerLoggedIn) {
    return preferred === 'voter' ? 'voter' : 'organizer';
  }
  if (organizerLoggedIn) return 'organizer';
  if (voterLoggedIn) return 'voter';
  return 'public';
}

/** Where each role's navigation goes home to. */
export function homeRouteFor(role: Role): string {
  if (role === 'organizer') return '/organizer/dashboard';
  if (role === 'voter') return '/voter/elections';
  return '/';
}

/**
 * Pages that exist for both roles, paired by route.
 *
 * Only the pairs where the SAME page is being looked at from the other side.
 * An election is deliberately absent: `/voter/election/:id` and
 * `/organizer/election/:id` are two views of one election, but the organizer
 * one only loads for the wallet that owns it, so sending someone there because
 * they flipped a switch in the header would land them on a page that refuses.
 * `ViewAsSwitch`, on the election itself, is where that crossing belongs.
 */
const EQUIVALENT: Record<string, Record<Role, string>> = {
  profile: {
    voter: '/voter/profile',
    organizer: '/organizer/profile',
    public: '/',
  },
};

/**
 * Where switching to `to` should leave the person standing.
 *
 * Staying put is the right answer more often than going home. Discover, the
 * receipt verifier and How it works are the same page for everybody, so
 * switching role on one of them and being thrown to a dashboard loses the place
 * for no reason. A page that belongs to one role is either paired with its
 * counterpart or, failing that, left behind for the new role's home, since the
 * alternative is voter navigation wrapped around the gas tank.
 */
export function switchDestination(pathname: string, to: Role): string {
  for (const pair of Object.values(EQUIVALENT)) {
    if (Object.values(pair).includes(pathname)) return pair[to];
  }
  const belongsToARole = pathname.startsWith('/voter/') || pathname.startsWith('/organizer/');
  return belongsToARole ? homeRouteFor(to) : pathname;
}
