/**
 * A page limit for a list that is already in hand.
 *
 * THE OTHER HALF OF THE PAGINATION, and the distinction matters. Discover pages
 * what it READS, because it shows everyone's elections and there is no bound on
 * how many that is; `useElectionPages` does that. The rest of the lists are
 * about one person: the elections you created, the ones you enrolled in, the
 * members of your own election. Those are read completely on purpose, because
 * the screens add them up, and a dashboard that reports "1,204 enrolled" over
 * the first page only is a wrong number that looks right.
 *
 * What those screens still need is a bound on what they DRAW, which is this: a
 * thousand cards is a slow page and an unreadable one whether or not the data
 * was already there.
 *
 * Narrowing the list resets it. Someone who pages through to the end, then picks
 * a different tab, is starting a different list, and leaving the limit where it
 * was would silently show them a hundred rows of it.
 */
import { useState } from 'react';

export const DEFAULT_PAGE_SIZE = 12;

export interface PageLimitState<T> {
  visible: T[];
  hasMore: boolean;
  loadMore: () => void;
}

export function usePageLimit<T>(
  items: T[],
  pageSize: number = DEFAULT_PAGE_SIZE,
  /** What the list is OF. Changing it starts again from the first page. */
  resetKey?: string,
): PageLimitState<T> {
  const [want, setWant] = useState(pageSize);

  // Back to the first page when the list becomes a different list. Set during
  // render rather than in an effect, so the first render of the new list is
  // already the right length instead of flashing the old length for a frame.
  const [shownFor, setShownFor] = useState({ resetKey, pageSize });
  if (shownFor.resetKey !== resetKey || shownFor.pageSize !== pageSize) {
    setShownFor({ resetKey, pageSize });
    setWant(pageSize);
  }

  return {
    visible: items.slice(0, want),
    hasMore: items.length > want,
    loadMore: () => setWant(w => w + pageSize),
  };
}
