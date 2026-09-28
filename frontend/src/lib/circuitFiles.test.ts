/**
 * Where the proving files come from. The deployment manifest names them, so a
 * site built for one deployment cannot prove with another ceremony's files;
 * VITE_CIRCUITS_URL still overrides, and the local chain serves /circuits/.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import amoy from './deployments/amoy.json';

vi.mock('./contracts', () => ({ getElection: () => ({}), getReadProvider: () => ({}) }));
vi.mock('./semaphore', () => ({ fetchElectionGroup: async () => ({}) }));

async function freshCircuitFiles() {
  vi.resetModules();
  return (await import('./ballot')).circuitFiles;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('circuitFiles', () => {
  it("reads the manifest's URL for its network, or /circuits/ without one", async () => {
    vi.stubEnv('VITE_CHAIN_NETWORK', 'amoy');
    vi.stubEnv('VITE_CIRCUITS_URL', '');
    const circuitFiles = await freshCircuitFiles();
    const published = (amoy as { circuits?: { url: string } }).circuits?.url;
    expect(circuitFiles('ballot', 5)).toEqual({
      wasm: `${published ?? '/circuits'}/ballot_s5.wasm`,
      zkey: `${published ?? '/circuits'}/ballot_s5.zkey`,
    });
  });

  it('lets VITE_CIRCUITS_URL override, trailing slash or not', async () => {
    vi.stubEnv('VITE_CIRCUITS_URL', 'https://files.example/ceremony-1/');
    const circuitFiles = await freshCircuitFiles();
    expect(circuitFiles('tally', 9).zkey).toBe('https://files.example/ceremony-1/tally_s9.zkey');
  });

  it('serves /circuits/ on a network whose manifest publishes none', async () => {
    vi.stubEnv('VITE_CHAIN_NETWORK', 'nowhere');
    vi.stubEnv('VITE_CIRCUITS_URL', '');
    const circuitFiles = await freshCircuitFiles();
    expect(circuitFiles('ballot', 9).wasm).toBe('/circuits/ballot_s9.wasm');
  });
});
