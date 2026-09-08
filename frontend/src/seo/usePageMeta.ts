/**
 * Per-page title, description and canonical, for a single-page app.
 *
 * Every route rendered the same `<title>Votain</title>`, so a search result, a
 * browser tab and a bookmark all said "Votain" whether they pointed at the
 * privacy policy or at one election. Crawlers render this app's JavaScript, so
 * setting these from the page that knows the answer is enough; nothing here
 * needs server rendering.
 *
 * Titles are passed in already translated, because every public page already
 * has one in the locale files. A second set of SEO-only strings would be
 * thirteen more translations that could disagree with the heading above them.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { PRIVATE_PREFIXES } from './publicRoutes';

const SITE_NAME = 'Votain';
const SITE_URL = (import.meta.env.VITE_PUBLIC_URL ?? '').replace(/\/+$/, '');

function setMeta(selector: string, attr: 'name' | 'property', key: string, content: string): void {
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

interface PageMeta {
  /** Already translated, and without the site name: this adds it. */
  title?: string;
  description?: string;
}

/**
 * The description shipped in `index.html`, captured before anything overwrites
 * it. A page that sets no description of its own has to restore this one:
 * leaving the previous page's behind meant the terms page described how the
 * protocol works, because that is where the reader happened to come from.
 */
const DEFAULT_DESCRIPTION =
  document.head.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? '';

export function usePageMeta({ title, description }: PageMeta): void {
  useEffect(() => {
    // The landing page is the site, so "Votain, Votain" would be silly.
    const full = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
    document.title = full;
    setMeta('meta[property="og:title"]', 'property', 'og:title', full);

    const text = description || DEFAULT_DESCRIPTION;
    setMeta('meta[name="description"]', 'name', 'description', text);
    setMeta('meta[property="og:description"]', 'property', 'og:description', text);
  }, [title, description]);
}

/**
 * Canonical URL and indexability, set once for whatever route is showing.
 *
 * The `noindex` half matters more than the canonical: `robots.txt` asks a
 * crawler not to fetch the private routes, and a crawler that ignores it, or
 * one that found the URL elsewhere, is told again in the page it actually
 * loaded. Both say the same thing, and neither is a security boundary.
 */
export function useRouteMeta(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    const isPrivate = PRIVATE_PREFIXES.some(prefix => pathname.startsWith(prefix));

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = `${SITE_URL}${pathname}`;

    setMeta(
      'meta[name="robots"]',
      'name',
      'robots',
      isPrivate ? 'noindex, nofollow' : 'index, follow',
    );
    setMeta('meta[property="og:url"]', 'property', 'og:url', `${SITE_URL}${pathname}`);
  }, [pathname]);
}
