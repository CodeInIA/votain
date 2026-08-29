import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { verifyWorldIdProof } from './worldId.js';

/**
 * The hole these cover: the route called the verify API, checked only that it
 * returned 200, and took the nullifier. The API confirms a proof is VALID, not
 * that it is the credential the app asked for, so a device-level or selfie
 * proof verified and was accepted exactly like an Orb.
 *
 * `ElectionV4.enroll` deduplicates on that nullifier and treats it as one
 * human. Only Proof of Human carries that guarantee, so a weaker credential
 * silently turned one-person-one-vote into one-account-one-vote.
 */

const ORIGINAL_FETCH = globalThis.fetch;

/** Stands in for the verify API, recording whether it was called at all. */
function stubApi(status: number, body: unknown) {
  const calls: unknown[] = [];
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    calls.push(init?.body ? JSON.parse(init.body) : null);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  }) as unknown as typeof fetch;
  return calls;
}

beforeEach(() => {
  process.env.WORLD_ID_RP_ID = 'rp_test';
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  mock.reset();
});

describe('verifyWorldIdProof, credential level', () => {
  test('accepts a World ID 4.0 Proof of Human', async () => {
    stubApi(200, {
      success: true,
      results: [{ identifier: 'proof_of_human', success: true, nullifier: '0xorb' }],
    });

    const result = await verifyWorldIdProof({
      responses: [{ identifier: 'proof_of_human', issuer_schema_id: 1, nullifier: '0xorb' }],
    });

    assert.equal(result.ok, true);
    assert.equal(result.nullifier, '0xorb');
  });

  test('accepts a legacy 3.0 orb proof, which carries no schema id', async () => {
    stubApi(200, { success: true, results: [{ identifier: 'orb', success: true, nullifier: '0xlegacy' }] });

    const result = await verifyWorldIdProof({
      responses: [{ identifier: 'orb', nullifier: '0xlegacy' }],
    });

    assert.equal(result.ok, true);
    assert.equal(result.nullifier, '0xlegacy');
  });

  test('rejects a device-level proof, and does not even call the API', async () => {
    const calls = stubApi(200, { success: true, nullifier: '0xdevice' });

    const result = await verifyWorldIdProof({
      responses: [{ identifier: 'device', nullifier: '0xdevice' }],
    });

    assert.equal(result.ok, false);
    assert.equal(result.nullifier, undefined);
    // Refused on our side: the level is ours to demand, and spending the call
    // would only invite treating a 200 as an answer to a question we did not ask.
    assert.equal(calls.length, 0);
  });

  test('rejects a selfie proof', async () => {
    stubApi(200, { success: true, nullifier: '0xselfie' });
    const result = await verifyWorldIdProof({
      responses: [{ identifier: 'selfie', issuer_schema_id: 11, nullifier: '0xselfie' }],
    });
    assert.equal(result.ok, false);
  });

  test('rejects a document proof, which is unique per document but not per human', async () => {
    stubApi(200, { success: true, nullifier: '0xdoc' });
    const result = await verifyWorldIdProof({
      responses: [{ identifier: 'passport', issuer_schema_id: 9303, nullifier: '0xdoc' }],
    });
    assert.equal(result.ok, false);
  });

  test('trusts the schema id over the identifier when they disagree', async () => {
    // A caller labelling a selfie credential "orb" must not get in on the label.
    stubApi(200, { success: true, nullifier: '0xliar' });
    const result = await verifyWorldIdProof({
      responses: [{ identifier: 'orb', issuer_schema_id: 11, nullifier: '0xliar' }],
    });
    assert.equal(result.ok, false);
  });

  test('rejects a payload that mixes an Orb proof with a weaker one', async () => {
    // A 200 means "at least one verified", so accepting on the strength of the
    // Orb entry would let the weaker one ride along.
    const calls = stubApi(200, {
      success: true,
      results: [{ identifier: 'proof_of_human', success: true, nullifier: '0xorb' }],
    });

    const result = await verifyWorldIdProof({
      responses: [
        { identifier: 'proof_of_human', issuer_schema_id: 1, nullifier: '0xorb' },
        { identifier: 'device', nullifier: '0xdevice' },
      ],
    });

    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
  });

  test('rejects an empty payload', async () => {
    stubApi(200, { success: true });
    assert.equal((await verifyWorldIdProof({})).ok, false);
    assert.equal((await verifyWorldIdProof({ responses: [] })).ok, false);
  });
});

describe('verifyWorldIdProof, reading the API answer', () => {
  test('takes the nullifier of the entry that verified, not the first sent', async () => {
    stubApi(200, {
      success: true,
      results: [
        { identifier: 'proof_of_human', success: false, nullifier: '0xfailed' },
        { identifier: 'proof_of_human', success: true, nullifier: '0xpassed' },
      ],
    });

    const result = await verifyWorldIdProof({
      responses: [
        { identifier: 'proof_of_human', issuer_schema_id: 1, nullifier: '0xfailed' },
        { identifier: 'proof_of_human', issuer_schema_id: 1, nullifier: '0xpassed' },
      ],
    });

    assert.equal(result.ok, true);
    assert.equal(result.nullifier, '0xpassed');
  });

  test('falls back to the top-level nullifier when results are not itemised', async () => {
    stubApi(200, { success: true, nullifier: '0xtop' });
    const result = await verifyWorldIdProof({
      responses: [{ identifier: 'orb', nullifier: '0xsent' }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.nullifier, '0xtop');
  });

  test('propagates a rejection from the API', async () => {
    stubApi(400, { success: false, code: 'invalid_proof', detail: 'nope' });
    const result = await verifyWorldIdProof({
      responses: [{ identifier: 'orb', nullifier: '0xorb' }],
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.error, { success: false, code: 'invalid_proof', detail: 'nope' });
  });

  test('fails when nothing carries a nullifier', async () => {
    stubApi(200, { success: true, results: [] });
    const result = await verifyWorldIdProof({
      responses: [{ identifier: 'orb' }, { identifier: 'orb' }],
    });
    assert.equal(result.ok, false);
  });
});
