/**
 * Organizer wallet connection (injected EOA: MetaMask or compatible).
 *
 * Separation of concerns:
 *   - The **passkey** authenticates the organizer (session identity).
 *   - The **wallet** authorises on-chain writes (signing).
 *
 * So the wallet address is remembered across sessions: read-only screens
 * (dashboard, members, gas balance) only need to know *which* address the
 * organizer is, and can render from RPC without an active wallet connection.
 * A live connection is requested lazily, the first time something must be signed.
 *
 * The stored address is a public identifier, never a credential: it grants no
 * ability to act. Every write still needs a wallet signature and passes the
 * contracts' `onlyOrganizer` check.
 */
import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, type Eip1193Provider, type JsonRpcSigner } from "ethers";
import { chainInfo } from "../lib/deployments";
import {
  connectWalletConnect,
  hasLiveWalletConnectSession,
  isWalletConnectConfigured,
  addChainOverSession,
  openWalletApp,
  restoreWalletConnect,
  sessionSupportsChain,
} from "../lib/walletConnect";
import i18n from "../i18n/config";
import { withReturnDeadline } from "../lib/walletRequest";
import { isUserRejection } from "../lib/walletErrors";

const REMEMBERED_ADDRESS_KEY = "votain_organizer_address";

/**
 * Announced when the wallet ends the session from its own side.
 *
 * `AuthProvider` listens. This hook could not call it directly without importing
 * the session into the wallet, and the session cannot watch the wallet without
 * polling it, so the fact travels as an event and each side keeps its own job.
 */
export const WALLET_DISCONNECTED_EVENT = "votain:wallet-disconnected";

export function getRememberedOrganizerAddress(): string | undefined {
  return localStorage.getItem(REMEMBERED_ADDRESS_KEY) ?? undefined;
}

export function forgetOrganizerAddress(): void {
  localStorage.removeItem(REMEMBERED_ADDRESS_KEY);
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & {
      on?: (event: string, cb: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
    };
  }
}

/** Params passed to wallet_addEthereumChain, derived from the configured chain. */
/**
 * How long to wait for a wallet to answer a request to ADD a network.
 *
 * Long enough to switch apps, find the prompt and approve it; short enough that
 * a wallet which never shows one stops being indistinguishable from a frozen
 * page.
 */
const ADD_CHAIN_TIMEOUT_MS = 45_000;

/** Rejects with the caller's error if the promise has not settled in time. */
async function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const CHAIN_PARAMS = {
  chainId: "0x" + chainInfo.chainId.toString(16),
  chainName: chainInfo.name,
  nativeCurrency: { name: chainInfo.currency, symbol: chainInfo.currency, decimals: 18 },
  rpcUrls: [chainInfo.rpcUrl],
  ...(chainInfo.explorer ? { blockExplorerUrls: [chainInfo.explorer] } : {}),
};

/**
 * The provider currently in play.
 *
 * An extension injects one and every call can just use it. Without an
 * extension there is nothing until a WalletConnect session exists, and once
 * it does every later call has to use THAT one: reading the chain from
 * `window.ethereum` while signing through WalletConnect is how an app ends up
 * checking one wallet and transacting with another.
 */
let session: Eip1193Provider | undefined;

function activeProvider(): Eip1193Provider | undefined {
  if (session) return session;
  return typeof window !== "undefined" ? window.ethereum : undefined;
}

/**
 * The provider, reopening a WalletConnect session if that is what is missing.
 *
 * `session` is a module variable, so a reload empties it while the remembered
 * address stays in local storage. On a desktop the difference never shows,
 * because the extension injects itself on every load. On a phone there is
 * nothing to inject, so every action that needed to sign failed with "no
 * wallet" until the person happened to press something that called
 * `connect()` again.
 *
 * `EthereumProvider.init` restores a session the wallet still holds, so this
 * is normally silent: no QR, no pairing, no second approval.
 */
