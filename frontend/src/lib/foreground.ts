/**
 * How long away counts as having left.
 *
 * `visibilitychange` also fires for a glance at the notification shade or a
 * quick app switch, and acting on every flicker is its own kind of rude.
 * Signing in another app always takes longer than this.
 */
const AWAY_ENOUGH_MS = 1_500;

/**
 * Runs something when the page comes back to the foreground after a real
 * absence, and returns the way to stop listening.
 *
 * Deliberately not a hook. Two layers need this and only one of them is React:
 * the screens refresh what they are drawing, and the WalletConnect provider
 * puts its relay socket back together. Defining "came back" twice would let the
 * two drift apart.
 */
export function onReturnToForeground(run: () => void): () => void {
  if (typeof document === "undefined") return () => {};

  let leftAt: number | undefined;

  const onVisibility = () => {
    if (document.hidden) {
      leftAt = Date.now();
      return;
    }
    const since = leftAt;
    leftAt = undefined;
    if (since !== undefined && Date.now() - since >= AWAY_ENOUGH_MS) run();
  };

  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
}
