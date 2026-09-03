/**
 * The footer's links as a card, for the screens where the footer is hidden.
 *
 * The verifier was missing from the organizer's copy, which is the worst one to
 * lose: it takes no session and checks anybody's vote, so on a phone an
 * organizer had no way to it but to guess the URL. Reading `SITE_LINKS` rather
 * than listing them again is what stops the next link going the same way.
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { SITE_LINKS } from './siteLinks';

interface Props {
  /**
   * Routes the page already links to elsewhere, so the card does not offer a
   * second way to the same place. The voter profile links the verifier from its
   * own quick actions, which are visible at every width.
   */
  omit?: readonly string[];
}

export function SiteLinksCard({ omit = [] }: Props) {
  const { t } = useTranslation();
  const links = SITE_LINKS.filter(link => !omit.includes(link.to));

  return (
    <Card className="p-2 mb-4 md:hidden">
      {links.map(({ to, labelKey, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-colors text-sm text-on-surface-variant hover:text-on-surface"
        >
          <Icon className="w-4 h-4 shrink-0" />
          {t(labelKey)}
        </Link>
      ))}
    </Card>
  );
}