async function resumeProvider(): Promise<Eip1193Provider | undefined> {
  const existing = activeProvider();
  if (existing) return existing;
  if (!isWalletConnectConfigured()) return undefined;

  // Restore only. A check that runs on its own must never put a QR code in
  // front of somebody who did not ask for one.
  session = await restoreWalletConnect();
  return session;
}
interface OrganizerWalletState {
  address: string | undefined;
  wrongNetwork: boolean;
  connecting: boolean;
  hasWallet: boolean;
  /** Prompts the wallet; resolves to the connected address, or undefined if rejected. */
  connect: () => Promise<string | undefined>;
  /** Fresh chain check (state may not have propagated yet right after connect). */
  isWrongNetwork: () => Promise<boolean>;
  switchToAmoy: () => Promise<void>;
  getSigner: () => Promise<JsonRpcSigner>;
  usesWalletConnect: boolean;
  /**
   * Runs something that needs the wallet's approval, and brings the wallet app
   * forward once the request is on its way.
   *
   * ORDER IS THE WHOLE POINT. Redirecting first backgrounds this page, and a
   * backgrounded page may never run the code that would have sent the request,
   * so the wallet opens with nothing to show: measured on Android, the app came
   * to the front and sat there empty. Starting the work first and redirecting
   * on the next tick puts the request on the relay before anything moves, and a
   * wallet in the foreground shows it as it arrives.
   *
   * `onNoLink` is for pairings that declared no deep link, where the only thing
   * left is to say it in words.
   *
   * `confirm` reads the chain to answer "did this actually happen", and it is
   * what makes the promise settle at all when the answer never comes back. See
   * `withReturnDeadline`: leaving the page to sign kills the relay socket, and
   * the reply published into it is lost for good. An action with nothing to
   * read, a plain signature, simply reports that and can be tried again.
   *
   * Both only apply to a WalletConnect session. An extension loses nothing.
   */
  withWalletApp: <T>(
    work: () => Promise<T>,
    onNoLink?: () => void,
    confirm?: () => Promise<T | undefined>,
  ) => Promise<T>;
}

