import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { filterFromSearchParams, filterToSearchParams } from '../lib/electionFilterParams';
import type { ElectionFilterState } from '../lib/electionFilter';

/**
 * The filter state of a list, held in the address bar.
 *
 * Drop-in for the `useState(EMPTY_FILTERS)` both lists used to have, which is
 * the point: the pages keep passing a value and a setter to `ElectionFilters`
 * and nothing else about them changes.
 *
 * REPLACE AND NOT PUSH. Every keystroke in the search box is a change, and
 * pushing each one would bury the page the reader came from under a history
 * entry per letter: leaving would mean pressing back once for every character
 * typed. Replacing keeps one entry for the list, holding whatever was set
 * when they left it, which is exactly what back should bring them home to.
 *
 * Parsed on every render rather than mirrored into state. The URL is the one
 * copy, so there is no second copy to fall out of step with it when the
 * reader presses back, edits the address bar or opens a link somebody sent
 * them.
 */
export function useElectionFilterParams(): [
  ElectionFilterState,
  (next: ElectionFilterState) => void,
] {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => filterFromSearchParams(params), [params]);

  const setFilters = useCallback(
    (next: ElectionFilterState) => {
      setParams(filterToSearchParams(next), { replace: true });
    },
    [setParams],
  );

  return [filters, setFilters];
}
