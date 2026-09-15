/**
 * The organizer's wallet when there is no extension to inject one.
 *
 * `window.ethereum` exists in exactly two places: a desktop browser with a
 * wallet extension, and the in-app browser of a wallet on a phone. Everywhere
 * else, and that includes Chrome on Android and this app once it is installed,
 * there is nothing to detect and nothing to connect to. WalletConnect is the
 * protocol for that gap: the page opens a session through a relay, the wallet
 * approves it (a deep link into the app on a phone, a QR code on a desktop),
 * and what comes back is an ordinary EIP-1193 provider that `ethers` wraps like
 * any other. The page stays where it is.
 *
 * LOADED ON DEMAND. The provider and its modal are a large dependency, and an
 * organizer with an extension never needs a byte of it, so it arrives through a
 * dynamic import at the moment someone without one asks to connect.
 *
 * ONLY ORGANIZERS. A voter never holds a wallet: their transactions go through
 * the issuer's relayer, because an address of their own would tie their
 * enrolment to their ballot on chain.
 */
import type { Eip1193Provider } from "ethers";

import { chainInfo } from "./deployments";
import { onReturnToForeground } from "./foreground";

/**
 * Public by design: it identifies the project to the relay and ships inside
 * every dApp's client bundle. It is not a secret and cannot authorise anything.
 */
const PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;

/**
 * Whether the page itself is running on a phone.
 *
 * The question behind it is always the same: are the dApp and the wallet on the
 * SAME device? On a phone they are, so leaving and coming back is one app
 * switch. On a desktop the wallet is somewhere else entirely, and anything that
 * assumes otherwise sends the person nowhere.
 */
const ON_A_PHONE = typeof navigator !== "undefined" &&
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function isWalletConnectConfigured(): boolean {
  return Boolean(PROJECT_ID);
}

export class WalletConnectUnavailableError extends Error {
  constructor() {
    super("WalletConnect is not configured: set VITE_WALLETCONNECT_PROJECT_ID");
    this.name = "WalletConnectUnavailableError";
  }
}

/** The live session, kept so a second call reuses it instead of pairing again. */
let provider:
  | (Eip1193Provider & {
      connect: () => Promise<void>;
      disconnect: () => Promise<void>;
      connected?: boolean;
      session?: unknown;
    })
  | undefined;

/**
 * Whether this provider can actually serve a request.
 *
 * THE SESSION IS THE WHOLE ANSWER, and it took two wrong turns to get here.
 *
 * `connected` is not what it sounds like. It reads
 * `signer.client.core.relayer.connected`: whether the websocket to the relay is
 * up, which says nothing about whether a wallet ever approved anything. It is
 * true moments after init with no session at all, and every call then fails
 * with "Please call connect() before request()", which ethers reads as a
 * network it cannot detect and retries against every second.
 *
 * So a session check was added, correctly. Requiring BOTH was the second wrong
 * turn: a restored session whose socket has not finished coming up reports
 * false, the app concludes it has nothing and starts a pairing it does not
 * need, and `EthereumProvider.connect` opens its modal BEFORE it has a URI to
 * show. What that looks like is an empty QR code over a dashboard that is
 * already signed in.
 *
 * A socket that is down comes back on its own and the SDK resends. A session
 * that does not exist is the only thing that cannot be waited out.
 */
function isLive(p: typeof provider): boolean {
  return Boolean(p?.session);
}

/**
 * Forgets the provider entirely, so the next attempt builds a fresh one.
 *
 * Reusing an instance whose pairing failed is what turned "close the modal and
 * press connect again" into a permanent error: it answered from the same dead
 * object every time.
 */
/**
 * Whether a WalletConnect session is still standing.
 *
 * Exists so an EMPTY `accountsChanged` can be read correctly. Over an injected
 * extension that means the permission was revoked and the session is over. Over
 * WalletConnect it means something far milder: `setAccounts` filters the
 * session accounts by the chain currently selected and emits whatever is left,
 * so a chain the wallet holds no account on produces an empty list while the
 * session is perfectly alive.
 */
export function hasLiveWalletConnectSession(): boolean {
  return isLive(provider);
}

