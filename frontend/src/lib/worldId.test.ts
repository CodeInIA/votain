import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  requestWorldIdProof,
  resumeWorldIdProof,
  waitForWorldIdProof,
  cancelWorldIdProof,
} from './worldId';

/**
 * Picking a verification back up after the page that started it stopped
 * existing.
 *
 * Verifying on a phone means leaving for World App, and a backgrounded tab is
 * something the system is free to discard. This file used to hold the live
 * bridge request in a module variable, so the reload threw away a verification
 * that had ALREADY SUCCEEDED and showed the voter the sign-in screen again.
 * The request lives on the server now, named by an httpOnly cookie the browser
 * resends on its own, and this is what it takes for a page that remembers
 * nothing to find it.
 *
 * WHAT MOVED OUT OF HERE. Two tests pinned which credential the voter is asked
 * for. That decision moved to the backend with the request, and so did they:
 * see `backend/src/auth/worldIdBridge.test.ts`. They are not gone.
 */

vi.mock('./backend', () => ({ backendBase: () => 'https://emisor.test' }));

const PRUEBA = { protocol_version: '3.0', nonce: 'n', responses: [] } as never;

/** Every call made, so a test can check the shape and not only the outcome. */
let llamadas: Array<{ url: string; init?: RequestInit }> = [];
/** Queued replies, taken one per call; the last one repeats. */
let respuestas: unknown[] = [];

beforeEach(() => {
  llamadas = [];
  respuestas = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    const body = respuestas.length > 1 ? respuestas.shift() : respuestas[0];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('resuming a verification the page does not remember starting', () => {
  it('hands back a proof that finished while the tab was gone', async () => {
    respuestas = [{ status: 'confirmed', result: PRUEBA }];
    expect(await resumeWorldIdProof()).toEqual({ kind: 'proof', result: PRUEBA });
  });

  /**
   * Not the same as having nothing, and the page acts differently on each: one
   * puts the QR back and keeps waiting, the other shows the button. Collapsing
   * them into a boolean is how a voter mid-verification gets told to start one.
   */
  it('reports one still running, and where it was sending the voter', async () => {
    respuestas = [{ status: 'waiting', connectorURI: 'https://world.org/verify?i=x' }];
    expect(await resumeWorldIdProof()).toEqual({
      kind: 'waiting',
      connectorURI: 'https://world.org/verify?i=x',
    });
  });

  it('reports nothing when there is nothing', async () => {
    respuestas = [{ status: 'none' }];
    expect(await resumeWorldIdProof()).toEqual({ kind: 'none' });
  });

  /**
   * This runs on mount. A page coming up is the worst moment to turn a network
   * hiccup into an error, and "nothing pending" is the safe thing to believe:
   * the voter is shown the button, which is where they were anyway.
   */
  it('says nothing rather than throwing when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    await expect(resumeWorldIdProof()).resolves.toEqual({ kind: 'none' });
  });

  /** Does not hold a connection: a page must draw itself before it waits. */
  it('asks once and does not wait', async () => {
    respuestas = [{ status: 'waiting', connectorURI: 'x' }];
    await resumeWorldIdProof();
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).not.toContain('wait');
  });
});

describe('waiting for one', () => {
  /**
   * The hold is what makes this affordable. A one-second poll for five minutes
   * is three hundred requests against a backend that allows 120 a minute, so
   * the server holds each request open and answers the instant the bridge
   * does. A `waiting` reply means the hold ran out, not that anything is
   * wrong, so the only right response is to ask again.
   */
  it('asks again when a hold runs out, and stops when the proof arrives', async () => {
    respuestas = [
      { status: 'waiting', connectorURI: 'x' },
      { status: 'waiting', connectorURI: 'x' },
      { status: 'confirmed', result: PRUEBA },
    ];

    expect(await waitForWorldIdProof()).toEqual(PRUEBA);
    expect(llamadas).toHaveLength(3);
    expect(llamadas.every(l => l.url.includes('wait=1'))).toBe(true);
  });

  /**
   * A refusal and an expiry are not errors to raise at the voter: both mean
   * there is nothing left to wait for. Looping on either is an infinite poll.
   */
  it('gives up on a refusal instead of asking forever', async () => {
    respuestas = [{ status: 'failed', error: 'user_rejected' }];
    expect(await waitForWorldIdProof()).toBeNull();
    expect(llamadas).toHaveLength(1);
  });

  it('gives up when the verification is no longer there', async () => {
    respuestas = [{ status: 'none' }];
    expect(await waitForWorldIdProof()).toBeNull();
  });

  it('stops when the screen it was drawn on goes away', async () => {
    const abort = new AbortController();
    abort.abort();
    respuestas = [{ status: 'waiting', connectorURI: 'x' }];

    expect(await waitForWorldIdProof(abort.signal)).toBeNull();
    expect(llamadas).toHaveLength(0);
  });
});

describe('opening one', () => {
  it('shows the connector URI as soon as the server has one', async () => {
    respuestas = [{ connectorURI: 'https://world.org/verify?i=nuevo' }, { status: 'none' }];
    const visto: string[] = [];

    await requestWorldIdProof({ onConnectorUri: uri => visto.push(uri) });

    expect(visto).toEqual(['https://world.org/verify?i=nuevo']);
    expect(llamadas[0].init?.method).toBe('POST');
  });

  /**
   * The cookie naming the verification is httpOnly, so it is the only thing
   * tying this browser to its own proof. A request that forgets to send it
   * opens a verification nobody can ever collect.
   */
  it('sends the cookie on every call, or the proof belongs to nobody', async () => {
    respuestas = [{ connectorURI: 'x' }, { status: 'confirmed', result: PRUEBA }];
    await requestWorldIdProof();
    await cancelWorldIdProof();

    expect(llamadas.length).toBeGreaterThan(1);
    expect(llamadas.every(l => l.init?.credentials === 'include')).toBe(true);
  });

  it('carries an action override, since each one yields its own nullifier', async () => {
    respuestas = [{ connectorURI: 'x' }, { status: 'none' }];
    await requestWorldIdProof({ action: 'recover-identity' });

    expect(JSON.parse(llamadas[0].init?.body as string)).toEqual({ action: 'recover-identity' });
  });

  it('abandons one on request, so a reload does not put its QR straight back', async () => {
    respuestas = [{ success: true }];
    await cancelWorldIdProof();
    expect(llamadas[0].init?.method).toBe('DELETE');
  });
});
