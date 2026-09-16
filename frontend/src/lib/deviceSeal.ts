/**
 * The recovery phrase at rest on a device that has no passkey to hold it.
 *
 * WHY THIS EXISTS. The phrase is normally sealed under the passkey's WebAuthn
 * PRF and the plaintext is deleted; see `identityVault`. Some authenticators
 * cannot do PRF at all, and those voters still have to be able to come back,
 * so there has always been a fallback. The fallback was the phrase itself, in
 * `localStorage`, in the clear: twelve words that are the whole identity,
 * readable by anything that can read site data.
 *
 * WHAT THIS CHANGES. The phrase is encrypted with an AES-GCM key that this
 * browser generated and that NOTHING can read back, including this code:
 * `generateKey` is called with `extractable: false`, so the `CryptoKey` can be
 * used to decrypt and never exported. It lives in IndexedDB, which is the only
 * store that can hold a live `CryptoKey` rather than a string.
 *
 * WHAT THAT IS AND IS NOT WORTH, because this is easy to oversell:
 *
 * It defeats anyone who ends up with the STORAGE. A copied browser profile, a
 * device backup, a synced folder, an extension dumping `localStorage`, someone
 * reading it out of devtools: all of them now get ciphertext and no key.
 *
 * It does NOT defeat someone holding the unlocked device, who can simply open
 * the app and let it decrypt, and it does not defeat script running in this
 * origin, which can ask the browser to decrypt for the same reason. Those are
 * answered by not keeping the secret on the device at all, which is what the
 * passkey path does, and by the usual defences against injection.
 *
 * IT MUST NEVER LOCK ANYBODY OUT. A browser with no IndexedDB, or one that
 * refuses to open it, is a bad place to store a secret and not a reason to
 * take somebody's identity away. Every failure falls back to the old plaintext
 * slot, and `phraseProtection` says which of the two happened so a screen can
 * tell the truth about it.
 */

const DB_NAME = "votain-device-seal";
const DB_VERSION = 1;
const STORE = "seal";
/**
 * One key for everything this device seals.
 *
 * Per-value keys would be theatre: they would all be non-extractable, all
 * sitting in the same database, all usable by the same page. The key exists
 * to be unreadable, not to separate one secret from another on a machine that
 * can reach both.
 */
const KEY_ID = "device-key";

/**
 * What this device can seal, and where each one used to live in the clear.
 *
 * `legacyKey` is what makes migration free: a value found in the old slot is
 * sealed and the clear copy removed the first time anything reads it, so
 * existing voters are upgraded by opening the app.
 */
const SLOT = {
  /** The twelve words, when no passkey can hold them. The whole identity. */
  phrase: { blobId: "phrase-blob", legacyKey: "votain_recovery_phrase", marker: "votain_phrase_sealed_here" },
  /**
   * The World ID nullifier.
   *
   * It cannot cast a vote or impersonate anybody, so it is a weaker secret
   * than the phrase. It is still a stable identifier for one human inside
   * Votain, and this platform rests on not being correlatable: leaked
   * alongside data from somewhere else, it is the join column.
   */
  nullifier: { blobId: "nullifier-blob", legacyKey: "voter_nullifier", marker: "votain_nullifier_sealed_here" },
} as const;

export type SealedName = keyof typeof SLOT;

const IV_BYTES = 12;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB refused to open"));
  });
}

