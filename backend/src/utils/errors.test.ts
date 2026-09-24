import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { chainFailure, clientMessage } from './errors.js';

describe('what a client is told about a failed transaction', () => {
  test('the revert name, when ethers decoded one', () => {
    assert.equal(chainFailure({ revert: { name: 'AlreadyEnrolled' } }), 'reverted: AlreadyEnrolled');
  });

  test('the selector, which the browser can still name', () => {
    assert.equal(
      chainFailure({ code: 'CALL_EXCEPTION', data: '0x6BA214A7' + '00'.repeat(32) }),
      'reverted: data="0x6ba214a7"',
    );
  });

  test('never the provider text, which can carry the RPC URL and its key', () => {
    const leaky = Object.assign(new Error('could not coalesce error (url=https://rpc.example/v2/SECRET)'), {
      code: 'SERVER_ERROR',
    });
    assert.equal(clientMessage(leaky), 'transaction failed');
    assert.ok(!clientMessage(leaky).includes('SECRET'));
  });

  test("this server's own words pass through", () => {
    assert.equal(clientMessage(new Error('election must be a valid address')), 'election must be a valid address');
  });
});
