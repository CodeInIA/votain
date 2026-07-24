import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import { isChainConfigured } from '../../lib/deployments';

/**
 * Makes it unmistakable when the UI is showing local sample data instead of
 * real on-chain state. Rendered whenever no contract addresses are configured.
 *
 * Silent fallbacks are dangerous: without this, seed elections look identical
 * to real ones. If you can see this banner, nothing on screen came from a chain.
 */
export function DemoDataBanner() {
  const { t } = useTranslation();
  if (isChainConfigured()) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold
                 bg-warning/15 text-warning border-b border-warning/25"
    >
      <FlaskConical className="w-3.5 h-3.5 shrink-0" />
      <span>{t('demo.banner')}</span>
    </div>
  );
}
