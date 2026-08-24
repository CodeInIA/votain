/**
 * The organizer's verified domain, shown where the voter decides whether to
 * trust an election.
 *
 * It shows the DOMAIN, never a generic checkmark. A checkmark is an opaque
 * claim that only means something if you trust whoever granted it. A domain
 * explains itself and can be re-checked by anyone, which is the only kind of
 * trust signal that belongs in a system whose whole premise is that you do not
 * have to take our word for anything.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, ExternalLink } from 'lucide-react';
import { checkElectionDomain, type DomainStatus } from '../../lib/organizerDomains';

export function DomainBadge({
  domain,
  organizerAddress,
  showCheckLink = false,
}: {
  domain?: string;
  organizerAddress: string;
  /** Offers the voter an independent lookup. Detail pages only. */
  showCheckLink?: boolean;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DomainStatus | 'checking'>('checking');

  useEffect(() => {
    if (!domain) return;
    let cancelled = false;
    void (async () => {
      const result = await checkElectionDomain(organizerAddress, domain);
      if (!cancelled) setStatus(result.status);
    })();
    return () => { cancelled = true; };
  }, [domain, organizerAddress]);

  // No domain is the normal case, not a warning. Most organizers are people and
  // small associations that will never own one, and making their elections look
  // deficient would only pressure them into faking it.
  if (!domain) return null;

  // A failed lookup says nothing about the domain, so it must never strike the
  // badge: that would punish an election whose DNS is perfectly fine.
  const lapsed = status === 'no_record' || status === 'address_mismatch';

  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        className={
          lapsed
            ? 'inline-flex items-center gap-1 text-on-surface-meta line-through decoration-error/60'
            : 'inline-flex items-center gap-1 text-primary-dim'
        }
        title={lapsed ? t('domain.lapsed_hint') : t('domain.verified_hint')}
      >
        <Globe className="w-3 h-3 shrink-0" />
        {domain}
      </span>

      {lapsed && <span className="text-on-surface-meta">{t('domain.lapsed')}</span>}

      {showCheckLink && (
        // Checking through a public DoH resolver rather than the organization's
        // own server: the voter can confirm the record without telling the
        // organization that anyone is reading their election.
        <a
          href={`https://dns.google/query?name=_votain.${encodeURIComponent(domain)}&type=TXT`}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-on-surface-meta hover:text-on-surface underline underline-offset-2"
        >
          {t('domain.check_yourself')}
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      )}
    </span>
  );
}