export function resetWalletConnect(): void {
  stopRelayRecovery?.();
  stopRelayRecovery = undefined;
  provider = undefined;
  building = undefined;
}

/**
 * Opens a session and returns the provider, reusing one that is already open.
 *
 * The metadata is what the wallet shows on its approval screen, so `url` is
 * read from the page rather than hardcoded: a wallet warns about a mismatch
 * between the origin it was opened from and the origin the dApp claims, and
 * during development those differ from production.
 */
/**
 * The build in flight, so callers that arrive together share one Core.
 *
 * Defensive rather than measured. `provider` is only assigned once init
 * RESOLVES, so two callers overlapping inside it would each build one, and the
 * entry points are reachable from separate components. No test here manages to
 * open that window, so it is kept on the strength of the argument and not of
 * an observation.
 */
let building: Promise<NonNullable<typeof provider>> | undefined;

/**
 * Builds the provider, which on its own RESTORES a session the wallet still
 * holds and shows nothing. Pairing is a separate step, and a separate function.
 *
 * AT MOST ONE PER PAGE, and the reason is not tidiness. A second Core opens its
 * own relay client over the SAME storage, and the pairing then splits between
 * them: the QR belongs to one, the wallet's approval is delivered to the other,
 * which has no such proposal in its keychain. What the console shows is
 * "No matching key. proposal: ...", and what the person sees is a QR code they
 * scanned, approved, and which never closed.
 *
 * It happened on every browser with no extension. Connecting first tries to
 * restore, which builds one and finds no session, and then pairs, which built
 * another: the guards either side only reused a provider that was already LIVE,
 * and a provider with nothing to restore never is.
 *
 * `resetWalletConnect` is the only way to get a fresh one, which is what the
 * failure paths want.
 */
async function initProvider(projectId: string): Promise<NonNullable<typeof provider>> {
  if (provider) return provider;
  if (building) return building;

  building = buildProvider(projectId);
  try {
    return await building;
  } finally {
    building = undefined;
  }
}

/**
 * The QR modal, as the provider exposes it. Typed here because the SDK types
 * it as `any`, and only the two members used are worth naming.
 */
interface QrModal {
  close?: () => void;
  subscribeState?: (cb: (state: { open?: boolean }) => void) => void;
}

/**
 * Closes the modal whenever it opens while a session already exists.
 *
 * The modal has exactly one job: carry a pairing. Once the wallet has approved
 * one, there is nothing left for it to show, and what it actually showed was an
 * empty frame over the dashboard.
 *
 * Measured rather than guessed. The SDK closes it correctly when `connect`
 * settles, and then, about 200ms later and after this app has already navigated
 * away, something sets `ModalController.open` back to true and the frame returns
 * for good. Nothing in this app asks for it: no screen behind the guard touches
 * the wallet on mount, and no second pairing is proposed on the relay. It is
 * AppKit doing what it does for a dApp that hands it the connection flow, which
 * this one does not: it drives the pairing itself and moves on.
 *
 * So rather than racing that reopen with a close of our own, this states the
 * invariant and lets it hold whenever it is broken. During a pairing there is no
 * session yet, so the QR is never touched.
 */
function closeModalOncePaired(p: NonNullable<typeof provider>): void {
  const modal = (p as unknown as { modal?: QrModal }).modal;
  if (!modal?.subscribeState || !modal.close) return;

  modal.subscribeState(state => {
    if (!state.open) return;
    if (!p.session) return;
    modal.close?.();
  });
}
/** A topic this client is subscribed to, as the subscriber describes it. */
interface RelaySubscription {
  topic: string;
  relay: { protocol: string };
}

/**
 * The relay, reached through the layers that own it.
 *
 * `batchFetchMessages` is private in the SDK, and typed here because it is the
 * only way to ask for what the mailbox still holds. See below for why that is
 * worth reaching for.
 */
interface RelayTransport {
  signer?: {
    client?: {
      core?: {
        relayer?: {
          connected?: boolean;
          restartTransport?: () => Promise<void>;
          subscriber?: {
            values?: RelaySubscription[];
            batchFetchMessages?: (subs: RelaySubscription[]) => Promise<void>;
          };
        };
      };
    };
  };
}

