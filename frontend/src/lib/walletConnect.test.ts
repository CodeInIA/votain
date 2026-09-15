import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Rules about the WalletConnect provider that are invisible until they break,
 * and that break in ways which look like something else entirely.
 */

const { initCalls, state } = vi.hoisted(() => ({
  initCalls: [] as Array<Record<string, unknown>>,
  /**
   * What a freshly built provider looks like: whether it holds a wallet
   * session, and whether its relay socket has finished coming up. These are
   * independent, which is the point of one of the tests below.
   */
  state: {
    session: true,
    socket: true,
    /** How many times the provider was asked to close its modal. */
    cerrado: 0,
    /** Whether the relay socket survived the trip to the wallet app. */
    socketVivo: false,
    /** Topics the mailbox was asked about, or -1 if it never was. */
    buzonPedido: -1,
    /** How many times the relay socket was put back together. */
    reconectado: 0,
    /** The modal's own state subscriber, so a test can drive it. */
    avisar: undefined as undefined | ((s: { open?: boolean }) => void),
  },
}));

vi.mock('@walletconnect/ethereum-provider', () => ({
  EthereumProvider: {
    init: async (options: Record<string, unknown>) => {
      initCalls.push(options);
      const p: Record<string, unknown> = {
        // The real getter reads signer.client.core.relayer.connected.
        connected: state.socket,
        session: state.session ? {} : undefined,
        request: async () => undefined,
        connect: async () => {
          p.session = {};
        },
        disconnect: async () => undefined,
        signer: {
          client: {
            core: {
              relayer: {
                get connected() { return state.socketVivo; },
                restartTransport: async () => { state.reconectado += 1; },
                subscriber: {
                  values: [{ topic: 't1', relay: { protocol: 'irn' } }],
                  batchFetchMessages: async (subs: unknown[]) => {
                    state.buzonPedido = subs.length;
                  },
                },
              },
            },
          },
        },
        modal: {
          close: () => { state.cerrado += 1; },
          subscribeState: (cb: (s: { open?: boolean }) => void) => { state.avisar = cb; },
        },
      };
      return p;
    },
  },
}));

