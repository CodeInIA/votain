import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FeeData, JsonRpcProvider, Wallet } from 'ethers';

import { chainProvider, resetChainClients, submitInTurn } from './signer.js';

/**
 * Two voters in the same second used to be handed the same nonce, and one of
 * them was told their enrolment failed. What is pinned here is the ordering:
 * submissions signed with one key run one at a time, in arrival order, and a
 * failed one does not block the queue behind it.
 */
beforeEach(() => {
  process.env.CHAIN_RPC_URL = 'http://127.0.0.1:1';
  process.env.TEST_SIGNER_KEY = Wallet.createRandom().privateKey;
  resetChainClients();
});

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('submitInTurn', () => {
  test('runs submissions for one key one at a time, in arrival order', async () => {
    const log: string[] = [];
    const job = (name: string, ms: number) => async () => {
      log.push(`${name}:start`);
      await pause(ms);
      log.push(`${name}:end`);
      return name;
    };

    const results = await Promise.all([
      submitInTurn('TEST_SIGNER_KEY', job('a', 20)),
      submitInTurn('TEST_SIGNER_KEY', job('b', 1)),
      submitInTurn('TEST_SIGNER_KEY', job('c', 1)),
    ]);

    assert.deepEqual(results, ['a', 'b', 'c']);
    assert.deepEqual(log, ['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  test('a failed submission is reported and does not stall the next', async () => {
    const failing = submitInTurn('TEST_SIGNER_KEY', async () => {
      throw new Error('reverted');
    });
    const next = submitInTurn('TEST_SIGNER_KEY', async () => 'ok');

    await assert.rejects(failing, /reverted/);
    assert.equal(await next, 'ok');
  });

  test('refuses a key that is not configured', async () => {
    await assert.rejects(submitInTurn('NOT_A_CONFIGURED_KEY', async () => 1), /not configured/);
  });
});

/**
 * Amoy's fee suggestion follows a few bots paying 279 gwei in empty blocks.
 * Taken as given, the relayer could not front one ballot on its float and was
 * reimbursed at the paymaster's 50 gwei for what it paid at 279.
 */
describe('chainProvider fees', () => {
  const gwei = (n: number) => BigInt(n) * 1_000_000_000n;

  function stubChain(t: import('node:test').TestContext, tip: bigint, base: bigint) {
    t.mock.method(JsonRpcProvider.prototype, 'getFeeData', async () => new FeeData(base + tip, base * 2n + tip, tip));
    t.mock.method(JsonRpcProvider.prototype, 'getBlock', async () => ({ baseFeePerGas: base }));
  }

  test('caps a spiked tip at 50 gwei by default', async t => {
    stubChain(t, gwei(279), 1n);
    const fees = await chainProvider().getFeeData();
    assert.equal(fees.maxPriorityFeePerGas, gwei(50));
    assert.equal(fees.maxFeePerGas, 2n + gwei(50));
    assert.equal(fees.gasPrice, 1n + gwei(50));
  });

  test('leaves a normal suggestion alone', async t => {
    stubChain(t, gwei(30), 7n);
    const fees = await chainProvider().getFeeData();
    assert.equal(fees.maxPriorityFeePerGas, gwei(30));
    assert.equal(fees.maxFeePerGas, 14n + gwei(30));
  });

  test('takes its ceiling from CHAIN_MAX_TIP_GWEI', async t => {
    process.env.CHAIN_MAX_TIP_GWEI = '80';
    t.after(() => delete process.env.CHAIN_MAX_TIP_GWEI);
    stubChain(t, gwei(279), 0n);
    assert.equal((await chainProvider().getFeeData()).maxPriorityFeePerGas, gwei(80));
  });
});
