import { describe, it, expect } from 'vitest';

import { robotsTxt, sitemapXml } from './seoPlugin';
import { PRIVATE_PREFIXES, PUBLIC_ROUTES } from './publicRoutes';

/**
 * The two files a crawler reads before anything else.
 *
 * Both are generated, so the thing worth testing is that generation cannot
 * quietly produce something invalid: a sitemap with relative URLs is rejected
 * outright, a doubled slash is a 404, and a private route listed in either file
 * is an invitation to index a sign in screen.
 */

const SITE = 'https://votain.app';

describe('robots.txt', () => {
  it('keeps crawlers out of every route that needs a session', () => {
    const txt = robotsTxt(SITE);
    for (const prefix of PRIVATE_PREFIXES) {
      expect(txt).toContain(`Disallow: ${prefix}`);
    }
  });

  it('points at the sitemap with an absolute URL', () => {
    expect(robotsTxt(SITE)).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it('survives a site URL with a trailing slash', () => {
    // The value comes from an env var a person edits, so the obvious typo has
    // to produce the same file rather than "https://votain.app//sitemap.xml".
    expect(robotsTxt(`${SITE}/`)).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });
});

describe('sitemap.xml', () => {
  const xml = sitemapXml(SITE, '2026-09-03');

  it('declares the namespace a sitemap is validated against', () => {
    expect(xml).toContain('http://www.sitemaps.org/schemas/sitemap/0.9');
  });

  it('lists every public route once, absolutely', () => {
    for (const { path } of PUBLIC_ROUTES) {
      expect(xml).toContain(`<loc>${SITE}${path}</loc>`);
    }
    expect(xml.match(/<loc>/g)).toHaveLength(PUBLIC_ROUTES.length);
  });

  it('lists no route that needs a session', () => {
    for (const prefix of PRIVATE_PREFIXES) {
      expect(xml).not.toContain(prefix);
    }
  });

  it('never emits a doubled slash, whatever the site URL looks like', () => {
    const from = sitemapXml(`${SITE}/`, '2026-09-03');
    expect(from).not.toMatch(/<loc>https:\/\/[^<]*\/\/[^<]*<\/loc>/);
  });
});
