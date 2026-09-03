/**
 * The site links, in one list.
 *
 * The footer carries four: how it works, terms, privacy and the receipt
 * verifier. It is hidden below `md:`, so both profiles reproduced it as a card,
 * and both copies had three. Two copies of a list is how a list loses an entry.
 *
 * In a `.ts` beside the component that renders it, because a file exporting
 * both a constant and a component breaks fast refresh.
 */
import { FileText, Info, SearchCheck, Shield, type LucideIcon } from 'lucide-react';

export interface SiteLink {
  to: string;
  labelKey: string;
  /** Only the card shows icons; the footer is a row of text. */
  icon: LucideIcon;
}

export const SITE_LINKS: readonly SiteLink[] = [
  { to: '/how-it-works', labelKey: 'nav.how_it_works', icon: Info },
  { to: '/terms', labelKey: 'landing.footer.terms', icon: FileText },
  { to: '/privacy', labelKey: 'landing.footer.privacy', icon: Shield },
  // A magnifier rather than a second shield: privacy sits right above it, and
  // two shields in a column read as one entry split in two.
  { to: '/verify-receipt', labelKey: 'nav.verify', icon: SearchCheck },
];
