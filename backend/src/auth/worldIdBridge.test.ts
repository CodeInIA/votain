import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  verificationRequest,
  startPendingVerification,
  readPendingVerification,
  endPendingVerification,
  resetPendingVerifications,
  PENDING_TTL_MS,
  type BridgeRequest,
} from './worldIdBridge.js';

/**
 * A World ID verification that outlives the tab that started one.
 *
 * THE BUG. Verifying on a phone means leaving for World App, and a
 * backgrounded tab is something the system is free to discard. The page that
 * comes back is a cold start, and the request — whose bridge key lives inside
 * the SDK's WASM, with no way to rebuild it from its id — went with it. A
 * verification that had ALREADY SUCCEEDED was thrown away by the reload, and
 * the voter was shown the sign-in screen again.
 *
 * So it is held here instead. These pin the two things that has to get right:
 * WHAT is asked for, which moved from the browser along with the request and
 * would otherwise now be tested nowhere; and what becomes of a verification
 * over its life, in particular that a confirmed one is still collectable after
 * the poll ends (the reload arrives precisely then) and is gone after it is
 * collected once (the proof is a bearer credential).
 */

const RESULT = { protocol_version: '3.0', nonce: 'n', responses: [] } as never;

/** A bridge request that settles when the test says so. */
function fakeBridge(): BridgeRequest & { confirm: () => void; fail: () => void } {
  let settle!: (v: { success: true; result: never } | { success: false; error: unknown }) => void;
  const done = new Promise<
    { success: true; result: never } | { success: false; error: unknown }
  >(resolve => {
    settle = resolve;
  });
  return {
    connectorURI: 'https://world.org/verify?t=wld&i=fake&k=fake',
    pollUntilCompletion: () => done,
    confirm: () => settle({ success: true, result: RESULT }),
    fail: () => settle({ success: false, error: 'user_rejected' }),
  };
}

const start = (returnTo?: string) =>
  startPendingVerification('vote-registration', returnTo, () => Promise.resolve(bridge));
let bridge: ReturnType<typeof fakeBridge>;

beforeEach(() => {
  resetPendingVerifications();
  bridge = fakeBridge();
});

afterEach(() => {
  resetPendingVerifications();
  mock.timers.reset();
});

describe('what the voter is asked to prove', () => {
  const RP = { rp_id: 'rp_x', nonce: 'n', created_at: 1, expires_at: 2, signature: '0x' };

  /**
   * World ID 4.0 knows four credentials and no device level, and in Spain a
   * voter can hold none of them: Orbs withdrawn, neither document check
   * launched here, selfie access-gated. Cutting over today would lock out very
   * nearly every voter, so the legacy preset stays and this says so out loud.
   */
  test('still accepts a 3.0 proof, because 4.0 offers Spain nothing to hold', () => {
    assert.equal(verificationRequest('vote-registration', RP).config.allow_legacy_proofs, true);
  });

  /**
   * The floor, deliberately. Asking for more at the door would turn away the
   * voters this exists for; an election that needs an Orb asks at ENROLMENT,
   * where a refusal costs one election rather than the whole account.
   */
  test('asks for the lowest credential, not for personhood', () => {
    assert.equal(verificationRequest('vote-registration', RP).preset, 'deviceLegacy');
  });

  test('carries the action and the RP context it was signed for', () => {
    const { config } = verificationRequest('recover-identity', RP);
    assert.equal(config.action, 'recover-identity');
    assert.deepEqual(config.rp_context, RP);
  });

  /**
   * The way back. Without it a voter finishes in World App and is left there,
   * and plenty read a green tick as "done" and never return to the browser.
   */
  test('asks World App to send a phone back where it came from', () => {
    const { config } = verificationRequest('vote-registration', RP, 'https://votain.app/voter/onboarding');
    assert.equal(
      (config as { return_to?: string }).return_to,
      'https://votain.app/voter/onboarding',
    );
  });

  /**
   * A desktop sends none, because the QR is scanned by a PHONE: telling that
   * phone to open this page opens a second copy of the app on the wrong
   * screen while the real one waits on the desk. The browser decides, so the
   * absence has to survive all the way down rather than become an empty
   * string World App might still act on.
   */
  test('leaves the field out entirely when there is nowhere to send anyone', () => {
    const { config } = verificationRequest('vote-registration', RP);
    assert.ok(!('return_to' in config));
  });
});

