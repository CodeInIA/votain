/**
 * World ID proof requests, asked for on this voter's behalf rather than here.
 *
 * WHAT MOVED, AND WHY. This file used to build the bridge request itself, hold
 * it in a module variable and poll it. That works right up until the tab stops
 * existing, which on a phone is the ordinary case: verifying means leaving for
 * World App, and the system is free to discard a backgrounded tab. Coming back
 * is then a COLD START, and the live request — whose decryption key lives
 * inside the SDK's WASM instance, with no way to rebuild it from its id — is
 * gone. A verification that had ALREADY SUCCEEDED was being thrown away by the
 * reload, and what the voter saw was the sign-in screen again.
 *
 * So the request lives in the backend now (`auth/worldIdBridge`), named by an
 * httpOnly cookie the browser resends on its own. This file opens one, shows
 * the connector URI, and waits; `resumeWorldIdProof` is how a page that does
 * not remember starting anything finds out that it did.
 *
 * AND `return_to` IS ON NOW, on a phone, which the move is what made safe.
 *
 * It was left out for a long time. The objection was that coming back that way
 * is a cold start and a cold start LOST the verification, which made the way
 * back worse than the inconvenience it removed. That is exactly what moving
 * the request fixed, so the objection went with it.
 *
 * It matters more than it sounds. Without it a voter finishes in World App and
 * is simply left there, and plenty of them read a green tick as "done" and
 * never come back to the browser at all — not a lost tap, a lost sign-in.
 *
 * ONLY FROM A PHONE, and this file is the only place that can decide it. A
 * desktop shows a QR code that a PHONE scans, so `return_to` would tell that
 * phone to open this page: a second copy of the app on the wrong screen, while
 * the real one waits on the desk. The same reasoning `openWalletApp` uses.
 *
 * WHERE IT LANDS. `return_to` is an https address and Android resolves one as
 * an app link, so a voter with this installed as a PWA gets the installed copy.
 * That only differs from where they started for somebody who has the PWA AND
 * is verifying in a browser tab anyway, which is not the normal case: a voter
 * has one or the other open. And it is no longer harmful either way, because a
 * WebAPK shares Chrome's cookie jar, so the cookie is there and the proof is
 * collected wherever they land.
 *
 * The server refuses a destination that is not this frontend. World App
 * navigates to it on Votain's behalf, so accepting any URL would make this an
 * open redirect wearing Votain's name.
 */
import { type IDKitResult } from "@worldcoin/idkit-core";
import { backendBase } from "./backend";

export interface WorldIdRequestOptions {
  /** Called once the QR / deep-link URI is ready, so the UI can render it. */
  onConnectorUri?: (uri: string) => void;
  /** Overrides the configured action (each action yields its own nullifier). */
  action?: string;
  /** Lets a screen that is unmounting stop waiting without cancelling anything. */
  signal?: AbortSignal;
}

/** What the server says about the verification this browser has in flight. */
type PendingResponse =
  | { status: "none" }
  | { status: "waiting"; connectorURI: string }
  | { status: "confirmed"; result: IDKitResult }
  | { status: "failed"; error: string };

/** What a page coming up finds waiting for it, if anything. */
export type ResumedVerification =
  | { kind: "none" }
  /** Already proved. Hand it to `/api/verify-human` and the voter is in. */
  | { kind: "proof"; result: IDKitResult }
  /** Still out there. Put the QR back and wait, rather than the button. */
  | { kind: "waiting"; connectorURI: string };

/**
 * Whether the dApp and World App are on the SAME device, which is the only
 * case where sending somebody "back" means anything.
 */
const ON_A_PHONE =
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function endpoint(query = ""): string {
  return `${backendBase()}/api/worldid/request${query}`;
}

async function readPending(query: string, signal?: AbortSignal): Promise<PendingResponse> {
  const res = await fetch(endpoint(query), { credentials: "include", signal });
  if (!res.ok) throw new Error(`World ID bridge returned ${res.status}`);
  return (await res.json()) as PendingResponse;
}

/**
 * What this browser left in flight, for a page that does not remember starting
 * anything: the finished proof, a verification still running, or neither.
 *
 * THE THREE ARE DIFFERENT and a page acts differently on each, which is why
 * this is not a boolean. A finished proof means sign them in and say nothing
 * about the reload. One still running means put the QR back and keep waiting.
 * Neither means show the button, as if nothing had happened, because for this
 * browser nothing has.
 *
 * Asks once and does not wait, because this runs on mount: a page must not sit
 * on a held connection before it has drawn anything. Never throws — a page
 * coming up is the worst possible moment to turn a network hiccup into an
 * error, and "nothing pending" is the right thing to believe when unsure.
 */
export async function resumeWorldIdProof(): Promise<ResumedVerification> {
  try {
    const state = await readPending("");
    if (state.status === "confirmed") return { kind: "proof", result: state.result };
    if (state.status === "waiting") return { kind: "waiting", connectorURI: state.connectorURI };
    return { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}

/** Abandons the verification in flight, so pressing the button starts fresh. */
export async function cancelWorldIdProof(): Promise<void> {
  try {
    await fetch(endpoint(), { method: "DELETE", credentials: "include" });
  } catch {
    // It expires on its own within five minutes, so there is nothing to
    // recover from and nobody to tell.
  }
}

/**
 * Runs a full World ID request and resolves with the proof, or null when the
 * user abandons it. Throws only on configuration or transport failures.
 */
export async function requestWorldIdProof(
  opts: WorldIdRequestOptions = {},
): Promise<IDKitResult | null> {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      ...(opts.action ? { action: opts.action } : {}),
      // This exact page, so the voter comes back to where they were rather
      // than to the front door. See the note at the top for why only here.
      ...(ON_A_PHONE ? { returnTo: window.location.href } : {}),
    }),
  });
  if (!res.ok) throw new Error("Failed to open World ID request");

  const { connectorURI } = (await res.json()) as { connectorURI: string };
  opts.onConnectorUri?.(connectorURI);

  return waitForWorldIdProof(opts.signal);
}

/**
 * Waits for whatever is in flight, held open by the server.
 *
 * LONG POLLING RATHER THAN A ONE-SECOND LOOP, and the arithmetic is the whole
 * argument: polling for five minutes is three hundred requests, more than twice
 * this backend's per-minute budget for a single voter signing in. The server
 * holds each request for up to 25 seconds and answers the instant the bridge
 * does, so this is roughly a dozen requests AND quicker to notice than polling
 * would be. A `waiting` reply means that hold ran out, not that anything is
 * wrong, so it simply asks again.
 *
 * Exported because a resumed page joins a verification it never started, and
 * has to be able to wait for it like any other.
 */
export async function waitForWorldIdProof(signal?: AbortSignal): Promise<IDKitResult | null> {
  for (;;) {
    if (signal?.aborted) return null;
    const state = await readPending("?wait=1", signal);
    if (state.status === "confirmed") return state.result;
    // `failed` is a refusal or a timeout; `none` means it expired or somebody
    // else collected it. Neither is an error to raise at the voter: both mean
    // there is nothing to wait for any more.
    if (state.status !== "waiting") return null;
  }
}
