import { useCallback, useRef, useState } from 'react';

/**
 * Open state for a Radix Select that also closes when its trigger is tapped.
 *
 * THE PROBLEM. Radix opens the select on `pointerdown` for a mouse, but on a
 * touch or pen device it opens on `click` instead, and that handler only ever
 * opens: it does not toggle. Tapping the trigger while the list is open
 * therefore runs two things in order. The dismiss layer sees a pointer event
 * outside the content and closes it, then the trigger's own click reopens it.
 * What the user sees is a very fast closing animation followed by a list that is
 * still there, and no amount of tapping shuts it.
 *
 * THE FIX. Take control of the open state and ignore an opening that arrives
 * within a few frames of a close. A real reopen is a second deliberate tap,
 * which is far slower than the reflex this guards against, so nothing a person
 * can actually do is swallowed.
 *
 * Shared rather than duplicated: both `LanguageSelector` and `SelectMenu` are
 * Radix Selects and both had it.
 */

/**
 * How long after closing an open is treated as the same tap. Long enough to
 * cover the click that follows a pointerdown, short enough to sit far below a
 * deliberate second tap.
 */
const REOPEN_GUARD_MS = 300;

export function useTapSafeSelect(): {
  open: boolean;
  onOpenChange: (next: boolean) => void;
} {
  const [open, setOpen] = useState(false);
  const closedAt = useRef(0);

  const onOpenChange = useCallback((next: boolean) => {
    if (next && Date.now() - closedAt.current < REOPEN_GUARD_MS) return;
    if (!next) closedAt.current = Date.now();
    setOpen(next);
  }, []);

  return { open, onOpenChange };
}
