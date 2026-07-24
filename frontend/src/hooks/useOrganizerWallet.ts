/**
 * Organizer wallet connection (injected EOA — MetaMask or compatible).
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
 * The stored address is a public identifier, never a credential — it grants no
 * ability to act. Every write still needs a wallet signature and passes the
 * contracts' `onlyOrganizer` check.
 */
import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, type Eip1193Provider, type JsonRpcSigner } from "ethers";
import { chainInfo } from "../lib/deployments";

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

/** Params passed to wallet_addEthereumChain — derived from the configured chain. */
const CHAIN_PARAMS = {
  chainId: "0x" + chainInfo.chainId.toString(16),
  chainName: chainInfo.name,
  nativeCurrency: { name: chainInfo.currency, symbol: chainInfo.currency, decimals: 18 },
  rpcUrls: [chainInfo.rpcUrl],
  ...(chainInfo.explorer ? { blockExplorerUrls: [chainInfo.explorer] } : {}),
};

interface OrganizerWalletState {
  address: string | undefined;
  wrongNetwork: boolean;
  connecting: boolean;
  error: string | null;
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
  const [error, setError] = useState<string | null>(null);

  const refreshNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    const provider = new BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    setWrongNetwork(Number(network.chainId) !== chainInfo.chainId);
  }, []);

  // This hook has no shared/global state — every page mounts a fresh instance.
  // Without this, navigating away from the connect screen "forgets" the wallet
  // even though MetaMask still has it authorized. `eth_accounts` (unlike
  // `eth_requestAccounts`) returns already-permitted accounts without prompting,
  // so this silently restores the connection on every page.
  useEffect(() => {
    if (!window.ethereum) return;
    const provider = new BrowserProvider(window.ethereum);
    void provider
      .send('eth_accounts', [])
      .then((accounts: string[]) => {
        if (accounts[0]) {
          setAddress(accounts[0]);
          void refreshNetwork();
        }
      })
      .catch(() => { /* ignore — treated as not connected */ });
  }, [refreshNetwork]);

  useEffect(() => {
    const eth = window.ethereum;
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
  }, [refreshNetwork]);

  const connect = useCallback(async (): Promise<string | undefined> => {
    if (!window.ethereum) {
      setError("No injected wallet found — install MetaMask");
      return undefined;
    }
    setConnecting(true);
    setError(null);
    try {
      const provider = new BrowserProvider(window.ethereum);
      const accounts = (await provider.send("eth_requestAccounts", [])) as string[];
      const account = accounts[0];
      setAddress(account);
      if (account) localStorage.setItem(REMEMBERED_ADDRESS_KEY, account);
      await refreshNetwork();
      return account;
    } catch (e) {
      // Includes the user rejecting the connection prompt.
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setConnecting(false);
    }
  }, [refreshNetwork]);

  const isWrongNetwork = useCallback(async (): Promise<boolean> => {
    if (!window.ethereum) return true;
    const provider = new BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    const wrong = Number(network.chainId) !== chainInfo.chainId;
    setWrongNetwork(wrong);
    return wrong;
  }, []);

  const switchToAmoy = useCallback(async () => {
    if (!window.ethereum) return;
    const provider = new BrowserProvider(window.ethereum);
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
    if (!window.ethereum) throw new Error("No injected wallet found — install MetaMask");
    const provider = new BrowserProvider(window.ethereum);

    const authorized = (await provider.send("eth_accounts", [])) as string[];
    if (authorized.length === 0) {
      const requested = (await provider.send("eth_requestAccounts", [])) as string[];
      if (requested.length === 0) throw new Error("Wallet connection was rejected");
      setAddress(requested[0]);
      localStorage.setItem(REMEMBERED_ADDRESS_KEY, requested[0]);
    }

    return provider.getSigner();
  }, []);

  return {
    address,
    wrongNetwork,
    connecting,
    error,
    hasWallet: typeof window !== "undefined" && Boolean(window.ethereum),
    connect,
    isWrongNetwork,
    switchToAmoy,
    getSigner,
  };
}
