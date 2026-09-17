import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * "Clear filters", the control itself, with no opinion about what it clears.
 *
 * TWO LISTS HAD THEIR OWN, and they had drifted: the election lists drew a
 * cross and a semibold label, the gas history a bare blue word on the left of
 * its card. Same words, same job, two different things to look for, which is
 * the state this project keeps ending up in whenever a control is written
 * twice rather than shared once.
 *
 * The filter STATE is not shared, and could not be: elections are narrowed by
 * phase and eligibility, transactions by kind and date. What is shared is the
 * appearance and the place it goes, which is the part a reader learns.
 */
export function ClearFiltersButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline cursor-pointer',
        className,
      )}
    >
      <X className="w-3.5 h-3.5 shrink-0" />
      {t('common.clear_filters')}
    </button>
  );
}