/** Stops the recovery attached to a provider that is being replaced. */
let stopRelayRecovery: (() => void) | undefined;

/**
 * Puts the relay socket back together when the page returns to the foreground.
 *
 * THIS IS THE ROOT OF A WHOLE FAMILY OF BUGS, and it is worth stating plainly.
 * Signing on a phone means leaving: the wallet app takes the screen and the
 * system tears down the websocket this page was waiting on. The wallet does its
 * part and publishes the answer, but it arrives at a connection nobody holds,
 * so the promise never settles. Everything written after that `await` simply
 * never runs: no success message, no modal closing, no refresh, and a button
 * disabled for the rest of the session even though the transaction went
 * through.
 *
 * It looked like several unrelated faults, one per screen, and it was one.
 *
 * The SDK does not do this for us. `@walletconnect/core` listens to no
 * lifecycle event at all: not `visibilitychange`, not `online`, not `resume`.
 * Nothing tells it the page is back, so the socket stays a corpse and the NEXT
 * request hangs the same way the last one did. `restartTransport` is its public
 * answer, and this is what calls it.
 *
 * What this does NOT do is rescue the answer that was already lost. Measured on
 * a real phone: after the freeze, reconnecting and resubscribing brings back
 * nothing, so the reply to the request that was in flight is gone for good.
 * That is why the outcome of an action is settled against the chain instead,
 * in `withReturnDeadline`, and never by waiting for the wallet to speak again.
 */
