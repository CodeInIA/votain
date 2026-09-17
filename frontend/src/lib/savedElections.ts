/**
 * The elections a voter saved to come back to, on every device they use.
 *
 * WHY THIS IS NOT A LIST IN `localStorage` AND NOTHING ELSE. A voter saves an
 * election on their phone during a commute and looks for it that evening on a
 * laptop. Local storage cannot answer that, and there is no account with a
 * password to hang it off: a voter has ONE Semaphore secret, recoverable from a
 * passkey or twelve words, and anything derived from it is reachable wherever
 * they can reach that.
 *
 * WHERE IT GOES. `PlatformRegistry.setPreferences`, through the relay, as
 * AES-GCM ciphertext under a key derived from that secret. In plaintext the
 * same mapping would be a public, permanent record of which elections interest
 * a named human, which is exactly the linkage `enrollPrivate` and the
 * per-election identities exist to remove, and worse than the one they removed:
 * saving costs nothing, so people save what they are curious about and not only
 * what they join.
 *
 * WHAT IS LOCAL AND WHAT IS NOT. The star is instant and local, always. The
 * blob is pushed after the voter stops clicking, and only when the identity is
 * unlocked, because sealing needs the secret. A locked device therefore keeps
 * saving happily and syncs at the next unlock, which is the same bargain the
 * rest of the app makes: nothing summons an authenticator to draw a list.
 *
 * HOW TWO DEVICES AGREE. Every entry carries the moment it was set, and merging
 * keeps the later one per election. Unsaving is an entry too, a negative time,
 * because a list that only ever grew would resurrect everything the voter
 * removed as soon as an older device wrote back.
 */
import type { Identity } from "@semaphore-protocol/identity";
import { backendBase } from "./backend";
import { noticeUnauthorized } from "./sessionExpiry";
import { getStoredIdentity } from "./semaphore";

/** Info string. Changing it changes the key, so it is versioned. */
const HKDF_INFO = "votain/preferences-key/v1";
const IV_BYTES = 12;
const PLAINTEXT_VERSION = 1;

/** Where the plaintext lives between visits, so a locked device still works. */
const STORAGE_KEY = "votain_saved_elections";

/**
 * Fires when the set changes, so every star on screen agrees at once.
 *
 * A card, the filter chip and the list are three readers of one fact. Without
 * this they each hold a copy from whenever they last rendered, and saving from
 * a card leaves the list it is sitting in showing the old answer.
 */
export const SAVED_CHANGED_EVENT = "votain:saved-elections-changed";

/**
 * How many entries are kept, tombstones included.
 *
 * The contract caps the blob at 4 KiB; this keeps the plaintext comfortably
 * under it without having to measure ciphertext on every write. Well past what
 * a person saves, and the oldest tombstones go first when it is reached, since
 * "I unsaved this two years ago" is the fact with the least left to say.
 */
const MAX_ENTRIES = 120;

/**
 * Election address (lower case, no `0x`) => when it was last set, in seconds.
 * Positive means saved, negative means unsaved at that moment.
 */
type Entries = Record<string, number>;

interface Plaintext {
  v: number;
  e: Entries;
}

const keyFor = (electionId: string): string => electionId.toLowerCase().replace(/^0x/, "");
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

// ────────────────────────────────────────────────
// The copy on this device
// ────────────────────────────────────────────────

function readLocal(): Entries {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Plaintext;
    return parsed && typeof parsed === "object" && parsed.e ? parsed.e : {};
  } catch {
    // Private mode, a full quota, or something else wrote here. An unreadable
    // list is an empty one, never an error: this is a convenience, and it must
    // not be able to stop a page rendering.
    return {};
  }
}

function writeLocal(entries: Entries): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: PLAINTEXT_VERSION, e: entries }));
  } catch {
    // Nothing to do and nothing to say: the in-memory answer is still right for
    // this page, and the next device to sync will bring it back.
  }
  window.dispatchEvent(new CustomEvent(SAVED_CHANGED_EVENT));
}

/** Whether this voter saved this election. */
export function isSaved(electionId: string): boolean {
  return (readLocal()[keyFor(electionId)] ?? 0) > 0;
}

/** Every election saved, as the lower case addresses the lists use. */
export function savedElectionIds(): string[] {
  const entries = readLocal();
  return Object.keys(entries)
    .filter(id => entries[id] > 0)
    .map(id => `0x${id}`);
}

/** Whether anything has ever been saved here, tombstones included. */
export function hasSavedAnything(): boolean {
  return Object.keys(readLocal()).length > 0;
}

/**
 * Saves or unsaves, and returns the new answer.
 *
 * Local and immediate. The push to the chain is scheduled, never awaited: a
 * star that waited for a transaction would be a star nobody presses twice.
 */
export function toggleSaved(electionId: string): boolean {
  const entries = readLocal();
  const id = keyFor(electionId);
  const saved = (entries[id] ?? 0) > 0;
  entries[id] = saved ? -nowSeconds() : nowSeconds();
  writeLocal(prune(entries));
  schedulePush();
  return !saved;
}

