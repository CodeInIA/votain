import { useTranslation } from 'react-i18next';
import { ExternalLink, ShieldCheck, Globe } from 'lucide-react';
import { cn } from '../../lib/utils';

interface BlockchainBadgeProps {
  href?: string;
  className?: string;
}

export function BlockchainBadge({ href, className }: BlockchainBadgeProps) {
  const { t } = useTranslation();
  const content = (
    <>
      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
      <span>{t('election.verified_on_chain')}</span>
      {href && <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
          'bg-primary/10 text-primary-dim ring-1 ring-primary/20',
          'hover:bg-primary/20 transition-colors',
          className
        )}
      >
        {content}
      </a>
    );
  }
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
      'bg-primary/10 text-primary-dim ring-1 ring-primary/20',
      className
    )}>
      {content}
    </span>
  );
}

interface IPFSBadgeProps {
  href?: string;
  className?: string;
}

export function IPFSBadge({ href, className }: IPFSBadgeProps) {
  const content = (
    <>
      <Globe className="w-3.5 h-3.5 shrink-0" />
      <span>Hosted on IPFS</span>
      {href && <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
          'bg-tertiary/10 text-tertiary ring-1 ring-tertiary/20',
          'hover:bg-tertiary/20 transition-colors',
          className
        )}
      >
        {content}
      </a>
    );
  }
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
      'bg-tertiary/10 text-tertiary ring-1 ring-tertiary/20',
      className
    )}>
      {content}
    </span>
  );
}