function idbGet<T>(db: IDBDatabase, id: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(db: IDBDatabase, id: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * This browser's sealing key, made once and never readable.
 *
 * `extractable: false` is the entire point: the key can be handed to
 * `encrypt` and `decrypt` and can never be turned back into bytes, so there is
 * nothing for anything reading storage to carry away.
 */
async function deviceKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(db, KEY_ID);
  if (existing) return existing;

  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  await idbPut(db, KEY_ID, key);
  return key;
}

export type PhraseProtection = "sealed-on-device" | "plaintext" | "none";

/** How a value on this device is held, for a screen that has to say so. */
export function protectionOf(name: SealedName): PhraseProtection {
  const slot = SLOT[name];
  if (localStorage.getItem(slot.marker) === "1") return "sealed-on-device";
  return localStorage.getItem(slot.legacyKey) !== null ? "plaintext" : "none";
}

/** Whether this device holds it at all, sealed or not. Synchronous. */
export function hasOnDevice(name: SealedName): boolean {
  return protectionOf(name) !== "none";
}

/** How the phrase is held. The one value several screens ask about by name. */
export function phraseProtection(): PhraseProtection {
  return protectionOf("phrase");
}

export function hasPhraseOnDevice(): boolean {
  return hasOnDevice("phrase");
}

/**
 * Keep the phrase on this device, encrypted if this browser will allow it.
 *
 * The plaintext slot is cleared on success, which is what makes this a
 * migration as well as a write: a voter who already had words sitting there
 * gets them sealed the first time anything stores or reads.
 */
export async function sealOnDevice(name: SealedName, value: string): Promise<PhraseProtection> {
  const slot = SLOT[name];
  try {
    const db = await openDb();
    const key = await deviceKey(db);
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(value) as BufferSource,
      ),
    );

    const blob = new Uint8Array(iv.length + ciphertext.length);
    blob.set(iv, 0);
    blob.set(ciphertext, iv.length);
    await idbPut(db, slot.blobId, blob);

    localStorage.setItem(slot.marker, "1");
    // Only now, so a failure anywhere above leaves the voter with what they
    // already had rather than with nothing.
    localStorage.removeItem(slot.legacyKey);
    return "sealed-on-device";
  } catch (error: unknown) {
    // A browser that will not give us a database is a bad place to keep a
    // secret, and not a reason to take somebody's identity away.
    console.warn(`Could not seal ${name} on this device, keeping it as it was:`, error);
    localStorage.setItem(slot.legacyKey, value);
    localStorage.removeItem(slot.marker);
    return "plaintext";
  }
}

/** The phrase, by the name the identity module calls it. */
export function sealPhraseOnDevice(phrase: string): Promise<PhraseProtection> {
  return sealOnDevice("phrase", phrase);
}

/**
 * The phrase this device is holding, or null.
 *
 * Migrates on the way past: plaintext found here is sealed and the clear copy
 * removed, so an existing voter is upgraded by opening the app rather than by
 * doing anything.
 */
/**
 * Drop the marker for something that cannot be opened.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. The marker is what every synchronous
 * caller consults, so a blob that will not decrypt leaves the app insisting a
 * phrase is on this device while every attempt to read it comes back empty:
 * screens offer to protect something that is not there, and the one honest
 * answer, "type your phrase again", is never reached. An unreadable secret is
 * the same as no secret, and saying so is what lets the voter recover.
 */
async function forgetUnreadable(name: SealedName): Promise<void> {
  localStorage.removeItem(SLOT[name].marker);
  try {
    const db = await openDb();
    await idbDelete(db, SLOT[name].blobId);
  } catch {
    // The marker is gone, which is the part anything reads.
  }
}

export async function readOnDevice(name: SealedName): Promise<string | null> {
  const slot = SLOT[name];
  const legacy = localStorage.getItem(slot.legacyKey);
  if (legacy !== null) {
    await sealOnDevice(name, legacy);
    return legacy;
  }
  if (localStorage.getItem(slot.marker) !== "1") return null;

  try {
    const db = await openDb();
    const blob = await idbGet<Uint8Array>(db, slot.blobId);
    const key = await idbGet<CryptoKey>(db, KEY_ID);
    if (!blob || !key) {
      await forgetUnreadable(name);
      return null;
    }

    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: blob.slice(0, IV_BYTES) },
      key,
      blob.slice(IV_BYTES) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch (error: unknown) {
    // Cleared site data, a corrupted store, a blob left behind by a key that
    // is gone. Nothing here can be recovered and the caller has other ways in.
    console.warn(`Could not open ${name} sealed on this device:`, error);
    await forgetUnreadable(name);
    return null;
  }
}

export function readPhraseOnDevice(): Promise<string | null> {
  return readOnDevice("phrase");
}

/** Forget the phrase entirely, both forms of it. */
export async function clearOnDevice(name: SealedName): Promise<void> {
  const slot = SLOT[name];
  localStorage.removeItem(slot.legacyKey);
  localStorage.removeItem(slot.marker);
  try {
    const db = await openDb();
    await idbDelete(db, slot.blobId);
    // The key stays. It is shared, so dropping it here would silently take
    // the other sealed value down with this one.
  } catch (error: unknown) {
    // The markers are gone, so nothing will be read back either way.
    console.warn(`Could not clear the sealed ${name}:`, error);
  }
}

export function clearPhraseOnDevice(): Promise<void> {
  return clearOnDevice("phrase");
}