/**
 * Keeps the list inside what one blob can hold.
 *
 * Tombstones go first, oldest first, because an entry saying "not saved" only
 * has to outlive the other devices that still think it is. Saves are dropped
 * only if tombstones alone were not enough, and then the oldest, which is the
 * one least likely to be waited for.
 */
function prune(entries: Entries): Entries {
  const ids = Object.keys(entries);
  if (ids.length <= MAX_ENTRIES) return entries;

  const byAge = (a: string, b: string) => Math.abs(entries[a]) - Math.abs(entries[b]);
  const tombstones = ids.filter(id => entries[id] < 0).sort(byAge);
  const saves = ids.filter(id => entries[id] > 0).sort(byAge);

  const doomed = [...tombstones, ...saves].slice(0, ids.length - MAX_ENTRIES);
  const kept: Entries = { ...entries };
  for (const id of doomed) delete kept[id];
  return kept;
}

/**
 * The later fact about each election wins.
 *
 * A save and an unsave at the same second is a clock collision between two
 * devices, and the unsave is kept: undoing a save the voter no longer wanted is
 * a smaller surprise than resurrecting one they removed.
 */
export function mergeEntries(mine: Entries, theirs: Entries): Entries {
  const out: Entries = { ...mine };
  for (const [id, at] of Object.entries(theirs)) {
    const here = out[id];
    if (here === undefined) {
      out[id] = at;
      continue;
    }
    if (Math.abs(at) > Math.abs(here)) out[id] = at;
    else if (Math.abs(at) === Math.abs(here) && at < here) out[id] = at;
  }
  return out;
}

// ────────────────────────────────────────────────
// Sealing
// ────────────────────────────────────────────────

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The AES key for this voter's settings, from the identity secret.
 *
 * HKDF over the private key, domain separated by a purpose string, exactly as
 * the per-election identities are derived: the phrase is often not in memory at
 * all, since a passkey unsealed the secret instead, and this has to work from
 * whatever the voter unlocked. The info string is what stops this key and an
 * election identity being reachable from one another.
 */
async function derivePreferencesKey(master: Identity): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(master.privateKey)) as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode(HKDF_INFO) },
    ikm,
    { name: "AES-GCM", length: 256 },
    // Extractable, because it is kept: see `KEY_CACHE_KEY`.
    true,
    ["encrypt", "decrypt"],
  );
}

/**
 * This one key, kept on the device after the first unlock.
 *
 * WHY THIS IS NOT THE LEAK IT LOOKS LIKE. What it opens is the saved list, and
 * the saved list is ALREADY on this device in plaintext, two keys along in the
 * same storage, because that is what makes a star instant and what makes it
 * work with no session at all. Anyone who can read this key could read the list
 * itself without it. What the key cannot do is open anything else: it is HKDF
 * output, the identity is not recoverable from it, and no election identity,
 * ballot or vault entry is reachable through it.
 *
 * WHY IT IS WORTH KEEPING. In passkey mode the secret is not at rest, so every
 * reload leaves it locked, and a sync that needed the secret would need an
 * authenticator prompt to reconcile a bookmark. Nobody would accept that
 * prompt, so in practice the list would never sync: the feature would be
 * multi-device on paper and local in fact. With the key here, one unlock the
 * voter was going to do anyway (enrolling, voting, opening their receipts) is
 * enough, and every visit after it syncs in silence.
 */
const KEY_CACHE_KEY = "votain_preferences_key";

function b64urlOf(bytes: ArrayBuffer): string {
  return b64urlEncode(new Uint8Array(bytes));
}

async function rememberKey(key: CryptoKey): Promise<void> {
  try {
    localStorage.setItem(KEY_CACHE_KEY, b64urlOf(await crypto.subtle.exportKey("raw", key)));
  } catch {
    // Unwritable storage, or a key this browser will not export. The voter
    // keeps a working list on this device and syncs at the next unlock.
  }
}

async function cachedKey(): Promise<CryptoKey | null> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY_CACHE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return await crypto.subtle.importKey(
      "raw",
      b64urlDecode(raw) as BufferSource,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
  } catch {
    return null;
  }
}

/**
 * The key to seal with: derived when the identity is open, remembered when it
 * is not, and null on a device that has never had either.
 */
async function preferencesKey(master: Identity | null): Promise<CryptoKey | null> {
  if (!master) return cachedKey();
  const key = await derivePreferencesKey(master);
  await rememberKey(key);
  return key;
}

export async function sealEntries(master: Identity | null, entries: Entries): Promise<string | null> {
  const key = await preferencesKey(master);
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify({ v: PLAINTEXT_VERSION, e: entries })),
    ),
  );
  const blob = new Uint8Array(iv.length + ciphertext.length);
  blob.set(iv, 0);
  blob.set(ciphertext, iv.length);
  return b64urlEncode(blob);
}

