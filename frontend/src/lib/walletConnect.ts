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

/**
 * Public by design: it identifies the project to the relay and ships inside
 * every dApp's client bundle. It is not a secret and cannot authorise anything.
 */
const PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;

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
let provider: (Eip1193Provider & { connect: () => Promise<void>; disconnect: () => Promise<void>; connected?: boolean }) | undefined;

/**
 * Opens a session and returns the provider, reusing one that is already open.
 *
 * The metadata is what the wallet shows on its approval screen, so `url` is
 * read from the page rather than hardcoded: a wallet warns about a mismatch
 * between the origin it was opened from and the origin the dApp claims, and
 * during development those differ from production.
 */
export async function connectWalletConnect(): Promise<Eip1193Provider> {
  if (!PROJECT_ID) throw new WalletConnectUnavailableError();
  if (provider?.connected) return provider;

  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");

  provider = (await EthereumProvider.init({
    projectId: PROJECT_ID,
    // The chain the platform is deployed on. Optional rather than required so a
    // wallet that does not know it can still pair and be asked to add it,
    // instead of refusing the session outright.
    chains: [],
    optionalChains: [chainInfo.chainId],
    showQrModal: true,
    metadata: {
      name: "Votain",
      description: "End-to-end verifiable anonymous voting",
      url: window.location.origin,
      icons: [`${window.location.origin}/icons/icon-512.png`],
    },
  })) as unknown as typeof provider;

  await provider!.connect();
  return provider!;
}

/** Ends the session, so the wallet stops listing this dApp as connected. */
export async function disconnectWalletConnect(): Promise<void> {
  if (!provider?.connected) return;
  await provider.disconnect();
  provider = undefined;
}