/** Leaves the page for a while and comes back, as signing in another app does. */
function volver(fueraMs = 8_000) {
  const esconder = (hidden: boolean) => {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  esconder(true);
  vi.advanceTimersByTime(fueraMs);
  esconder(false);
}

describe('WalletConnect provider configuration', () => {
  beforeEach(() => {
    initCalls.length = 0;
    state.session = true;
    state.socket = true;
    state.cerrado = 0;
    state.avisar = undefined;
    state.reconectado = 0;
    state.buzonPedido = -1;
    state.socketVivo = false;
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    vi.resetModules();
    // Read at module scope, so it has to be in place before the import.
    vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', 'test-project');
  });

  // Before `vi.resetModules()` hands the next test a fresh module. The live
  // one still owns a visibilitychange listener, and a discarded module cannot
  // be asked to let go of it afterwards: without this they pile up on the
  // document and every one of them answers the next return to the foreground.
  afterEach(async () => {
    const { resetWalletConnect } = await import('./walletConnect');
    resetWalletConnect();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  /**
   * Where the READS go. Only the signing methods reach the wallet:
   * eth_sendTransaction, personal_sign, eth_signTypedData* and the wallet_*
   * family. Everything else the provider answers itself over HTTP, and with no
   * rpcMap it uses rpc.walletconnect.org, which serves public chains only.
   *
   * ethers estimates gas and reads a nonce before it sends anything, so on a
   * chain that endpoint does not serve, the reads failed, the transaction was
   * never built, and eth_sendTransaction was never sent: the wallet came
   * forward with nothing to show, and it looked like a wallet ignoring a
   * request that had never left the page.
   */
  it('resolves reads through this app own RPC, not the public default', async () => {
    const { restoreWalletConnect } = await import('./walletConnect');
    const { chainInfo } = await import('./deployments');

    await restoreWalletConnect();

    expect(initCalls).toHaveLength(1);
    expect(initCalls[0].rpcMap).toEqual({ [chainInfo.chainId]: chainInfo.rpcUrl });
  });

  it('keeps the target chain optional so an unknown one can still pair', async () => {
    const { restoreWalletConnect } = await import('./walletConnect');
    const { chainInfo } = await import('./deployments');

    await restoreWalletConnect();

    // A required chain makes a wallet that lacks it refuse the session, and
    // then there is no session left to ask it to add the chain over. The
    // official example passes optionalChains alone.
    expect(initCalls[0].chains).toBeUndefined();
    expect(initCalls[0].optionalChains).toEqual([chainInfo.chainId]);
  });

  /**
   * ONE CORE PER PAGE. A second one opens its own relay client over the same
   * storage, and the pairing splits between them: the QR belongs to one, the
   * wallet approval is delivered to the other, which has no such proposal. The
   * console says "No matching key. proposal", and the person sees a QR they
   * scanned, approved, and which never closed.
   *
   * This is the exact sequence that did it on a browser with no extension:
   * restore first, find no session, then pair.
   */
  it('builds one Core across a failed restore and the pairing after it', async () => {
    state.session = false;
    const { restoreWalletConnect, connectWalletConnect } = await import('./walletConnect');

    expect(await restoreWalletConnect()).toBeUndefined();
    await connectWalletConnect();

    expect(initCalls).toHaveLength(1);
  });

  /**
   * The provider's "connected" reads the relay WEBSOCKET, not the wallet
   * session. Requiring it as well as a session made a restored session look
   * dead while the socket was still coming up, so the app started a pairing it
   * did not need, and a pairing opens the modal before it has a URI to put in
   * it: an empty QR code over a dashboard that is already signed in.
   */
  it('restores a session whose relay socket is still coming up', async () => {
    state.session = true;
    state.socket = false;
    const { restoreWalletConnect } = await import('./walletConnect');

    expect(await restoreWalletConnect()).toBeDefined();
  });

  /**
   * The modal carries a pairing and nothing else. The SDK closes it when
   * `connect` settles, and then, measured, about 200ms later and after this app
   * has navigated away, AppKit sets it open again: an empty frame over the
   * dashboard that never goes. Nothing here asks for it, so rather than race
   * that reopen, the invariant is stated and held.
   */
  it('closes the modal if it opens once a session exists', async () => {
    const { restoreWalletConnect } = await import('./walletConnect');
    await restoreWalletConnect();

    state.avisar?.({ open: true });

    expect(state.cerrado).toBe(1);
  });

  it('leaves the modal alone while it is still carrying a pairing', async () => {
    state.session = false;
    const { restoreWalletConnect } = await import('./walletConnect');
    await restoreWalletConnect();

    // This is the QR on screen: no session yet, so it must not be touched.
    state.avisar?.({ open: true });

    expect(state.cerrado).toBe(0);
  });

  /**
   * The root of the family. Signing on a phone means leaving, and the system
   * tears down the relay socket the page was waiting on: the wallet's answer
   * arrives at a connection nobody holds, so the promise never settles and
   * nothing written after that await ever runs.
   *
   * The SDK listens to no lifecycle event, so nothing tells it the page is
   * back. This is what does.
   */
  it('puts the relay socket back together on returning to the foreground', async () => {
    const { restoreWalletConnect } = await import('./walletConnect');
    await restoreWalletConnect();

    volver();

    expect(state.reconectado).toBe(1);
  });

  it('ignores a glance away, which never dropped anything', async () => {
    const { restoreWalletConnect } = await import('./walletConnect');
    await restoreWalletConnect();

    volver(300);

    expect(state.reconectado).toBe(0);
  });

  /**
   * The relay holds an undelivered message until its TTL, and
   * `irn_batchFetchMessages` is how a client collects what is waiting. The SDK
   * implements it and calls it from nowhere: the method carries a `@ts-ignore`
   * because it is unused, so a reconnect resubscribes and never asks for what
   * it missed. This is the difference between recovering the wallet's real
   * answer and having to infer the outcome from the chain.
   */
  it('asks the mailbox for what was missed, after reconnecting', async () => {
    const { restoreWalletConnect } = await import('./walletConnect');
    await restoreWalletConnect();

    volver();
    await vi.advanceTimersByTimeAsync(0);

    expect(state.reconectado).toBe(1);
    expect(state.buzonPedido).toBe(1);
  });

  /**
   * Rebuilding a socket that still works cannot help, and it can lose things:
   * `restartTransport` closes the connection, so anything the relay was about
   * to deliver on it goes with it, and that is exactly the answer being waited
   * for. The mailbox is still asked either way, which costs nothing.
   */
  it('leaves a socket that survived the trip alone', async () => {
    state.socketVivo = true;
    const { restoreWalletConnect } = await import('./walletConnect');
    await restoreWalletConnect();

    volver();
    await vi.advanceTimersByTimeAsync(0);

    expect(state.reconectado).toBe(0);
    expect(state.buzonPedido).toBe(1);
  });

  /**
   * The redirect tells the wallet where to send somebody back to once they have
   * approved, and it is what makes a signature survive the trip on a phone.
   *
   * It belongs to the SESSION, not to a request, so one declaration covers
   * every one of them: a deposit, a lifecycle call, the tally signature, and
   * switching or adding a network.
   *
   * A desktop pairing must not declare it. There the wallet is on somebody
   * else's phone, and sending that phone to this page opens a second copy of
   * the app on the wrong screen.
   */
  it('does not send a desktop pairing anywhere, since the wallet is elsewhere', async () => {
    const { restoreWalletConnect } = await import('./walletConnect');
    await restoreWalletConnect();

    // jsdom reports a desktop user agent.
    const metadata = initCalls[0].metadata as { redirect?: unknown };
    expect(metadata.redirect).toBeUndefined();
  });

  it('builds a fresh one after a reset, which is what a failed pairing wants', async () => {
    state.session = false;
    const { restoreWalletConnect, resetWalletConnect } = await import('./walletConnect');

    await restoreWalletConnect();
    resetWalletConnect();
    await restoreWalletConnect();

    expect(initCalls).toHaveLength(2);
  });
});