export function useOrganizerWallet(): OrganizerWalletState {
  // Start from the remembered address so read-only screens work right after a
  // passkey-only login, before any wallet prompt.
  const [address, setAddress] = useState<string | undefined>(getRememberedOrganizerAddress);
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [connecting, setConnecting] = useState(false);
  /**
   * Bumped when a WalletConnect session is established.
   *
   * The event subscription below reads whichever provider exists when it
   * runs, and with no extension that is nothing: the session is created later,
   * by `connect`. Without this the listeners stayed attached to nothing, so a
   * network switch made in the wallet on a phone never reached the interface,
   * which is the exact case this whole path exists for.
   */
  const [providerEpoch, setProviderEpoch] = useState(0);

  const refreshNetwork = useCallback(async () => {
    const eth = activeProvider();
    if (!eth) return;
    const provider = new BrowserProvider(eth);
    const network = await provider.getNetwork();
    setWrongNetwork(Number(network.chainId) !== chainInfo.chainId);
  }, []);

  // Every page mounts a fresh instance, and the React state inside it starts
  // empty. (The WalletConnect session above is the one exception, and it is
  // module scope precisely so it survives that.)
  // Without this, navigating away from the connect screen "forgets" the wallet
  // even though MetaMask still has it authorized. `eth_accounts` (unlike
  // `eth_requestAccounts`) returns already-permitted accounts without prompting,
  // so this silently restores the connection on every page.
  useEffect(() => {
    const eth = activeProvider();
    if (!eth) return;
    const provider = new BrowserProvider(eth);
    void provider
      .send('eth_accounts', [])
      .then((accounts: string[]) => {
        if (accounts[0]) {
          setAddress(accounts[0]);
          void refreshNetwork();
        }
      })
      .catch(() => { /* ignored: treated as not connected */ });
  }, [refreshNetwork]);

  useEffect(() => {
    const eth = activeProvider() as (Eip1193Provider & { on?: (e: string, h: (...a: unknown[]) => void) => void; removeListener?: (e: string, h: (...a: unknown[]) => void) => void }) | undefined;
    if (!eth?.on) return;
    const onChain = () => void refreshNetwork();

    /**
     * The wallet is no longer available to this page, however it said so.
     *
     * Nothing here can hold it open, and pretending otherwise is worse than
     * saying so: the address would stay on screen, the session flag would stay
     * set, and every action would fail at the moment it was needed.
     */
    const endSession = () => {
      session = undefined;
      setAddress(undefined);
      forgetOrganizerAddress();
      // The session flag lives in AuthProvider, and the route guard watches
      // only that: without this the dashboard stays on screen with nothing
      // behind it.
      window.dispatchEvent(new Event(WALLET_DISCONNECTED_EVENT));
    };

    /**
     * The remembered address moves too, and that is the point.
     *
     * React state is per page: every screen mounts its own and seeds it from
     * local storage. Updating only the state meant switching accounts in the
     * wallet showed the new address on THIS screen and the old one on the next,
     * and the old one is what decides which elections are listed and what the
     * session believes. One of the two would have been signing.
     *
     * An empty list is the wallet saying it no longer serves this page (locked,
     * or permissions revoked), so the address goes rather than lingering as a
     * claim nothing backs.
     */
    const onAccounts = (accounts: unknown) => {
      const next = (accounts as string[])[0];

      // AN EMPTY LIST MEANS TWO DIFFERENT THINGS, and reading it as one cost a
      // session on every reload.
      //
      // From an injected extension it is a disconnection, and the one that
      // actually happens: "Disconnect this site" in MetaMask revokes the
      // permission and announces it here with no accounts, while EIP-1193's
      // `disconnect` never fires for it (that one means the provider lost the
      // CHAIN). Handling only `disconnect` left the dashboard on screen with
      // every number at zero: the address had gone, the session had not.
      //
      // Over WalletConnect it means nothing of the sort. `setAccounts` filters
      // the session accounts by the chain selected right now and emits what is
      // left, so being on a chain the wallet holds no account on empties the
      // list while the session stands. Ending it there logged an organizer out
      // of a screen they were reading, and only ever on a phone, where there is
      // no extension and every account comes through the session.
      if (!next) {
        if (hasLiveWalletConnectSession()) return;
        setAddress(undefined);
        endSession();
        return;
      }

      setAddress(next);

      // Remembered only while there is a session to remember it for. A wallet
      // keeps emitting this afterwards, and writing it back then resurrects an
      // address the app had deliberately forgotten: measured right after a
      // disconnect, where it reappeared in storage on its own.
      if (localStorage.getItem("votain_organizer_logged_in") !== "true") {
        forgetOrganizerAddress();
        return;
      }
      localStorage.setItem(REMEMBERED_ADDRESS_KEY, next);
    };

    eth.on("chainChanged", onChain);
    eth.on("accountsChanged", onAccounts);
    // A provider that loses the CHAIN says it this way instead.
    eth.on("disconnect", endSession);
    return () => {
      eth.removeListener?.("chainChanged", onChain);
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("disconnect", endSession);
    };
  }, [refreshNetwork, providerEpoch]);

  const connect = useCallback(async (): Promise<string | undefined> => {
    setConnecting(true);
    try {
      // An extension if there is one, a WalletConnect session if not. The
      // session opens the wallet app on a phone and comes back here, which is
      // the only route that exists where no provider is injected.
      const before = activeProvider();
      let eth = await resumeProvider();
      if (!eth) {
        // `hasWallet` is false in this case and every caller checks it first,
        // so this is a guard against a future one that does not.
        if (!isWalletConnectConfigured()) return undefined;
        session = await connectWalletConnect();
        eth = session;
      }
      // A session that was just opened has listeners to attach.
      if (!before) setProviderEpoch(n => n + 1);
      const provider = new BrowserProvider(eth);
      const accounts = (await provider.send("eth_requestAccounts", [])) as string[];
      const account = accounts[0];
      setAddress(account);
      if (account) localStorage.setItem(REMEMBERED_ADDRESS_KEY, account);
      await refreshNetwork();
      return account;
    } catch (e) {
      // Whatever went wrong, this page must not go on holding a provider that
      // cannot serve a request: every later call would fail against it.
      session = undefined;
      // Declining is an answer, not an error: the caller stays where it is.
      if (isUserRejection(e)) return undefined;
      // Anything else is thrown, because the callers already have somewhere
      // to show it and this hook has no business holding user-facing prose.
      throw e;
    } finally {
      setConnecting(false);
    }
  }, [refreshNetwork]);

  const isWrongNetwork = useCallback(async (): Promise<boolean> => {
    const eth = await resumeProvider();
    if (!eth) return true;
    const provider = new BrowserProvider(eth);
    const network = await provider.getNetwork();
    const wrong = Number(network.chainId) !== chainInfo.chainId;
    setWrongNetwork(wrong);
    return wrong;
  }, []);

  const switchToAmoy = useCallback(async () => {
    const eth = await resumeProvider();
    if (!eth) return;

    // A pairing that never approved this chain refuses every request for it,
    // including the one that would add it, which is circular. The way out is to
    // carry the request on a chain the pairing DID approve: adding a network is
    // a request to the wallet, not to a chain.
    if (eth === session && !sessionSupportsChain(chainInfo.chainId)) {
      if (session) setTimeout(() => openWalletApp(), 0);
      await withTimeout(
        addChainOverSession(CHAIN_PARAMS),
        ADD_CHAIN_TIMEOUT_MS,
        () => new Error(i18n.t("errors.confirm_in_wallet_app")),
      );

      // Namespaces are fixed when a session is made, so adding the network does
      // not widen this one. The wallet has it now, and a fresh pairing will
      // include it; nothing here can do that for them.
      if (!sessionSupportsChain(chainInfo.chainId)) {
        throw new Error(i18n.t("errors.chain_not_in_session"));
      }
    }

    const provider = new BrowserProvider(eth);

    /**
     * The same ordering every other wallet request needs: issue it, THEN bring
     * the wallet app forward, so the request is on the relay before this page
     * goes to the background. Switching a chain the wallet already has answers
     * without any of this; adding one does not, and that is the case where an
     * unopened app looks exactly like a frozen page.
     */
    const askWallet = async <T,>(work: Promise<T>): Promise<T> => {
      if (session) setTimeout(() => openWalletApp(), 0);
      return work;
    };

    try {
      // Bounded like the add below, and for the same reason. Switching answers
      // at once when the wallet has the chain, so a wait here is not the wallet
      // thinking: it is the reply having been published while this page was in
      // the background, where it is lost. Unbounded, that left the sign-in
      // screen disabled with nothing to press.
      await withTimeout(
        askWallet(provider.send("wallet_switchEthereumChain", [{ chainId: CHAIN_PARAMS.chainId }])),
        ADD_CHAIN_TIMEOUT_MS,
        () => new Error(i18n.t("errors.confirm_in_wallet_app")),
      );
    } catch (e) {
      // Declining is an answer. Anything else is treated as "the wallet does
      // not have this chain", and the add is attempted.
      //
      // 4902 is the code an EXTENSION returns for an unknown chain, and looking
      // only for it meant the add was never attempted over WalletConnect: there
      // the chain is missing from the session's approved namespaces, so the
      // request is refused by the SDK long before any wallet sees it, with an
      // error that says nothing about 4902. Adding a chain the wallet already
      // has is harmless, so guessing wrong in this direction costs nothing,
      // while guessing wrong the other way is a dead end with no way forward.
      if (isUserRejection(e)) throw e;
      {
        // Bounded, and only here. Switching to a chain the wallet already
        // has answers at once; ADDING one raises a prompt inside the wallet
        // app, which nothing brings to the front, so from the browser the wait
        // is indistinguishable from a freeze. The bound exists to end that, not
        // because the wallet is at fault: it answers as soon as it is seen.
        await withTimeout(
          askWallet(provider.send("wallet_addEthereumChain", [CHAIN_PARAMS])),
          ADD_CHAIN_TIMEOUT_MS,
          () => new Error(i18n.t("errors.confirm_in_wallet_app")),
        );
      }
    }
    await refreshNetwork();
  }, [refreshNetwork]);

  /**
   * Returns a signer, prompting the wallet if it is not connected yet. This is
   * what makes passkey-only login viable: the wallet is only summoned at the
   * moment something actually needs signing.
   */
  const withWalletApp = useCallback(
    async <T,>(
      work: () => Promise<T>,
      onNoLink?: () => void,
      confirm?: () => Promise<T | undefined>,
    ): Promise<T> => {
      // ONLY OVER WALLETCONNECT, and the distinction matters.
      //
      // An injected extension answers through the page itself: nothing is lost
      // by switching windows, and the promise settles on its own. Putting a
      // deadline on that would invent a failure, because waiting is normal
      // there: a transaction on a public testnet can take far longer to be
      // mined than anyone will sit still for, and glancing at another window
      // while it does is not evidence of anything.
      //
      // The relay is the only place an answer actually goes missing, so it is
      // the only place that is second-guessed. Wrapped the moment the request is
      // issued, never later: the deadline has to be watching before this page
      // can be sent to the background.
      const pending = session ? withReturnDeadline(work(), confirm) : work();
      if (session) {
        // Next tick, never sooner: see the note on the type above.
        setTimeout(() => {
          if (!openWalletApp()) onNoLink?.();
        }, 0);
      }
      return pending;
    },
    [],
  );

  const getSigner = useCallback(async (): Promise<JsonRpcSigner> => {
    // Through the accessor, like every other call. Reading `window.ethereum`
    // here meant signing went to the extension while everything else spoke to
    // the WalletConnect session, so on a phone, where there is no extension,
    // this threw at the moment a transaction was about to be signed.
    // Restore first, and only then offer to pair. This runs from an explicit
    // action (a deposit, a deployment, a tally), so a QR here is the right
    // answer for somebody whose session really has ended.
    let eth = await resumeProvider();
    if (!eth && isWalletConnectConfigured()) {
      session = await connectWalletConnect();
      eth = session;
    }
    if (!eth) throw new Error(i18n.t("errors.no_wallet"));
    const provider = new BrowserProvider(eth);

    const authorized = (await provider.send("eth_accounts", [])) as string[];
    if (authorized.length === 0) {
      const requested = (await provider.send("eth_requestAccounts", [])) as string[];
      if (requested.length === 0) throw new Error(i18n.t("errors.wallet_rejected"));
      setAddress(requested[0]);
      localStorage.setItem(REMEMBERED_ADDRESS_KEY, requested[0]);
    }

    return provider.getSigner();
  }, []);

  return {
    /** True when signing goes over a relay to a wallet app, not an extension. */
    usesWalletConnect: session !== undefined,
    withWalletApp,
    address,
    wrongNetwork,
    connecting,
    // True when there is any way to reach a wallet at all, injected or not,
    // so a phone stops being told it has no compatible wallet when it has a
    // perfectly good one sitting in another app.
    hasWallet:
      (typeof window !== "undefined" && Boolean(window.ethereum)) || isWalletConnectConfigured(),
    connect,
    isWrongNetwork,
    switchToAmoy,
    getSigner,
  };
}
