import { useCallback, useEffect, useState } from 'react';
import {
  SAVED_CHANGED_EVENT,
  isSaved as readIsSaved,
  savedElectionIds,
  toggleSaved as writeToggle,
} from '../lib/savedElections';

/**
 * The saved set, kept in step across every component that reads it.
 *
 * A card's star, the filter chip and the list are three readers of one fact.
 * Each held its own copy from whenever it last rendered, so saving from a card
 * left the list it sits in showing the old answer until something else
 * happened to re-render it. The library announces a change and this listens,
 * which is one subscription rather than a context threaded through every list.
 */
export function useSavedElections(): {
  ids: string[];
  isSaved: (electionId: string) => boolean;
  toggle: (electionId: string) => void;
} {
  const [ids, setIds] = useState<string[]>(() => savedElectionIds());

  useEffect(() => {
    const refresh = () => setIds(savedElectionIds());
    window.addEventListener(SAVED_CHANGED_EVENT, refresh);
    // Another tab of the same app, which writes storage without firing the
    // custom event here.
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SAVED_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const isSaved = useCallback(
    (electionId: string) => ids.includes(electionId.toLowerCase()) || readIsSaved(electionId),
    [ids],
  );

  const toggle = useCallback((electionId: string) => {
    writeToggle(electionId);
  }, []);

  return { ids, isSaved, toggle };
}