/**
 * Opens a blob, or answers null when it cannot.
 *
 * Null covers a blob sealed under another secret, a corrupted one and a shape
 * this version does not know. All three mean the same thing to the caller: the
 * remote copy is unusable, so keep what is here and write over it. A settings
 * list is not worth a screen saying the chain returned something odd.
 */
export async function openEntries(master: Identity | null, blob: string): Promise<Entries | null> {
  if (!blob) return {};
  const key = await preferencesKey(master);
  if (!key) return null;
  try {
    const raw = b64urlDecode(blob);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, IV_BYTES) },
      key,
      raw.slice(IV_BYTES),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Plaintext;
    return parsed && typeof parsed === "object" && parsed.e ? parsed.e : null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────
// The copy on the chain
// ────────────────────────────────────────────────

/**
 * Whether there is a voter session to carry these requests.
 *
 * THE STORE IS THE VOTER'S, keyed by their World ID nullifier, so an organizer
 * signed in with a wallet alone has nowhere to put a list: the endpoint would
 * answer 401 and the app would announce an expired session that nobody had.
 * Their saved elections stay on the device, which is the same bargain a locked
 * voter device already makes, and the moment they sign in as a voter the list
 * goes up with everything else.
 *
 * Read from storage rather than through the auth context: this is a library
 * called from a click handler and a timer, neither of which is a component.
 */
function hasVoterSession(): boolean {
  try {
    return localStorage.getItem("votain_voter_logged_in") === "true";
  } catch {
    return false;
  }
}

async function fetchBlob(): Promise<string | null> {
  if (!hasVoterSession()) return null;
  const res = await fetch(`${backendBase()}/api/preferences`, { credentials: "include" });
  if (res.status === 401) {
    noticeUnauthorized(res.status);
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json()) as { blob?: string };
  return body.blob ?? "";
}

async function putBlob(blob: string): Promise<boolean> {
  if (!hasVoterSession()) return false;
  const res = await fetch(`${backendBase()}/api/preferences`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blob }),
  });
  if (res.status === 401) noticeUnauthorized(res.status);
  return res.ok;
}

/**
 * Brings the two copies together and leaves both holding the result.
 *
 * Called when the identity becomes readable, which is the first moment this is
 * possible. Refusing quietly when it is not is deliberate: a voter who never
 * unlocks still gets a working star on this device, and finds their list
 * waiting on the day they do.
 */
export async function syncSavedElections(master: Identity | null = getStoredIdentity()): Promise<void> {
  // Either the identity is open or this device kept the key from a previous
  // unlock. With neither, saving still works here and syncs at the first one.
  if (!master && !(await cachedKey())) return;

  const mine = readLocal();
  const blob = await fetchBlob();
  if (blob === null) return; // no session, or the store is not reachable

  const theirs = await openEntries(master, blob);
  const merged = prune(mergeEntries(mine, theirs ?? {}));
  writeLocal(merged);

  // Written back only when the chain is not already holding this answer. A
  // sync that always wrote would turn opening the app into a transaction.
  const changed = theirs === null || !sameEntries(theirs, merged);
  if (!changed) return;
  const sealed = await sealEntries(master, merged);
  if (sealed !== null) await putBlob(sealed);
}

function sameEntries(a: Entries, b: Entries): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => a[k] === b[k]);
}

/**
 * One write per burst of stars, not one per star.
 *
 * Somebody going down a list saving four elections should cost the relayer one
 * transaction. The wait is long enough to collect that burst and short enough
 * that closing the tab afterwards rarely beats it; `flushSavedElections` covers
 * the case where it does.
 */
const PUSH_DELAY_MS = 4000;
let pushTimer: ReturnType<typeof setTimeout> | undefined;

function schedulePush(): void {
  installFlushOnHide();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void flushSavedElections();
  }, PUSH_DELAY_MS);
}

/**
 * The tab closing beats the timer, so the timer is not the only trigger.
 *
 * `pagehide` and a hidden `visibilitychange` are the two the browser actually
 * delivers when somebody saves an election and switches away, which on a phone
 * is most of the time. Installed on the first save rather than on import, so a
 * page that never saves anything adds no listeners.
 */
let hideListenerInstalled = false;

function installFlushOnHide(): void {
  if (hideListenerInstalled) return;
  hideListenerInstalled = true;
  const flush = () => {
    if (pushTimer !== undefined) void flushSavedElections();
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/** Pushes now, if there is an identity to seal with. Safe to call at any time. */
export async function flushSavedElections(): Promise<void> {
  clearTimeout(pushTimer);
  pushTimer = undefined;
  const sealed = await sealEntries(getStoredIdentity(), readLocal());
  // Null means this device has no key yet, which is a device that has never
  // unlocked. The list is safe where it is and goes up at the first sync.
  if (sealed !== null) await putBlob(sealed);
}

/** Test seam: forget this device's copy. */
export function forgetSavedElections(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(KEY_CACHE_KEY);
  } catch {
    // See `writeLocal`.
  }
  window.dispatchEvent(new CustomEvent(SAVED_CHANGED_EVENT));
}
