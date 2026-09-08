/**
 * Emits `robots.txt` and `sitemap.xml` at build time.
 *
 * Both need the absolute site URL, which is not known at authoring time: the
 * same bundle is meant to run on a Fleek subdomain, a custom domain and
 * localhost. `VITE_PUBLIC_URL` supplies it and these files are rendered from
 * it, so there is no hardcoded hostname to forget when the deployment moves.
 *
 * Written as a plugin rather than a checked-in pair of static files so the
 * route list has one source (`publicRoutes.ts`), the same one the router is
 * meant to agree with.
 */
import type { Plugin } from 'vite';

import { PRIVATE_PREFIXES, PUBLIC_ROUTES } from './publicRoutes';

/** Trailing slashes are stripped so joins below cannot produce `//`. */
const normalise = (url: string): string => url.trim().replace(/\/+$/, '');

export function robotsTxt(siteUrl: string): string {
  const disallow = PRIVATE_PREFIXES.map(prefix => `Disallow: ${prefix}`).join('\n');
  return `# Votain
#
# Everything under /voter/ and /organizer/ requires a session, so a crawler
# reaching one is redirected to a sign in screen: nothing to index either way.
# Election pages are public and crawlable; they are reached from /discover
# rather than listed in the sitemap, because they live on chain and a static
# file cannot stay current with them.

User-agent: *
Allow: /
${disallow}

Sitemap: ${normalise(siteUrl)}/sitemap.xml
`;
}

export function sitemapXml(siteUrl: string, today: string): string {
  const base = normalise(siteUrl);
  const urls = PUBLIC_ROUTES.map(
    ({ path, priority, changefreq }) => `  <url>
    <loc>${base}${path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority.toFixed(1)}</priority>
  </url>`,
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function seoFiles(): Plugin {
  let siteUrl = '';

  return {
    name: 'votain-seo-files',
    apply: 'build',

    configResolved(config) {
      siteUrl = config.env.VITE_PUBLIC_URL ?? '';
    },

    generateBundle() {
      if (!siteUrl) {
        // Loud rather than emitting a sitemap full of relative URLs, which
        // search engines reject outright.
        this.warn(
          'VITE_PUBLIC_URL is not set: robots.txt and sitemap.xml were not generated. ' +
            'Set it to the absolute site URL, for example https://votain.app',
        );
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(siteUrl) });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(siteUrl, today) });
    },
  };
}
