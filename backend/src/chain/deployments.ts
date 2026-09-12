/**
 * Where a contract address comes from.
 *
 * `deploy.ts` writes one manifest per network into `contracts/deployments/` and
 * mirrors it into the frontend, which reads it and therefore follows every
 * redeploy on its own. This backend used to read the same addresses out of
 * `.env` instead, which made them a SECOND source of truth for one fact, and a
 * source nothing updated: a local redeploy moved the contracts, the manifest
 * and the frontend moved with them, and the backend kept calling the old ones.
 *
 * The failure that produces is unhelpful out of proportion to its cause. A call
 * to an address with no code does not revert, it returns empty, and ethers
 * reports `BAD_DATA: could not decode result data (value="0x")`, naming neither
 * the contract nor the reason. It cost three debugging sessions before it was
 * traced.
 *
 * So the manifest is the default and the environment is an OVERRIDE, which is
 * the arrangement the frontend already documents for its own `VITE_*_ADDRESS`
 * variables. Production sets real environment variables and deploys no file,
 * and those still win; local development stops needing anyone to copy an
 * address by hand.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Manifest {
  chainId: number;
  network: string;
  contracts: Record<string, string>;
}

/** `backend/src/chain` -> `contracts/deployments`. */
const DEPLOYMENTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'contracts',
  'deployments',
);

let cache: Manifest[] | null = null;
let warned = false;

/**
 * Every manifest on disk, read once.
 *
 * Missing or unreadable is not an error: a deployed backend may have no
 * `contracts/` directory beside it at all, and there the environment is
 * expected to carry the addresses anyway.
 */
function manifests(): Manifest[] {
  if (cache) return cache;
  try {
    cache = readdirSync(DEPLOYMENTS_DIR)
      .filter(f => f.endsWith('.json'))
      .flatMap(f => {
        try {
          const parsed = JSON.parse(readFileSync(join(DEPLOYMENTS_DIR, f), 'utf-8')) as Manifest;
          return parsed?.contracts && typeof parsed.chainId === 'number' ? [parsed] : [];
        } catch {
          return []; // A half-written manifest is not worth crashing over.
        }
      });
  } catch {
    cache = [];
  }
  return cache;
}

/** Drops the cache. For the tests; a running server reads this once. */
export function refreshManifests(): void {
  cache = null;
  warned = false;
}

/**
 * The manifest this backend is talking to, or undefined when that is not
 * knowable.
 *
 * `CHAIN_NETWORK` picks one by name when several exist. Without it a single
 * manifest is unambiguous and is used, and several are refused rather than
 * guessed between: choosing the wrong chain's addresses fails exactly like the
 * stale-address bug this module exists to remove, and would be harder to see
 * because everything would look configured.
 */
function activeManifest(): Manifest | undefined {
  const found = manifests();
  if (found.length === 0) return undefined;

  const wanted = process.env.CHAIN_NETWORK;
  if (wanted) return found.find(m => m.network === wanted);

  if (found.length === 1) return found[0];

  if (!warned) {
    warned = true;
    console.warn(
      `Several deployment manifests found (${found.map(m => m.network).join(', ')}) and no ` +
        'CHAIN_NETWORK to choose between them. Contract addresses will come from the ' +
        'environment only. Set CHAIN_NETWORK, or set the addresses explicitly.',
    );
  }
  return undefined;
}

/**
 * The address of one contract: the environment first, then the manifest.
 *
 * Returns undefined when neither has it, which the callers already treat as
 * "this feature is not configured" and handle by skipping rather than crashing.
 */
export function contractAddress(name: string, envVar: string): string | undefined {
  const override = process.env[envVar];
  if (override) return override;
  return activeManifest()?.contracts[name];
}

/** Where an address came from. Logged at startup so a wrong one is traceable. */
export function addressSource(envVar: string): 'environment' | 'manifest' | 'unset' {
  if (process.env[envVar]) return 'environment';
  return activeManifest() ? 'manifest' : 'unset';
}
