import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * A block of text that keeps its first few lines and hides the rest behind a
 * toggle.
 *
 * An election description runs to two thousand characters, and all of it sat
 * between the title and everything a reader had actually come for: the
 * requirements, the candidates, the deadline. A long one pushed the rest of the
 * page off the bottom of the screen, so the price of a thorough organizer was
 * paid by every voter scrolling past.
 *
 * The toggle appears ONLY when there is something hidden. Measuring rather than
 * counting characters is what makes that honest: whether a description overflows
 * four lines depends on the font, the language and the width of the window, and
 * a character threshold would offer "show more" on text that was already whole
 * and withhold it from text that was not.
 */
interface Props {
  text: string;
  /** Lines kept while collapsed. */
  lines?: number;
  className?: string;
}

export function ExpandableText({ text, lines = 4, className }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Measured after layout, and again whenever the text or the width changes.
  // `ResizeObserver` covers the window being resized; the direct call covers the
  // first paint, which is the case that matters and the one an observer that
  // never fires would miss.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      // One pixel of tolerance: sub-pixel line heights make an exactly-fitting
      // paragraph report a scrollHeight a fraction taller than its box.
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, lines, expanded]);

  return (
    <div className={className}>
      <p
        ref={ref}
        className="text-sm text-on-surface-variant leading-relaxed break-words whitespace-pre-line"
        style={
          expanded
            ? undefined
            : {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: lines,
                overflow: 'hidden',
              }
        }
      >
        {text}
      </p>

      {/* Rendered while expanded too, or the reader would have no way back and
          the button would have made the problem it solves permanent. */}
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className={cn(
            'mt-2 inline-flex items-center gap-1 text-xs font-semibold',
            'text-primary hover:text-primary-dim transition-colors cursor-pointer',
          )}
        >
          {expanded ? t('common.show_less') : t('common.show_more')}
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}