function recoverRelayOnReturn(p: NonNullable<typeof provider>): void {
  stopRelayRecovery?.();
  stopRelayRecovery = onReturnToForeground(() => {
    const relayer = (p as unknown as RelayTransport).signer?.client?.core?.relayer;
    if (!relayer) return;

    void (async () => {
      try {
        // ONLY IF IT IS ACTUALLY DEAD. `restartTransport` closes the socket and
        // opens a new one, so calling it on a connection that survived the trip
        // destroys whatever was about to be delivered on it, which is precisely
        // the answer being waited for. Rebuilding a working socket cannot help
        // and can lose things, so the state is checked rather than assumed.
        if (relayer.connected === false) await relayer.restartTransport?.();

        // AND THEN ASK THE MAILBOX, which is the part the SDK never does.
        //
        // The relay keeps an undelivered message until its TTL, and
        // `irn_batchFetchMessages` is the protocol's way to collect what is
        // waiting. The SDK implements it and then calls it from nowhere: the
        // method carries a `@ts-ignore` precisely because it is unused, so
        // reconnecting resubscribes and never asks for what was missed.
        //
        // That is the whole difference between recovering the wallet's real
        // answer, which resolves the request and runs the success path as
        // written, and having to infer the outcome from the chain afterwards.
        //
        // Private, so it is reached defensively and may simply not be there in
        // a later SDK. Nothing breaks if so: `withReturnDeadline` still settles
        // the request against the chain, this only gets there first and with a
        // better answer.
        const subscriber = relayer.subscriber;
        const topics = subscriber?.values ?? [];
        if (topics.length) await subscriber?.batchFetchMessages?.(topics);
      } catch {
        // Nowhere to report this to, and nothing useful to say: the next
        // request is what surfaces a transport that is still down.
      }
    })();
  });
}
async function buildProvider(projectId: string): Promise<NonNullable<typeof provider>> {
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");

  provider = (await EthereumProvider.init({
    projectId,
    // OPTIONAL, NEVER REQUIRED. A required chain makes a wallet that does not
    // have it refuse the session outright, and then there is no session left to
    // ask it to add the chain over. The official guidance says the same, and its
    // example passes optionalChains alone, so `chains` is not passed at all.
    optionalChains: [chainInfo.chainId],
    // WHERE THE READS GO, and the reason a signature request never arrived.
    //
    // This provider sends only the signing methods to the wallet:
    // `eth_sendTransaction`, `personal_sign`, `eth_signTypedData*` and the
    // `wallet_*` family. Everything else it resolves ITSELF over HTTP, and with
    // no map it uses rpc.walletconnect.org, which serves public chains and has
    // never heard of a Hardhat node on 31337.
    //
    // ethers estimates gas and reads a nonce before it sends anything. Those
    // reads went to an endpoint that cannot answer for this chain, so the
    // transaction was never built and `eth_sendTransaction` was never sent. The
    // wallet came to the foreground with nothing to show, which looked like a
    // wallet ignoring the request when in fact no request had left the page.
    //
    // There is already an RPC the phone can reach: the origin serving the page
    // proxies /rpc to the node, so this follows the tunnel without being
    // written down anywhere.
    rpcMap: { [chainInfo.chainId]: chainInfo.rpcUrl },
    showQrModal: true,
    metadata: {
      name: "Votain",
      description: "End-to-end verifiable anonymous voting",
      url: window.location.origin,
      icons: [`${window.location.origin}/icons/icon-512.png`],
      /**
       * WHERE THE WALLET SENDS THEM BACK, and the reason a signature could not
       * be completed on a phone at all.
       *
       * Without this the wallet has nowhere to return to. The person approves,
       * the wallet publishes the answer, and they are still sitting in the
       * wallet while this page is in the background with a socket the system is
       * taking apart. By the time they switch back by hand the relay has marked
       * the message delivered and dropped it, and it is gone: measured, and not
       * recoverable by reconnecting or by asking the mailbox.
       *
       * It cost nothing to leave out and it broke one whole class of action.
       * Sending a transaction survived it, because the wallet broadcasts that
       * itself and the chain can be asked afterwards. A SIGNATURE cannot: the
       * answer is the entire product of the request, so losing it means the
       * action simply never happened.
       *
       * `universal` rather than `native`, because a web app has no scheme of
       * its own. Android returns to the browser; iOS 17 and later will not do
       * this for a browser-based dApp at all, which is the platform's
       * limitation and not something to design around here.
       *
       * ONLY WHEN BOTH ARE ON THIS DEVICE. A desktop pairing puts the wallet on
       * somebody's phone, and telling that phone to open this page would send
       * them to a second copy of the app on the wrong screen while the real one
       * waits on the desk. Reown says the same about pairings made by scanning
       * a QR code, and it is the same reason `openWalletApp` refuses to
       * redirect there.
       */
      ...(ON_A_PHONE ? { redirect: { universal: window.location.origin } } : {}),
    },
  })) as unknown as typeof provider;

  closeModalOncePaired(provider!);
  recoverRelayOnReturn(provider!);

  return provider!;
}

/**
 * The session this browser already has, or nothing. NEVER shows a QR code.
 *
 * The live provider is a module variable, so a page reload empties it while the
 * wallet on the other side still considers the session open. This is how the
 * app gets it back without asking anyone: on a phone, where nothing is injected
 * into the page, every organizer action after a reload depends on it.
 *
 * Returns undefined when there is genuinely nothing to restore, which is the
 * caller's cue to offer a connection rather than to demand one.
 */
export async function restoreWalletConnect(): Promise<Eip1193Provider | undefined> {
  if (!PROJECT_ID) return undefined;
  if (isLive(provider)) return provider;

  const restored = await initProvider(PROJECT_ID);
  return isLive(restored) ? restored : undefined;
}

/**
 * Opens a session and returns the provider, reusing one that is already open.
 *
 * SHOWS A QR CODE when there is nothing to reuse, so call it from an explicit
 * action and never from a check that runs on its own.
 */
export async function connectWalletConnect(): Promise<Eip1193Provider> {
  if (!PROJECT_ID) throw new WalletConnectUnavailableError();
  if (provider && isLive(provider)) return provider;

  const opened = await initProvider(PROJECT_ID);
  try {
    if (!isLive(opened)) await opened.connect();
  } catch (e) {
    // Closing the modal lands here. The instance is unusable from now on, so it
    // goes: the next press must start a pairing rather than ask a dead object.
    resetWalletConnect();
    throw e;
  }

  // Refusing to hand back something that cannot serve a request is the whole
  // point: ethers would take it and retry against it forever.
  if (!isLive(opened)) {
    resetWalletConnect();
    throw new Error("WalletConnect session was not established");
  }
  return opened;
}

