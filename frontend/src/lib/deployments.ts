/**
 * Contract address resolution.
 *
 * Priority: VITE_* env vars (set per environment) → committed deployment
 * manifest (written by `contracts/scripts/deploy.ts`). When neither source
 * provides an ElectionFactory address the chain layer is considered
 * unconfigured and the UI falls back to the Phase A seed data.
 */

export interface Deployment {
  chainId: number;
  network: string;
  contracts: {
    PlatformRegistry?: string;
    ElectionPaymaster?: string;
    ElectionFactory?: string;
    SemaphoreVerifierV4?: string;
    MockVerifier?: string;
    PoseidonT3?: string;
  };
  config?: {
    entryPoint?: string;
    trustedForwarder?: string;
  };
}

// Vite resolves JSON imports at build time; the manifest is committed for Amoy.
const manifests = import.meta.glob<Deployment>("./deployments/*.json", {
  eager: true,
  import: "default",
});

function manifestFor(network: string): Deployment | undefined {
  return manifests[`./deployments/${network}.json`];
}

const TARGET_NETWORK = import.meta.env.VITE_CHAIN_NETWORK ?? "amoy";

const manifest = manifestFor(TARGET_NETWORK);

export const addresses = {
  electionFactory:
    (import.meta.env.VITE_ELECTION_FACTORY_ADDRESS as string | undefined) ??
    manifest?.contracts.ElectionFactory,
  platformRegistry:
    (import.meta.env.VITE_PLATFORM_REGISTRY_ADDRESS as string | undefined) ??
    manifest?.contracts.PlatformRegistry,
  paymaster:
    (import.meta.env.VITE_PAYMASTER_ADDRESS as string | undefined) ??
    manifest?.contracts.ElectionPaymaster,
};

const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? manifest?.chainId ?? 80002);

/**
 * Human-readable chain metadata, used when asking a wallet to add/switch network
 * and to label amounts in the UI.
 *
 * Polygon's native gas token was renamed MATIC → POL (Sept 2024); Amoy's gas
 * token is POL. Never hardcode a currency symbol in components — read it here.
 */
const KNOWN_CHAINS: Record<number, { name: string; currency: string; explorer?: string }> = {
  80002: { name: "Polygon Amoy Testnet", currency: "POL", explorer: "https://amoy.polygonscan.com/" },
  137: { name: "Polygon Mainnet", currency: "POL", explorer: "https://polygonscan.com/" },
  31337: { name: "Hardhat Local", currency: "ETH" },
};

export const chainInfo = {
  chainId: CHAIN_ID,
  network: TARGET_NETWORK,
  // VITE_RPC_URL is the generic override (works for local chains too);
  // VITE_AMOY_RPC_URL is kept for backwards compatibility.
  rpcUrl:
    (import.meta.env.VITE_RPC_URL as string | undefined) ??
    (import.meta.env.VITE_AMOY_RPC_URL as string | undefined) ??
    (CHAIN_ID === 31337 ? "http://127.0.0.1:8545" : "https://rpc-amoy.polygon.technology"),
  name: KNOWN_CHAINS[CHAIN_ID]?.name ?? `Chain ${CHAIN_ID}`,
  currency: KNOWN_CHAINS[CHAIN_ID]?.currency ?? "ETH",
  explorer: KNOWN_CHAINS[CHAIN_ID]?.explorer,
};

/** True when the dApp has a factory address to talk to. */
export function isChainConfigured(): boolean {
  return Boolean(addresses.electionFactory);
}
