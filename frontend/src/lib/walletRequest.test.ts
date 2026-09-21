import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withReturnDeadline, WalletAnswerLostError } from './walletRequest';

/**
 * What a phone does to a wallet request, measured on a real one.
 *
 * Signing means leaving. The system freezes the page and tears down its relay
 * socket, and the wallet publishes its answer into a connection nobody holds.
 * On return the socket is rebuilt and resubscribed, and the relay sends back
 * nothing: that reply is gone. The promise never settles, and everything after
 * the await never runs.
 *
 * So the chain is asked instead. These pin the three answers it can give.
 */

/** Leaves the page for a while and comes back, as signing in another app does. */
function irseYVolver(fueraMs = 8_000) {
  const esconder = (hidden: boolean) => {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  esconder(true);
  vi.advanceTimersByTime(fueraMs);
  esconder(false);
}

/** A promise that models the lost answer: it never settles. */
const nuncaResponde = () => new Promise<string>(() => {});

describe('withReturnDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  afterEach(() => vi.useRealTimers());

  it('resolves with what the chain says, when the answer never came back', async () => {
    const pending = withReturnDeadline(nuncaResponde(), async () => 'landed');

    irseYVolver();
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(pending).resolves.toBe('landed');
  });

  /**
   * THE ASSERTION IS ATTACHED BEFORE THE CLOCK MOVES, and it has to be.
   *
   * These promises reject while the timers are being advanced. Asserting
   * afterwards still passes -- the rejection is there to be found -- but for
   * the instant between the rejection and the assertion nobody is listening,
   * and Node reports an unhandled rejection. Vitest counts those and exits
   * non-zero WITH EVERY TEST GREEN, which is a suite that looks perfect in a
   * terminal and fails in CI. Holding the assertion first gives the promise a
   * handler before it can reject.
   */
  it('reports the answer lost when the chain says it did not happen', async () => {
    const pending = withReturnDeadline(nuncaResponde(), async () => undefined);
    const perdida = expect(pending).rejects.toBeInstanceOf(WalletAnswerLostError);

    irseYVolver();
    await vi.advanceTimersByTimeAsync(6_000);

    await perdida;
  });

  /**
   * Without a chain to read there is no better answer to offer, so a deadline
   * can only invent a failure. It did: a tally waits on a 2048-bit key
   * derivation that runs in the tab, for as long as the device needs, and
   * cutting that short reported a lost wallet answer for a signature that had
   * arrived perfectly.
   */
  it('never second-guesses a request with nothing to check against', async () => {
    const pending = withReturnDeadline(nuncaResponde());
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });

    irseYVolver();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(settled).toBe(false);
  });

  it('reports the answer lost when the chain cannot be read either', async () => {
    const pending = withReturnDeadline(nuncaResponde(), async () => {
      throw new Error('RPC caido');
    });
    // Knowing nothing is what the error means, so a failed read lands here too.
    const perdida = expect(pending).rejects.toBeInstanceOf(WalletAnswerLostError);

    irseYVolver();
    await vi.advanceTimersByTimeAsync(6_000);

    await perdida;
  });

  it('leaves an answer that does arrive completely alone', async () => {
    const chain = vi.fn(async () => 'from chain');
    const pending = withReturnDeadline(Promise.resolve('from wallet'), chain);

    irseYVolver();
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(pending).resolves.toBe('from wallet');
    expect(chain).not.toHaveBeenCalled();
  });

  it('keeps a rejection from the wallet as the rejection it is', async () => {
    const declinado = new Error('user rejected');
    const pending = withReturnDeadline(Promise.reject(declinado), async () => 'landed');
    // Declining is an answer. Overriding it with a chain read would turn "no"
    // into "yes" for anything that happened to be true a moment earlier.
    const rechazo = expect(pending).rejects.toBe(declinado);

    irseYVolver();
    await vi.advanceTimersByTimeAsync(6_000);

    await rechazo;
  });

  it('waits as long as the page never left', async () => {
    const chain = vi.fn(async () => 'landed');
    const pending = withReturnDeadline(nuncaResponde(), chain);
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });

    // A minute of staring at the screen is not a lost answer.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(settled).toBe(false);
    expect(chain).not.toHaveBeenCalled();
  });
});
