/**
 * Whether this person wants their pattern where the profile glyph normally is.
 *
 * OFF BY DEFAULT, and that is a decision rather than caution. A button drawing a
 * coloured pattern is not obviously the way to your own account: the glyph says
 * "you" to somebody who has never seen this app, and the pattern only says it
 * once you know what it is. So the pattern is introduced in the profile, beside
 * a sentence explaining where it comes from, and moves to the top bar only if
 * asked for.
 *
 * AN OBSERVABLE STORE rather than a plain read, because the switch lives on the
 * profile and what it changes is two floors up. Reading `localStorage` at render
 * would leave the top bar showing the old icon until something else happened to
 * re-render it, and the one moment this setting is looked at is the moment it is
 * flipped. `useSyncExternalStore` is what React offers for state that lives
 * outside it, and `DatePicker` already uses it here for the same reason.
 *
 * Per browser, not per account: it is a preference about an icon, it never
 * leaves the device, and there is nothing to synchronise.
 */
import { useSyncExternalStore } from "react";

const KEY = "votain_avatar_icon";
const CHANGED = "votain:avatar-preference";

const listeners = new Set<() => void>();

export function avatarAsProfileIcon(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    // A browser with storage blocked still gets an app, and it gets the glyph.
    return false;
  }
}

export function setAvatarAsProfileIcon(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "true");
    else localStorage.removeItem(KEY);
  } catch {
    // Nothing to persist to, but the session can still honour the choice.
  }
  for (const notify of listeners) notify();
  // Other tabs of the same app, which `storage` would not reach in this one.
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  // `storage` fires in the OTHER tabs; the event above covers this one.
  window.addEventListener("storage", notify);
  window.addEventListener(CHANGED, notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
    window.removeEventListener(CHANGED, notify);
  };
}

/** Live: flipping the switch repaints the top bar and the header at once. */
export function useAvatarAsProfileIcon(): boolean {
  return useSyncExternalStore(subscribe, avatarAsProfileIcon, () => false);
}
