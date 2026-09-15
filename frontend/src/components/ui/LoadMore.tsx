import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { cn } from '../../lib/utils';

interface LoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
  className?: string;
}

/**
 * The end of a list that has not ended.
 *
 * A BUTTON AND NOT AN INFINITE SCROLL, which was the alternative. Scroll-to-load
 * takes the decision away from the reader: it keeps hydrating elections because
 * a finger moved, it makes the footer unreachable, and on a phone paying for
 * data that is the wrong default. A button asks.
 *
 * Rendering nothing when there is no more is the point: an always-present
 * control that sometimes does nothing is how a list stops telling you whether
 * you have reached the bottom of it.
 */
export function LoadMore({ hasMore, loading, onClick, className }: LoadMoreProps) {
  const { t } = useTranslation();
  if (!hasMore) return null;

  return (
    <div className={cn('flex justify-center pt-6', className)}>
      <Button
        variant="default"
        size="sm"
        onClick={onClick}
        disabled={loading}
        className="px-6"
        // The label is replaced by a spinner while a page is on its way, and a
        // spinner says nothing out loud. This is what a screen reader announces
        // in its place.
        aria-busy={loading}
      >
        {loading ? <Spinner size="sm" /> : t('common.load_more')}
      </Button>
    </div>
  );
}
