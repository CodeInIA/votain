import { onReturnToForeground } from './foreground';

/**
 * How long to keep waiting after the page comes back, before reading the chain
 * instead.
 *
 * Only ever applies where there IS a chain to read, so this is not a deadline
 * on the wallet: it is how long a reply gets to arrive before a better answer
 * is fetched from somewhere that cannot lose it.
 */
const GRACE_AFTER_RETURN_MS = 6_000;

/**
 * The wallet answered, but nobody was there to hear it.
 *
 * Carries no claim about what happened on chain: the request may have been
 * approved, rejected, or never seen. Callers that can tell the difference do so
 * by reading the chain; the ones that cannot say exactly this and offer to try
 * again.
 */
export class WalletAnswerLostError extends Error {
  constructor() {
    super('The wallet answer was lost while the page was in the background');
    this.name = 'WalletAnswerLostError';
  }
}

/**
 * Makes a wallet request settle, whatever happens to the connection.
 *
 * THE PROBLEM THIS EXISTS FOR, measured rather than assumed. Signing on a phone
 * means leaving. The system freezes this page and tears down its relay socket;
 * the wallet does its part and publishes the answer into a connection nobody
 * holds. On return the socket is rebuilt and resubscribed, and the relay sends
 * back nothing: that reply is gone for good.
 *
 * The promise therefore never settles, and everything written after the `await`
 * never runs. It looked like several unrelated faults, one per screen, and it
 * was one: no success message, a modal that never closes, a button disabled for
 * the rest of the session, all while the transaction went through perfectly.
 *
 * So the wallet's reply is treated as what it is, a convenience. The chain is
 * the authority. `confirm` reads it and answers the only question that matters,
 * did this actually happen, and its answer is what resolves the promise.
 *
 * Without a `confirm` there is nothing to read, which is the honest case for a
 * plain signature: nothing landed anywhere, so the caller is told the answer was
 * lost and can offer to sign again. That is cheap and safe.
 */
export function withReturnDeadline<T>(
  work: Promise<T>,
  confirm?: () => Promise<T | undefined>,
): Promise<T> {
  // NOTHING TO READ, NOTHING TO SAY. Without a chain check there is no better
  // answer to offer, so second-guessing the wallet can only invent a failure,
  // and it did: a tally waits on a 2048-bit key derivation that runs here, in
  // this tab, for as long as the device needs. Measured on a phone, that is
  // far longer than any deadline worth setting, and killing it reported a lost
  // wallet answer for a signature that had arrived perfectly.
  if (!confirm) return work;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let stopWatching: () => void = () => {};

    const finish = (act: () => void) => {
      if (settled) return;
      settled = true;
      stopWatching();
      act();
    };

    // The happy path, and the only one on a desktop: the answer arrives.
    work.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    );

    stopWatching = onReturnToForeground(() => {
      setTimeout(async () => {
        if (settled) return;
        try {
          const landed = await confirm?.();
          // `undefined` is "it did not happen", which is not the same as an
          // error, and not the same as not knowing.
          if (landed !== undefined) {
            finish(() => resolve(landed));
            return;
          }
        } catch {
          // A chain read that fails leaves us knowing nothing, which is exactly
          // what the error below says.
        }
        finish(() => reject(new WalletAnswerLostError()));
      }, GRACE_AFTER_RETURN_MS);
    });
  });
}
