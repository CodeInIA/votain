/**
 * The World ID verification, held here instead of in the tab that started it.
 *
 * THE BUG THIS EXISTS FOR. Verifying on a phone means leaving: World App takes
 * the screen, and a backgrounded browser tab is something the system is free to
 * discard. When the person comes back, the page is a COLD START — new document,
 * empty heap — and the verification they just completed is gone with it. What
 * they see is the sign-in screen again, having already proved who they are.
 *
 * WHY IT COULD NOT BE FIXED IN THE BROWSER. The request is a live object. Its
 * bridge decryption key lives inside the SDK's WASM instance, and
 * `@worldcoin/idkit-core` 4.2.4 exposes no way to rebuild one: `IDKitRequest`
 * offers `connectorURI`, `requestId`, `pollOnce`, `pollUntilCompletion` and
 * `getDebugReport`, and nothing that takes any of those back. Persisting the id
 * across the reload buys nothing, because the id alone cannot decrypt the
 * answer. (The key is in fact in the connector URI's `k` parameter, but using
 * it would mean reimplementing the bridge protocol by hand.)
 *
 * So the request is moved somewhere a discarded tab cannot take it with it. The
 * browser gets a connector URI to show and an httpOnly cookie naming the
 * pending verification; this process holds the live object and polls the bridge
 * itself. A reload asks "is mine done?" and is handed the proof.
 *
 * This is also what made `return_to` safe to switch on at last: World App can
 * offer the voter a way back, because a fresh page arriving here collects the
 * proof instead of losing it. See `verificationRequest` below.
 *
 * ONE PROCESS. The store is a Map, so a restart forgets every verification in
 * flight and a second replica would not see the first one's. Both are correct
 * failures — the person starts again, which is where they were before this
 * existed — and both are the reason this is not the shape to keep if the
 * backend is ever run as more than one instance. It would move to whatever
 * store the sessions move to.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { signRequest } from '@worldcoin/idkit-core/signing';
import type { IDKitResult } from '@worldcoin/idkit-core';

/**
 * Five minutes, which is how long the browser used to poll for.
 *
 * Long enough for somebody to switch apps, verify and come back; short enough
 * that an abandoned QR stops costing anything. A verification that outlives it
 * is dropped and the person starts again.
 */
export const PENDING_TTL_MS = 5 * 60 * 1000;

/**
 * A ceiling on the store, so an unauthenticated endpoint cannot be used to
 * fill this process's memory. Reached only under abuse: each entry is a few
 * hundred bytes and expires on its own within `PENDING_TTL_MS`.
 */
const MAX_PENDING = 500;

export type PendingStatus =
  | { status: 'waiting'; connectorURI: string }
  | { status: 'confirmed'; result: IDKitResult }
  | { status: 'failed'; error: string };

interface Pending {
  /** What the browser renders as a QR code or opens as a deep link. */
  connectorURI: string;
  state: PendingStatus;
  expiresAt: number;
  /** Resolved when `state` stops being `waiting`, so a reader can wait on it. */
  settled: Promise<void>;
}

const pending = new Map<string, Pending>();

/**
 * Lets Node load the SDK's WASM, which it otherwise cannot.
 *
 * `idkit-core` initialises with `fetch(new URL("idkit_wasm_bg.wasm",
 * import.meta.url))`. In a browser that is an http URL and works; under Node
 * it is a `file:` URL, and Node's `fetch` refuses those outright. The failure
 * is opaque — "Failed to initialize IDKit WASM: TypeError: fetch failed" — and
 * the SDK offers no way to pass the bytes in, because its init function is not
 * exported.
 *
 * So `file:` is served from disk and everything else is handed to the real
 * `fetch` untouched. Installed once, before the SDK is first imported, rather
 * than swapped in and out around the call: the WASM loads lazily inside the
 * first request, concurrently with that request's own network calls, and a
 * global that is being removed underneath them is a race.
 */
let shimmed = false;
function shimFileFetch(): void {
  if (shimmed) return;
  shimmed = true;

  const real = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('file:')) return real(input, init);
    return new Response(await readFile(fileURLToPath(url)), {
      headers: { 'content-type': 'application/wasm' },
    });
  };
}

/** The SDK, imported once and only after the shim is in place. */
let sdk: Promise<typeof import('@worldcoin/idkit-core')> | undefined;
function idkit(): Promise<typeof import('@worldcoin/idkit-core')> {
  shimFileFetch();
  sdk ??= import('@worldcoin/idkit-core');
  return sdk;
}

