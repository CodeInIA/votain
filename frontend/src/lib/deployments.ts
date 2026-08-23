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
  /// Block the platform was deployed at. Log queries start here, never at 0.
  deployedAtBlock?: number;
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

/**
 * Looks the manifest up by filename rather than by exact glob key.
 *
 * `import.meta.glob` keys are not stable across Vite versions: they have been
 * relative to the importing file in some releases and project-root absolute in
 * others. Matching the exact string silently returned `undefined` when the shape
 * changed, and the app then fell back to seed data as if no contracts were
 * deployed: the failure mode looks like "nothing is deployed yet" rather than
 * like a bug, which is exactly how it survives review.
 */
function manifestFor(network: string): Deployment | undefined {
  const suffix = `/${network}.json`;
  for (const [key, value] of Object.entries(manifests)) {
    if (key.endsWith(suffix)) return value;
  }
  return undefined;
}

const TARGET_NETWORK = envOverride(import.meta.env.VITE_CHAIN_NETWORK) ?? "amoy";

const manifest = manifestFor(TARGET_NETWORK);

/**
 * An unset Vite variable is the empty string, not undefined, so `??` would let a
 * blank `VITE_*_ADDRESS=` line win over the deployment manifest and silently
 * leave the app in seed mode with contracts sitting right there on chain. The
 * `.env` files ship those keys blank on purpose ("override-only"), which made
 * this the default state rather than an edge case.
 */
function envOverride(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export const addresses = {
  electionFactory:
    envOverride(import.meta.env.VITE_ELECTION_FACTORY_ADDRESS) ??
    manifest?.contracts.ElectionFactory,
  platformRegistry:
    envOverride(import.meta.env.VITE_PLATFORM_REGISTRY_ADDRESS) ??
    manifest?.contracts.PlatformRegistry,
  paymaster:
    envOverride(import.meta.env.VITE_PAYMASTER_ADDRESS) ??
    manifest?.contracts.ElectionPaymaster,
};

const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? manifest?.chainId ?? 80002);

/**
 * Lower bound for every eth_getLogs range. Nothing this platform emitted can
 * predate the deployment, so starting here is both correct and orders of
 * magnitude cheaper than scanning from block 0 (~45M blocks on Amoy).
 */
export const deploymentBlock: number = manifest?.deployedAtBlock ?? 0;

/**
 * Human-readable chain metadata, used when asking a wallet to add/switch network
 * and to label amounts in the UI.
 *
 * Polygon's native gas token was renamed MATIC → POL (Sept 2024); Amoy's gas
 * token is POL. Never hardcode a currency symbol in components: read it here.
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
    envOverride(import.meta.env.VITE_RPC_URL) ??
    envOverride(import.meta.env.VITE_AMOY_RPC_URL) ??
    // Tenderly, not rpc-amoy.polygon.technology (dead) and not drpc/publicnode,
    // which cap eth_getLogs at 10000 blocks and would truncate queryFilter reads.
    (CHAIN_ID === 31337 ? "http://127.0.0.1:8545" : "https://polygon-amoy.gateway.tenderly.co"),
  name: KNOWN_CHAINS[CHAIN_ID]?.name ?? `Chain ${CHAIN_ID}`,
  currency: KNOWN_CHAINS[CHAIN_ID]?.currency ?? "ETH",
  explorer: KNOWN_CHAINS[CHAIN_ID]?.explorer,
};

/** True when the dApp has a factory address to talk to. */
export function isChainConfigured(): boolean {
  return Boolean(addresses.electionFactory);
}
