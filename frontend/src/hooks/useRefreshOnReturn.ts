import { useEffect, useRef } from 'react';
import { onReturnToForeground } from '../lib/foreground';

/**
 * Runs something when the page comes back to the foreground after a real
 * absence.
 *
 * On a phone, signing means LEAVING. The wallet app takes the screen, this page
 * is backgrounded, and the system drops the socket it was listening on. The
 * transaction then lands while nothing here is watching, so coming back shows
 * the state from before it was sent, and the only way out was a manual reload.
 *
 * Deliberately not tied to the request that caused the trip. Whatever happened
 * while the page was away, re-reading the chain on return is correct.
 */
export function useRefreshOnReturn(onReturn: () => void): void {
  const latest = useRef(onReturn);

  // Kept current through an effect rather than assigned during render: a render
  // may be discarded, and StrictMode runs two of them.
  useEffect(() => {
    latest.current = onReturn;
  });

  useEffect(() => onReturnToForeground(() => latest.current()), []);
}