/**
 * The wallet's own deep link, as the wallet declared it when pairing.
 *
 * `native` is its custom scheme (`metamask://`), `universal` an https address
 * that resolves to the app. Either brings it to the foreground; neither is
 * guessed, because a guessed scheme opens the wrong wallet or nothing.
 */
/**
 * Whether the pairing approved the chain this build talks to.
 *
 * A session fixes its namespaces when it is made: a wallet that did not have
 * the chain approves nothing for it, and every later request for that chain is
 * refused by the SDK before any wallet sees it. The app then opens a wallet
 * that has nothing to show, which is what makes this worth checking rather
 * than attempting.
 *
 * True when there is no session, or when the session lists no chains at all:
 * neither is evidence of a refusal, and guessing pessimistically would block a
 * pairing that works.
 */
interface SessionChains {
  session?: { namespaces?: { eip155?: { chains?: string[] } } };
}

export function sessionSupportsChain(chainId: number): boolean {
  const chains = (provider as SessionChains | undefined)?.session?.namespaces?.eip155?.chains;
  if (!chains || chains.length === 0) return true;
  return chains.includes(`eip155:${chainId}`);
}

/**
 * Asks the wallet to ADD a network, over a chain the session already approves.
 *
 * The obvious call fails, and the reason is worth knowing. `provider.request`
 * routes to whatever chain the provider currently holds, and if the session
 * never approved that chain the SDK refuses before any wallet sees it: the app
 * is then asked to add a network it cannot ask about, which is circular.
 *
 * But `wallet_addEthereumChain` is a request to the WALLET, not to a chain. It
 * works the same way an extension does it, where you sit on one network and ask
 * to add another. `EthereumProvider` exposes its `UniversalProvider` as
 * `signer`, whose `request` takes the target chain explicitly, so the request
 * goes out on a chain the pairing did approve and reaches the wallet.
 *
 * Throws when there is no session or it approved nothing at all, which the
 * caller reports rather than retries.
 */
interface SessionSigner {
  signer?: { request: (args: { method: string; params: unknown[] }, chain: string) => Promise<unknown> };
  session?: { namespaces?: { eip155?: { chains?: string[] } } };
}

export async function addChainOverSession(chainParams: unknown): Promise<void> {
  const wc = provider as SessionSigner | undefined;
  const approved = wc?.session?.namespaces?.eip155?.chains ?? [];
  if (!wc?.signer || approved.length === 0) {
    throw new Error("No approved chain to carry the request");
  }

  await wc.signer.request(
    { method: "wallet_addEthereumChain", params: [chainParams] },
    approved[0],
  );
}

interface SessionPeer {
  session?: { peer?: { metadata?: { redirect?: { native?: string; universal?: string } } } };
}

export function walletAppLink(): string | undefined {
  const redirect = (provider as SessionPeer | undefined)?.session?.peer?.metadata?.redirect;
  return redirect?.native || redirect?.universal || undefined;
}

/**
 * Brings the wallet app forward so a request can be seen.
 *
 * Returns false when the wallet named no address, which is the caller's cue to
 * fall back to telling the person in words. Not every wallet declares one, and
 * a desktop pairing declares none at all.
 */
export function openWalletApp(): boolean {
  // Only where a wallet app can be opened at all. Reown's guidance is explicit
  // that a session paired by scanning a QR code must not trigger an app
  // redirect, and that is the desktop case exactly: the wallet still declares
  // its native scheme, but it lives on a phone that this browser cannot reach.
  // Navigating there would do nothing AND hide the message that would have told
  // the person to go and look.
  if (!ON_A_PHONE) return false;

  const link = walletAppLink();
  if (!link) return false;
  window.location.href = link;
  return true;
}

/** Ends the session, so the wallet stops listing this dApp as connected. */
export async function disconnectWalletConnect(): Promise<void> {
  if (!isLive(provider)) {
    resetWalletConnect();
    return;
  }
  await provider!.disconnect();
  provider = undefined;
}
