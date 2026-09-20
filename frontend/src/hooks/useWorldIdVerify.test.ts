import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * What the sign-in screen does when it comes up and finds a verification it
 * does not remember starting.
 *
 * THE BUG. On a phone, verifying means leaving for World App, and a
 * backgrounded tab is something the system is free to discard. The voter
 * approves, comes back, and the page is a cold start: the request is gone and
 * they are asked to prove who they are again, having just done exactly that.
 * The request now lives on the server behind an httpOnly cookie, so the answer
 * is waiting — but only if this hook asks for it.
 *
 * Three outcomes, three behaviours, and each one is wrong in a different way
 * if it is confused with another: signing them in, putting the QR back, and
 * doing nothing at all. The last is the common case and has to stay invisible.
 *
 * WHAT THESE DO NOT COVER, said plainly rather than papered over. The first
 * version of this hook aborted its own in-flight resume in the effect cleanup
 * and left its once-only guard set, so StrictMode's mount-unmount-mount left
 * the verification never picked up at all: "at most once" had become "never".
 * Every test in this file passed while that was true. A browser is what found
 * it — the server answered `waiting` and the page went on showing the welcome
 * slide.
 *
 * It cannot be reproduced here, and that was measured rather than assumed: a
 * `StrictMode` wrapper around `renderHook` mounts effects ONCE in this
 * environment (counted: 1 mount, 0 cleanups), and mounting the hook twice by
 * hand gives each copy its own refs, which is exactly what StrictMode does
 * not do. A test that passes either way is worse than no test, so there is
 * none, and the last case below pins the thing that IS observable: the resume
 * belongs to the mount, not to the render.
 */

const { navegar, resumen, esperar, sellado } = vi.hoisted(() => ({
  navegar: vi.fn(),
  resumen: vi.fn(),
  esperar: vi.fn(),
  sellado: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navegar }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ setVoterLoggedIn: vi.fn() }),
}));
vi.mock('../lib/deviceSeal', () => ({ sealOnDevice: sellado }));
vi.mock('../lib/backend', () => ({ backendUrl: (p: string) => `https://emisor.test${p}` }));
vi.mock('../lib/worldId', () => ({
  resumeWorldIdProof: resumen,
  waitForWorldIdProof: esperar,
  requestWorldIdProof: vi.fn(),
  cancelWorldIdProof: vi.fn(),
}));

const { useWorldIdVerify } = await import('./useWorldIdVerify');

const PRUEBA = { protocol_version: '3.0', nonce: 'n', responses: [] } as never;

/** Every URL posted to, so "the proof was spent once" can be counted. */
let entregas: string[] = [];

beforeEach(() => {
  navegar.mockReset();
  resumen.mockReset();
  esperar.mockReset();
  sellado.mockReset().mockResolvedValue(undefined);
  entregas = [];
  vi.stubGlobal('fetch', (url: string) => {
    entregas.push(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ nullifier: '0xabc' }) });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('coming back to a sign-in screen mid-verification', () => {
  /**
   * The whole point. The voter already proved who they are; being shown the
   * button again is the single worst moment to ask them to start over.
   */
  it('signs the voter in with a proof that finished while the tab was gone', async () => {
    resumen.mockResolvedValue({ kind: 'proof', result: PRUEBA });
    renderHook(() => useWorldIdVerify());

    await waitFor(() => expect(navegar).toHaveBeenCalledWith('/voter/identity', { replace: true }));
  });

  /**
   * Still running is NOT the same as finished, and not the same as nothing.
   * Showing the button here would abandon a verification that is about to
   * succeed; navigating would sign somebody in on no proof at all.
   */
  it('puts the QR back and rejoins the wait when one is still running', async () => {
    resumen.mockResolvedValue({ kind: 'waiting', connectorURI: 'https://world.org/verify?i=x' });
    esperar.mockReturnValue(new Promise(() => { /* still out there */ }));

    const { result } = renderHook(() => useWorldIdVerify());

    await waitFor(() => expect(result.current.connectorURI).toBe('https://world.org/verify?i=x'));
    expect(result.current.isVerifying).toBe(true);
    expect(navegar).not.toHaveBeenCalled();
  });

  it('finishes a resumed verification once it answers', async () => {
    resumen.mockResolvedValue({ kind: 'waiting', connectorURI: 'x' });
    esperar.mockResolvedValue(PRUEBA);

    renderHook(() => useWorldIdVerify());
    await waitFor(() => expect(navegar).toHaveBeenCalledWith('/voter/identity', { replace: true }));
  });

  /**
   * The common case, and it has to leave no trace: no spinner, no QR, no error
   * over a screen somebody just opened to sign in normally.
   */
  it('shows nothing at all when there is nothing pending', async () => {
    resumen.mockResolvedValue({ kind: 'none' });
    const { result } = renderHook(() => useWorldIdVerify());

    await waitFor(() => expect(resumen).toHaveBeenCalled());
    expect(result.current.connectorURI).toBeNull();
    expect(result.current.isVerifying).toBe(false);
    expect(result.current.qrError).toBeNull();
    expect(navegar).not.toHaveBeenCalled();
  });

  /**
   * A proof is spent when it is collected: the server hands it over once and
   * forgets it. Presenting it twice posts a proof the server no longer knows,
   * and the voter is told their verification failed moments after it
   * succeeded. StrictMode runs every effect twice, so this is not
   * hypothetical — it is the default in development.
   */
  it('spends the proof once, however many times the effect runs', async () => {
    resumen.mockResolvedValue({ kind: 'proof', result: PRUEBA });
    const { rerender } = renderHook(() => useWorldIdVerify());

    await waitFor(() => expect(navegar).toHaveBeenCalled());
    rerender();
    rerender();

    expect(entregas.filter(u => u.includes('/api/verify-human'))).toHaveLength(1);
  });

  /**
   * THE RESUME BELONGS TO THE MOUNT, NOT TO THE RENDER.
   *
   * `t` and `handleVerify` are both rebuilt on most renders — the i18n hook
   * and the auth context see to that — so an effect that names either in its
   * dependencies re-runs constantly, and each re-run tears down the one before
   * it through its own cleanup. What that looks like is a resume that is
   * started, aborted and started again for as long as the page re-renders, and
   * on a slow connection never finishes at all.
   */
  it('asks once per mount, however often the component re-renders', async () => {
    resumen.mockResolvedValue({ kind: 'none' });
    const { rerender } = renderHook(() => useWorldIdVerify());

    await waitFor(() => expect(resumen).toHaveBeenCalled());
    rerender();
    rerender();
    rerender();

    expect(resumen).toHaveBeenCalledTimes(1);
  });
});
