/**
 * The manifest is the default and the environment is the override.
 *
 * The bug this guards against is not a crash: it is a backend that keeps
 * calling the addresses of a deployment that no longer exists, which surfaces
 * as `BAD_DATA: could not decode result data (value="0x")` from a call to an
 * address with no code, three layers away from the cause.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { addressSource, contractAddress, refreshManifests } from './deployments.js';

const KEPT = {
  REGISTRY_ADDRESS: process.env.REGISTRY_ADDRESS,
  PAYMASTER_ADDRESS: process.env.PAYMASTER_ADDRESS,
  CHAIN_NETWORK: process.env.CHAIN_NETWORK,
};

beforeEach(() => {
  delete process.env.REGISTRY_ADDRESS;
  delete process.env.PAYMASTER_ADDRESS;
  delete process.env.CHAIN_NETWORK;
  refreshManifests();
});

afterEach(() => {
  for (const [k, v] of Object.entries(KEPT)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  refreshManifests();
});

describe('contract address resolution', () => {
  it('reads the manifest when the environment says nothing', () => {
    const found = contractAddress('PlatformRegistry', 'REGISTRY_ADDRESS');
    // Only meaningful where a manifest exists; a checkout with none is a valid
    // state and the resolver is expected to say so rather than invent one.
    if (found === undefined) {
      assert.equal(addressSource('REGISTRY_ADDRESS'), 'unset');
      return;
    }
    assert.match(found, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(addressSource('REGISTRY_ADDRESS'), 'manifest');
  });

  it('lets the environment win, which is how production supplies it', () => {
    const override = '0x' + '11'.repeat(20);
    process.env.REGISTRY_ADDRESS = override;
    assert.equal(contractAddress('PlatformRegistry', 'REGISTRY_ADDRESS'), override);
    assert.equal(addressSource('REGISTRY_ADDRESS'), 'environment');
  });

  it('returns undefined for a contract no manifest names', () => {
    assert.equal(contractAddress('NoSuchContract', 'NO_SUCH_ADDRESS'), undefined);
  });

  it('refuses to guess when asked for a network that is not deployed', () => {
    // Choosing the wrong chain's addresses fails exactly like the stale-address
    // bug, and would be harder to see because everything would look configured.
    process.env.CHAIN_NETWORK = 'a-network-that-does-not-exist';
    assert.equal(contractAddress('PlatformRegistry', 'REGISTRY_ADDRESS'), undefined);
  });
});
