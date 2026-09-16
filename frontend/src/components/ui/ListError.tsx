import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../lib/utils';

interface ListErrorProps {
  onRetry: () => void;
  className?: string;
}

/**
 * A list that could not be read, said out loud.
 *
 * WHY THIS EXISTS. When the chain read failed, the pages fell through to their
 * empty state: "no elections found", with a load-more button underneath that
 * would fail the same way. Two different things were being reported with one
 * sentence, and the wrong one. "There is nothing here" is a fact about the
 * world; "this could not be read" is a fact about the connection, and only the
 * second one is worth pressing a button about.
 *
 * It was reachable for an ordinary reason too: an interface reading a contract
 * that has since been redeployed with a different shape gets a revert on every
 * election, and every screen went quietly empty.
 */
export function ListError({ onRetry, className }: ListErrorProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn('flex flex-col items-center justify-center py-16 text-center', className)}
      role="alert"
    >
      <AlertTriangle className="w-8 h-8 text-warning mb-3" />
      <h2 className="text-base font-semibold text-on-surface mb-1">{t('errors.generic_title')}</h2>
      <p className="text-sm text-on-surface-variant max-w-sm">{t('errors.list_unreadable')}</p>
      <Button variant="default" className="mt-4 rounded-full px-5" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
