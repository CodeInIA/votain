import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { cn } from '../../lib/utils';

interface BackButtonProps {
  /** Defaults to history back (navigate(-1)). */
  onClick?: () => void;
  className?: string;
}

export function BackButton({ onClick, className }: BackButtonProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onClick ?? (() => navigate(-1))}
      className={cn(
        'flex items-center gap-1.5 text-sm text-on-surface-meta hover:text-on-surface transition-colors cursor-pointer',
        className
      )}
    >
      <ChevronLeft className="w-4 h-4" />
      {t('common.back')}
    </button>
  );
}