/**
 * WHAT THE VOTER IS ASKED TO PROVE, separated from the act of asking.
 *
 * This decision used to live in the browser and was pinned by two tests there.
 * It moved with the request, and the tests moved with it: standing up WASM to
 * check a config object would be absurd, so the config is built by a function
 * that can simply be called.
 *
 * `allow_legacy_proofs`, AND WHY 3.0 IS STILL ACCEPTED. World ID 4.0 knows four
 * credentials — `proof_of_human` (an Orb), `passport` and `mnc` (an NFC
 * document), and `selfie` (a liveness check) — and no device level, which is
 * what `deviceLegacy` asks for. In Spain a voter can hold none of the four:
 * Orbs were withdrawn, neither document check has launched here, and `selfie`
 * is access-gated. Cutting over today would lock out very nearly every voter.
 *
 * `deviceLegacy`, AND WHY THE FLOOR IS THE RIGHT ASK. At this level World ID
 * states that an ACCOUNT exists, not that a person is unique, and uniqueness is
 * not what signing in leans on. An election that needs it demands an Orb at
 * ENROLMENT, against its own personhood nullifier, where a refusal costs one
 * election rather than the whole account. What this level does buy is a STABLE,
 * REPRODUCIBLE identifier, which is the only thing that makes recovery possible
 * on a device whose passkey is gone.
 *
 * THE MIGRATION, when either check ships here: `allow_legacy_proofs: false` and
 * `.constraints(any(CredentialRequest("selfie"), CredentialRequest("proof_of_human")))`.
 * `verifyWorldIdProof` needs no change; it already grades 4.0 responses by
 * `identifier` and `issuer_schema_id`.
 */
export function verificationRequest(
  action: string,
  rpContext: {
    rp_id: string;
    nonce: string;
    created_at: number;
    expires_at: number;
    signature: string;
  },
  returnTo?: string,
) {
  return {
    config: {
      app_id: process.env.WORLD_ID_APP_ID as `app_${string}`,
      action,
      rp_context: rpContext,
      allow_legacy_proofs: true,
      environment: 'production',
      /**
       * WHERE WORLD APP OFFERS TO SEND THEM BACK, on a phone only.
       *
       * This was left out for a long time and the reason has changed. The old
       * objection was that returning this way is a COLD START, and a cold
       * start destroyed a verification that had already succeeded — worse
       * than the inconvenience it removed. That is answered: the request
       * lives here now, named by a cookie, so a fresh page collects the proof.
       *
       * What is left is where the link lands, and it is smaller than it looks.
       * `return_to` is an https address and Android resolves one as an app
       * link, so a voter who has this installed as a PWA is handed the
       * INSTALLED copy. That only diverges for somebody who has the PWA
       * installed AND is verifying in a browser tab anyway; a voter normally
       * has one or the other open, and whichever they started in is where the
       * link goes. Even in that case nothing is lost now: a WebAPK shares
       * Chrome's cookie jar, so the cookie is there and the proof is
       * collected. A voter landing in their other window is worth far less
       * than being stranded in World App wondering whether anything happened,
       * which is the thing that actually made people give up.
       *
       * NOT SENT FROM A DESKTOP, and the caller decides that, because only the
       * browser knows. A desktop shows a QR code that a PHONE scans, so the
       * phone would be told to open this page: a second copy of the app on the
       * wrong screen, while the real one waits on the desk.
       *
       * Validated by `sanitiseCallbackUrl` before it reaches here. It is
       * written into a payload another app navigates to on this platform's
       * behalf, so an unchecked value is an open redirect wearing Votain's
       * name.
       */
      ...(returnTo ? { return_to: returnTo } : {}),
    } as const,
    preset: 'deviceLegacy' as const,
  };
}

/** Drops whatever has run out. Called on every write, which is often enough. */
function sweep(): void {
  const now = Date.now();
  for (const [id, p] of pending) {
    if (p.expiresAt <= now) pending.delete(id);
  }
}

/**
 * Opens a verification and returns the id to hand back in a cookie.
 *
 * The RP signature is minted here rather than fetched by the browser first.
 * That is not only tidier: the signature and the request it authorises are now
 * made in one place, so there is no window in which a signature exists with no
 * request attached to it.
 */
