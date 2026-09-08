/**
 * The pages a search engine should know about, and the ones it should not.
 *
 * Kept beside the app rather than hand written into `public/sitemap.xml`,
 * because a sitemap listing a route that no longer exists is worse than no
 * sitemap: it is a promise of a page that 404s. The Vite plugin in
 * `vite.config.ts` renders both files from this list at build time.
 *
 * WHAT IS ABSENT, AND WHY. Every `/voter/*` and `/organizer/*` route needs a
 * session, so a crawler reaching one sees a redirect to a sign in screen: no
 * content to index and a bounce recorded against the site. Election pages
 * (`/election/:id`) ARE public and crawlable, and are deliberately not listed:
 * they come from the chain, so a static file cannot enumerate them, and one
 * generated at build time would be stale the moment an organizer deploys the
 * next election. They get found by the links on Discover, which is exactly what
 * a crawler follows.
 */

export interface PublicRoute {
  path: string;
  /**
   * Relative importance within this site, not a ranking signal between sites.
   * The landing page and the list of elections are the two entry points that
   * matter.
   */
  priority: number;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { path: '/', priority: 1.0, changefreq: 'weekly' },
  { path: '/discover', priority: 0.9, changefreq: 'daily' },
  { path: '/how-it-works', priority: 0.8, changefreq: 'monthly' },
  { path: '/verify-receipt', priority: 0.7, changefreq: 'monthly' },
  { path: '/terms', priority: 0.3, changefreq: 'yearly' },
  { path: '/privacy', priority: 0.3, changefreq: 'yearly' },
];

/** Route prefixes that need a session, and so have nothing to offer a crawler. */
export const PRIVATE_PREFIXES: readonly string[] = ['/voter/', '/organizer/'];
