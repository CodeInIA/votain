import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Whether the chain still knows the voter this browser is signed in as.
 *
 * The bug this pins: restarting the local chain (or deploying the platform
 * somewhere else) leaves the registry empty while the session cookie stays
 * valid for its seven days. Reloading the page did not notice, so the voter
 * kept a history, an enrol button, and a first sign of trouble that arrived as
 * `NotPlatformVerified` from a contract.
 */

const registry = {
  registeredNullifiers: vi.fn(),
  commitmentOf: vi.fn(),
};
let configured = true;

vi.mock('./contracts', () => ({ getRegistry: () => registry }));
vi.mock('./deployments', () => ({ isChainConfigured: () => configured }));

const { checkPlatformMembership } = await import('./platformMembership');

const NULLIFIER = '98765432109876543210';
const MINE = 12345n;

beforeEach(() => {
  configured = true;
  registry.registeredNullifiers.mockReset();
  registry.commitmentOf.mockReset();
});

describe('checkPlatformMembership', () => {
  it('confirms a human the registry holds under this very identity', async () => {
    registry.registeredNullifiers.mockResolvedValue(true);
    registry.commitmentOf.mockResolvedValue(MINE);

    expect(await checkPlatformMembership(NULLIFIER, MINE)).toBe('registered');
  });

  it('reports a human the registry has never heard of', async () => {
    // The wiped chain, which is every local restart.
    registry.registeredNullifiers.mockResolvedValue(false);

    expect(await checkPlatformMembership(NULLIFIER, MINE)).toBe('not-registered');
    expect(registry.commitmentOf).not.toHaveBeenCalled();
  });

  it('reports an identity this browser cannot produce', async () => {
    // Rotated from another device, or a stale copy here. The session is fine;
    // this device is the problem.
    registry.registeredNullifiers.mockResolvedValue(true);
    registry.commitmentOf.mockResolvedValue(999n);

    expect(await checkPlatformMembership(NULLIFIER, MINE)).toBe('other-identity');
  });

  it('accepts a registered human while this browser holds no identity yet', async () => {
    // Signing in and setting up are two steps, and between them a voter is
    // legitimately registered with nothing cached here.
    registry.registeredNullifiers.mockResolvedValue(true);
    registry.commitmentOf.mockResolvedValue(MINE);

    expect(await checkPlatformMembership(NULLIFIER, null)).toBe('registered');
  });

  it('says nothing when the chain cannot answer', async () => {
    // A node that is down must never end a working session.
    registry.registeredNullifiers.mockRejectedValue(new Error('connection refused'));

    expect(await checkPlatformMembership(NULLIFIER, MINE)).toBe('unknown');
  });

  it('says nothing when there is no chain configured at all', async () => {
    configured = false;

    expect(await checkPlatformMembership(NULLIFIER, MINE)).toBe('unknown');
    expect(registry.registeredNullifiers).not.toHaveBeenCalled();
  });
});