describe('a verification in flight', () => {
  test('is waiting, and says where to send the voter', async () => {
    const { pendingId, connectorURI } = await start();
    assert.equal(connectorURI, bridge.connectorURI);

    const state = await readPendingVerification(pendingId);
    assert.deepEqual(state, { status: 'waiting', connectorURI: bridge.connectorURI });
  });

  test('is nobody else\'s, however they ask', async () => {
    await start();
    assert.equal(await readPendingVerification('deadbeef'), undefined);
    assert.equal(await readPendingVerification(undefined), undefined);
  });

  test('hands over the proof once the bridge answers', async () => {
    const { pendingId } = await start();
    bridge.confirm();

    const state = await readPendingVerification(pendingId, 1_000);
    assert.deepEqual(state, { status: 'confirmed', result: RESULT });
  });

  /**
   * THE WHOLE POINT. The reload lands in the window between World App
   * answering and the voter walking back to the browser, so the proof has to
   * still be here when a page that remembers nothing finally asks for it.
   */
  test('is still collectable after the poll has ended, which is when the reload arrives', async () => {
    const { pendingId } = await start();
    bridge.confirm();
    // Settle the poll and let its `.then` run, as a reload would.
    await readPendingVerification(pendingId, 1_000);

    const again = await readPendingVerification(pendingId);
    assert.deepEqual(again, { status: 'confirmed', result: RESULT });
  });

  /**
   * The proof is a bearer credential: whoever presents it to `/verify-human`
   * is signed in as that human. So it is given out once and forgotten, and a
   * cookie that leaks afterwards is worth nothing.
   */
  test('is gone once it has been collected', async () => {
    const { pendingId } = await start();
    bridge.confirm();
    await readPendingVerification(pendingId, 1_000);

    endPendingVerification(pendingId);
    assert.equal(await readPendingVerification(pendingId), undefined);
  });

  test('reports a refusal rather than waiting out the clock', async () => {
    const { pendingId } = await start();
    bridge.fail();
    assert.deepEqual(await readPendingVerification(pendingId, 1_000), {
      status: 'failed',
      error: 'user_rejected',
    });
  });

  test('is dropped once it has run out', async () => {
    mock.timers.enable({ apis: ['Date'] });
    const { pendingId } = await start();
    assert.notEqual(await readPendingVerification(pendingId), undefined);

    mock.timers.tick(PENDING_TTL_MS + 1);
    assert.equal(await readPendingVerification(pendingId), undefined);
  });

  test('gives each one an unguessable name of its own', async () => {
    const a = await start();
    bridge = fakeBridge();
    const b = await start();

    assert.notEqual(a.pendingId, b.pendingId);
    // 32 bytes. A name that can be guessed is a proof that can be stolen.
    assert.match(a.pendingId, /^[0-9a-f]{64}$/);
  });

  /**
   * The long hold is what makes this affordable: a one-second poll for five
   * minutes is three hundred requests against a backend that allows 120 a
   * minute. It has to return EARLY when the answer arrives, or it is just a
   * slower poll.
   */
  test('answers the moment the bridge does, without waiting out the hold', async () => {
    const { pendingId } = await start();
    setTimeout(() => bridge.confirm(), 10);

    const began = Date.now();
    const state = await readPendingVerification(pendingId, 10_000);
    assert.equal(state?.status, 'confirmed');
    assert.ok(Date.now() - began < 5_000, 'held the connection past the answer');
  });

  test('gives up holding when nothing happens, so the caller can ask again', async () => {
    const { pendingId } = await start();
    const state = await readPendingVerification(pendingId, 50);
    assert.equal(state?.status, 'waiting');
  });
});
