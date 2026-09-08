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
import { connectWalletConnect, isWalletConnectConfigured } from "../lib/walletConnect";
import i18n from "../i18n/config";

const REMEMBERED_ADDRESS_KEY = "votain_organizer_address";

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
 * Someone declining the prompt, as opposed to something going wrong.
 *
 * EIP-1193 says 4001, ethers wraps it as ACTION_REJECTED, and a wallet
 * reached over WalletConnect may send either. Told apart because a rejection
 * needs no message (they just declined) while a failure needs one badly.
 */
function isUserRejection(e: unknown): boolean {
  const err = e as { code?: number | string; error?: { code?: number } };
  return err?.code === 4001 || err?.code === 'ACTION_REJECTED' || err?.error?.code === 4001;
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
    const onAccounts = (accounts: unknown) => {
      const list = accounts as string[];
      setAddress(list[0]);
    };
    eth.on("chainChanged", onChain);
    eth.on("accountsChanged", onAccounts);
    return () => {
      eth.removeListener?.("chainChanged", onChain);
      eth.removeListener?.("accountsChanged", onAccounts);
    };
  }, [refreshNetwork, providerEpoch]);

  const connect = useCallback(async (): Promise<string | undefined> => {
    setConnecting(true);
    try {
      // An extension if there is one, a WalletConnect session if not. The
      // session opens the wallet app on a phone and comes back here, which is
      // the only route that exists where no provider is injected.
      let eth = activeProvider();
      if (!eth) {
        // `hasWallet` is false in this case and every caller checks it first,
        // so this is a guard against a future one that does not.
        if (!isWalletConnectConfigured()) return undefined;
        eth = await connectWalletConnect();
        session = eth;
        setProviderEpoch(n => n + 1);
      }
      const provider = new BrowserProvider(eth);
      const accounts = (await provider.send("eth_requestAccounts", [])) as string[];
      const account = accounts[0];
      setAddress(account);
      if (account) localStorage.setItem(REMEMBERED_ADDRESS_KEY, account);
      await refreshNetwork();
      return account;
    } catch (e) {
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
    const eth = activeProvider();
    if (!eth) return true;
    const provider = new BrowserProvider(eth);
    const network = await provider.getNetwork();
    const wrong = Number(network.chainId) !== chainInfo.chainId;
    setWrongNetwork(wrong);
    return wrong;
  }, []);

  const switchToAmoy = useCallback(async () => {
    const eth = activeProvider();
    if (!eth) return;
    const provider = new BrowserProvider(eth);
    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: CHAIN_PARAMS.chainId }]);
    } catch (e) {
      // 4902 = chain not added yet
      if ((e as { error?: { code?: number }; code?: number })?.code === 4902 ||
          (e as { error?: { code?: number } })?.error?.code === 4902) {
        await provider.send("wallet_addEthereumChain", [CHAIN_PARAMS]);
      } else {
        throw e;
      }
    }
    await refreshNetwork();
  }, [refreshNetwork]);

  /**
   * Returns a signer, prompting the wallet if it is not connected yet. This is
   * what makes passkey-only login viable: the wallet is only summoned at the
   * moment something actually needs signing.
   */
  const getSigner = useCallback(async (): Promise<JsonRpcSigner> => {
    // Through the accessor, like every other call. Reading `window.ethereum`
    // here meant signing went to the extension while everything else spoke to
    // the WalletConnect session, so on a phone, where there is no extension,
    // this threw at the moment a transaction was about to be signed.
    const eth = activeProvider();
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
