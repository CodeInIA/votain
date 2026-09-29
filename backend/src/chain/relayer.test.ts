import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { FeeData } from 'ethers';

import { isVoteCall, relayFees, withMargin } from './relayer.js';

/**
 * The shape check `/relay/vote` runs before simulating anything.
 *
 * The endpoint is public by design (a session would tell this server who cast
 * which ballot), so it is the one place a stranger's body reaches the relayer.
 * Whether a ballot is VALID is the chain's call; what this has to hold is that
 * nothing oversized or malformed gets as far as costing a simulation.
 */

const points = (n: number) => Array.from({ length: 2 * n }, (_, i) => String(i + 1));

function call(overrides: Record<string, unknown> = {}, ballot: Record<string, unknown> = {}) {
  return {
    election: '0x0000000000000000000000000000000000000001',
    ballot: {
      votersRoot: '1',
      ballotsRoot: '0',
      epoch: '480000',
      tag: '12345',
      epochTag: '67890',
      leaf: '42',
      voteA: ['1', '2'],
      voteB: points(5),
      cancelA: ['3', '4'],
      cancelB: points(5),
      ...ballot,
    },
    proof: { a: ['1', '2'], b: [['3', '4'], ['5', '6']], c: ['7', '8'] },
    ...overrides,
  };
}

describe('a relayed ballot', () => {
  test('passes when shaped like one', () => {
    assert.equal(isVoteCall(call()), true);
    assert.equal(isVoteCall(call({}, { voteB: points(51), cancelB: points(51) })), true);
  });

  test('is refused with anything missing', () => {
    assert.equal(isVoteCall(undefined), false);
    assert.equal(isVoteCall({}), false);
    assert.equal(isVoteCall(call({ proof: undefined })), false);
    assert.equal(isVoteCall(call({}, { tag: undefined })), false);
  });

  test('is refused with numbers that are not decimal strings of a field element', () => {
    assert.equal(isVoteCall(call({}, { tag: 12345 })), false);
    assert.equal(isVoteCall(call({}, { tag: '0x3039' })), false);
    assert.equal(isVoteCall(call({}, { tag: '-1' })), false);
    assert.equal(isVoteCall(call({}, { tag: '9'.repeat(79) })), false);
  });

  test('is refused when a point list is larger than the largest circuit', () => {
    assert.equal(isVoteCall(call({}, { voteB: points(52) })), false);
    assert.equal(isVoteCall(call({}, { cancelB: [] })), false);
    assert.equal(isVoteCall(call({}, { voteA: ['1'] })), false);
  });

  test('is refused with a proof of the wrong shape', () => {
    assert.equal(isVoteCall(call({ proof: { a: ['1', '2'], b: [['3', '4']], c: ['7', '8'] } })), false);
    assert.equal(isVoteCall(call({ proof: { a: ['1'], b: [['3', '4'], ['5', '6']], c: ['7', '8'] } })), false);
  });
});

/**
 * Two enrolments on Amoy ran out of gas with the whole estimated limit spent:
 * ethers estimated at a gas price of zero, where the paymaster skips paying the
 * relayer back, and the real price takes the longer path. The relay now fixes
 * its fees first, estimates with them, and adds a margin.
 */
describe('relay pricing', () => {
  const gwei = (n: number) => BigInt(n) * 1_000_000_000n;
  const signerWith = (data: FeeData) => ({ provider: { getFeeData: async () => data } });

  test('estimates with the EIP-1559 fees the transaction will carry', async () => {
    const fees = await relayFees(signerWith(new FeeData(gwei(30), gwei(50), gwei(50))));
    assert.deepEqual(fees, { maxFeePerGas: gwei(50), maxPriorityFeePerGas: gwei(50) });
  });

  test('falls back to a legacy gas price where the chain has no EIP-1559 fees', async () => {
    const fees = await relayFees(signerWith(new FeeData(gwei(30), null, null)));
    assert.deepEqual(fees, { gasPrice: gwei(30) });
  });

  test('refuses to price a relay with no provider', async () => {
    await assert.rejects(relayFees({ provider: null }));
  });

  test('adds a quarter to the estimate', () => {
    assert.equal(withMargin(281_878n), 352_347n);
    assert.equal(withMargin(100n), 125n);
  });
});