/**
 * The half of a bridge request this module actually uses.
 *
 * Named so a test can supply one. Standing up the SDK's WASM and talking to
 * `bridge.worldcoin.org` to check that an expired entry is dropped would be
 * absurd, and the parts worth pinning — what is asked for, and what happens to
 * a verification over its life — are exactly the parts that have nothing to do
 * with the SDK.
 */
export interface BridgeRequest {
  connectorURI: string;
  pollUntilCompletion(options: { timeout: number }): Promise<
    { success: true; result: IDKitResult } | { success: false; error: unknown }
  >;
}

export type OpenBridgeRequest = (action: string, returnTo?: string) => Promise<BridgeRequest>;

/** The real one: mints the RP signature and asks the SDK. */
const openOverIDKit: OpenBridgeRequest = async (action, returnTo) => {
  if (!process.env.DEVELOPER_KEY) throw new Error('DEVELOPER_KEY not configured');

  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex: process.env.DEVELOPER_KEY,
    action,
  });

  const { config, preset } = verificationRequest(
    action,
    {
      rp_id: process.env.WORLD_ID_RP_ID as string,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
      signature: sig,
    },
    returnTo,
  );

  const sdkMod = await idkit();
  return sdkMod.IDKit.request(config).preset(sdkMod[preset]({}));
};

export async function startPendingVerification(
  action: string,
  returnTo?: string,
  open: OpenBridgeRequest = openOverIDKit,
): Promise<{ pendingId: string; connectorURI: string }> {
  sweep();
  if (pending.size >= MAX_PENDING) throw new Error('Too many verifications in flight');

  const request = await open(action, returnTo);
  const pendingId = randomBytes(32).toString('hex');

  let announce!: () => void;
  const settled = new Promise<void>(resolve => {
    announce = resolve;
  });

  const entry: Pending = {
    connectorURI: request.connectorURI,
    state: { status: 'waiting', connectorURI: request.connectorURI },
    expiresAt: Date.now() + PENDING_TTL_MS,
    settled,
  };
  pending.set(pendingId, entry);

  void request
    .pollUntilCompletion({ timeout: PENDING_TTL_MS })
    .then(completion => {
      entry.state = completion.success
        ? { status: 'confirmed', result: completion.result }
        : { status: 'failed', error: String(completion.error) };
    })
    .catch((e: unknown) => {
      entry.state = { status: 'failed', error: e instanceof Error ? e.message : 'bridge_error' };
    })
    .finally(() => {
      // A CONFIRMED VERIFICATION OUTLIVES THE POLL. The window that matters is
      // the one where somebody is still walking back to the browser, and it is
      // exactly then that the tab may be reloaded, so the proof has to still be
      // here when it asks. It is cleared when collected, or by the sweep.
      announce();
    });

  return { pendingId, connectorURI: entry.connectorURI };
}

/**
 * What became of a verification, waiting up to `holdMs` for it to change.
 *
 * LONG POLLING, not a fast loop. A one-second poll for five minutes is three
 * hundred requests, which is more than twice this server's whole per-minute
 * budget for a single voter signing in. Holding the connection instead answers
 * the instant the bridge does — so it is also *more* responsive than polling —
 * and costs about a dozen requests over the same five minutes.
 *
 * `holdMs` of 0 returns immediately, which is what a page asks on mount to find
 * out whether it is resuming something.
 */
export async function readPendingVerification(
  pendingId: string | undefined,
  holdMs = 0,
): Promise<PendingStatus | undefined> {
  if (!pendingId) return undefined;

  const entry = pending.get(pendingId);
  if (!entry || entry.expiresAt <= Date.now()) {
    pending.delete(pendingId);
    return undefined;
  }

  if (entry.state.status === 'waiting' && holdMs > 0) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      entry.settled,
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, holdMs);
      }),
    ]);
    // Or the process keeps a timer alive per abandoned request, which on a
    // 25-second hold is a slow leak rather than a visible one.
    if (timer) clearTimeout(timer);
  }

  return entry.state;
}

/**
 * Forgets a verification, once its proof has been handed over or abandoned.
 *
 * The proof is a bearer credential: whoever holds it can present it to
 * `/api/verify-human` and be signed in as that human. It is therefore given out
 * once and deleted, so a cookie that leaks later is worth nothing.
 */
export function endPendingVerification(pendingId: string | undefined): void {
  if (pendingId) pending.delete(pendingId);
}

/** Test seam: empties the store so one case cannot see another's entries. */
export function resetPendingVerifications(): void {
  pending.clear();
}
