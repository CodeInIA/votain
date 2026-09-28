import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';

import { resetChainClients, submitInTurn } from './signer.js';

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
