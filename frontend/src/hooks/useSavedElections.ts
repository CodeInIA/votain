import { useCallback, useEffect, useState } from 'react';
import {
  SAVED_CHANGED_EVENT,
  isSaved as readIsSaved,
  savedElectionIds,
  toggleSaved as writeToggle,
  type SavedRole,
} from '../lib/savedElections';
import { useAuth } from '../contexts/AuthContext';

/**
 * The saved set for the role being worn, kept in step across every reader.
 *
 * A card's bookmark, the filter chip and the list are three readers of one
 * fact. Each held its own copy from whenever it last rendered, so saving from a
 * card left the list it sits in showing the old answer until something else
 * happened to re-render it. The library announces a change and this listens,
 * which is one subscription rather than a context threaded through every list.
 *
 * THE ROLE DECIDES WHICH LIST. One person can hold both sessions, and an
 * election means different things to each of them, so `activeRole` picks the
 * list unless a screen that belongs to one role says which it is. A page for
 * the organizer's saved elections should not change what it shows because its
 * reader also happens to have a voter cookie.
 */
export function useSavedElections(role?: SavedRole): {
  ids: string[];
  role: SavedRole;
  isSaved: (electionId: string) => boolean;
  toggle: (electionId: string) => void;
} {
  const { activeRole } = useAuth();
  const mine: SavedRole = role ?? (activeRole === 'organizer' ? 'organizer' : 'voter');
  const [ids, setIds] = useState<string[]>(() => savedElectionIds(mine));

  useEffect(() => {
    const refresh = () => setIds(savedElectionIds(mine));
    refresh();
    window.addEventListener(SAVED_CHANGED_EVENT, refresh);
    // Another tab of the same app, which writes storage without firing the
    // custom event here.
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SAVED_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [mine]);

  const isSaved = useCallback(
    (electionId: string) => ids.includes(electionId.toLowerCase()) || readIsSaved(electionId, mine),
    [ids, mine],
  );

  const toggle = useCallback(
    (electionId: string) => {
      writeToggle(electionId, mine);
    },
    [mine],
  );

  return { ids, role: mine, isSaved, toggle };
}
