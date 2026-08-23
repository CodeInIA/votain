/**
 * WebAuthn PRF: deterministic secret derivation from a passkey.
 *
 * The PRF (pseudo-random function) extension lets an authenticator produce a
 * stable 32-byte secret for a given (credential, salt) pair, gated behind the
 * user's biometric/PIN. It never leaves the authenticator's secure element, so
 * we can re-derive the Semaphore identity on demand instead of storing the raw
 * secret scalar in localStorage (where XSS could read it).
 *
 * Not every browser/authenticator supports PRF (needs the `hmac-secret` /
 * `prf` extension). Callers must handle a `null` return and fall back.
 *
 * The credential id is public and cached in localStorage so the same passkey is
 * reused across sessions; the PRF output itself is never persisted.
 */

const CRED_ID_KEY = "votain_prf_credential_id";
const CRED_CREATED_KEY = "votain_prf_credential_created";
const CRED_LAST_USED_KEY = "votain_prf_credential_last_used";
const RP_NAME = "Votain";

// Fixed salt → the PRF output is stable for this purpose on a given credential.
// Distinct salts yield independent secrets from the same passkey (domain
// separation): identity for the voter's Semaphore key, tally for the
// organizer's decryption key.
const IDENTITY_SALT = new TextEncoder().encode("votain:semaphore-identity:v1");

function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBuf(s: string): ArrayBuffer {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const str = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes.buffer;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(b);
  return b;
}

/** Feature-detects WebAuthn availability (full PRF support can only be known at use time). */
export function isWebAuthnAvailable(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

/**
 * Thrown when the ceremony fails on a device that has no built-in authenticator
 * configured at all. Distinguished from a generic failure because the fix is
 * completely different: the user has to go set up Windows Hello / Touch ID (or
 * bring a phone or security key), and no amount of retrying will help.
 */
export class NoAuthenticatorError extends Error {
  constructor() {
    super(
      "This device has no passkey authenticator set up. Configure a screen lock " +
        "(Windows Hello PIN, Touch ID, or Android screen lock), or use a phone or " +
        "security key instead.",
    );
    this.name = "NoAuthenticatorError";
  }
}

/**
 * Whether this device can act as an authenticator itself.
 *
 * False does NOT mean passkeys are impossible here: a security key or a phone
 * over the cross-device QR still works. It only tells us the built-in path is
 * unavailable, which is worth saying up front instead of after a failure.
 */
export async function hasPlatformAuthenticator(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** WebAuthn only works in a secure context (https, or http on localhost). */
function assertSecureContext(): void {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error(
      "Passkeys require a secure context: open the app on https:// or http://localhost " +
        `(current origin: ${window.location.origin})`,
    );
  }
}

/** A user cancellation/timeout must not be retried: it would double-prompt. */
function isUserCancellation(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");
}

function describe(e: unknown): string {
  return e instanceof DOMException ? `${e.name}: ${e.message}` : String(e);
}

/**
 * Registers a new passkey and caches its (public) credential id.
 *
 * Deliberately permissive so it works across authenticators:
 *  - `residentKey: "preferred"`, we store the credential id ourselves, so a
 *    discoverable credential is not required. Demanding it is a common cause of
 *    "unknown transient reason" failures on Windows Hello / Firefox.
 *  - PRF is *requested*; if the ceremony fails for any non-cancellation reason
 *    we retry without extensions. PRF only powers identity derivation, never auth.
 */
async function registerCredential(): Promise<{
  registered: boolean;
  prfEnabled: boolean;
  credentialId?: string;
}> {
  assertSecureContext();

  const base: PublicKeyCredentialCreationOptions = {
    challenge: randomBytes(32),
    rp: { name: RP_NAME, id: window.location.hostname },
    user: {
      id: randomBytes(16),
      name: "votain-user",
      displayName: "Votain",
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 }, // ES256
      { type: "public-key", alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    timeout: 60_000,
  };

  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: { ...base, extensions: { prf: {} } as AuthenticationExtensionsClientInputs },
    })) as PublicKeyCredential | null;
  } catch (e) {
    if (isUserCancellation(e)) {
      throw new Error("Passkey creation was cancelled", { cause: e });
    }
    // The authenticator likely rejected the PRF extension: retry plain.
    console.warn("Passkey creation with PRF failed, retrying without it:", describe(e));
    try {
      cred = (await navigator.credentials.create({ publicKey: base })) as PublicKeyCredential | null;
    } catch (e2) {
      if (isUserCancellation(e2)) {
        throw new Error("Passkey creation was cancelled", { cause: e2 });
      }
      throw new Error(`Could not create a passkey, ${describe(e2)}`, { cause: e2 });
    }
  }

  if (!cred) return { registered: false, prfEnabled: false };

  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean } };
  localStorage.setItem(CRED_ID_KEY, bufToB64url(cred.rawId));
  localStorage.setItem(CRED_CREATED_KEY, new Date().toISOString());
  localStorage.setItem(CRED_LAST_USED_KEY, new Date().toISOString());
  return {
    registered: true,
    prfEnabled: Boolean(ext.prf?.enabled),
    credentialId: bufToB64url(cred.rawId),
  };
}

// ────────────────────────────────────────────────
// Vault-aware PRF access (voter identity)
// ────────────────────────────────────────────────

export interface PrfAssertion {
  /** Base64url id of the credential that actually answered. */
  credentialId: string;
  secret: Uint8Array;
}

/**
 * Evaluates the PRF on one of `credentialIds`, or on any credential this
 * authenticator holds for the domain when the list is empty.
 *
 * The empty-list form is what makes a second device work: the browser offers
 * every passkey it can reach, including ones synced from the user's password
 * manager and, through WebAuthn's hybrid transport, ones that live on their
 * phone and answer over a QR code. Passing an explicit list keeps the prompt
 * narrow when we already know which credentials belong to this voter.
 *
 * Returns null when nothing is available or the user dismisses the prompt, so
 * callers can fall back to registering a fresh passkey.
 */
export async function assertPrf(
  credentialIds: string[] = [],
  salt: Uint8Array = IDENTITY_SALT,
): Promise<PrfAssertion | null> {
  if (!isWebAuthnAvailable()) return null;
  assertSecureContext();

  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: window.location.hostname,
        // Empty => discoverable credentials; the authenticator picks.
        allowCredentials: credentialIds.map(id => ({
          id: b64urlToBuf(id),
          type: "public-key" as const,
        })),
        userVerification: "preferred",
        timeout: 60_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;

    if (!assertion) return null;

    const secret = (assertion.getClientExtensionResults() as {
      prf?: { results?: { first?: ArrayBuffer } };
    }).prf?.results?.first;
    if (!secret) return null;

    const credentialId = bufToB64url(assertion.rawId);
    localStorage.setItem(CRED_ID_KEY, credentialId);
    localStorage.setItem(CRED_LAST_USED_KEY, new Date().toISOString());
    return { credentialId, secret: new Uint8Array(secret) };
  } catch (e) {
    if (isUserCancellation(e)) return null;
    console.warn("PRF assertion failed:", describe(e));
    return null;
  }
}

/**
 * Creates a passkey on THIS device and returns its PRF output, so the caller can
 * wrap the voter's existing identity secret under it. Null when the
 * authenticator cannot do PRF, in which case this device cannot join the vault.
 */
export async function enrollPrfPasskey(
  salt: Uint8Array = IDENTITY_SALT,
): Promise<PrfAssertion | null> {
  const { registered, prfEnabled, credentialId } = await registerCredential();
  if (!registered || !prfEnabled || !credentialId) return null;
  // Creation reports only that PRF is enabled; a get() is needed to read it.
  return assertPrf([credentialId], salt);
}

/** The credential id cached on this device, if any. */
export function getCachedCredentialId(): string | null {
  return localStorage.getItem(CRED_ID_KEY);
}

export interface PasskeyInfo {
  /** Base64url credential id: public, safe to display. */
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  prfCapable: boolean;
}

/** Real metadata about the passkey registered on this device, if any. */
export function getPasskeyInfo(): PasskeyInfo | null {
  const id = localStorage.getItem(CRED_ID_KEY);
  if (!id) return null;
  const created = localStorage.getItem(CRED_CREATED_KEY);
  const lastUsed = localStorage.getItem(CRED_LAST_USED_KEY);
  return {
    id,
    createdAt: created ? new Date(created) : new Date(),
    lastUsedAt: lastUsed ? new Date(lastUsed) : new Date(),
    // PRF is what powers identity derivation; recorded when the mode was chosen.
    prfCapable: localStorage.getItem("votain_identity_mode") === "prf",
  };
}

/**
 * Derives a 32-byte PRF secret for the given salt (default: the voter identity
 * salt), prompting the passkey. Registers a PRF credential first if none exists
 * yet. Returns null when PRF is unsupported or the user cancels: callers must
 * fall back. Pass a distinct salt for an independent secret (e.g. the tally key).
 */
export async function derivePrfSecret(salt: Uint8Array = IDENTITY_SALT): Promise<Uint8Array | null> {
  if (!isWebAuthnAvailable()) return null;

  try {
    let credId = localStorage.getItem(CRED_ID_KEY);
    if (!credId) {
      const { registered, prfEnabled } = await registerCredential();
      if (!registered || !prfEnabled) return null; // fall back to stored identity
      credId = localStorage.getItem(CRED_ID_KEY);
      if (!credId) return null;
    }

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: window.location.hostname,
        allowCredentials: [{ id: b64urlToBuf(credId), type: "public-key" }],
        userVerification: "preferred",
        timeout: 60_000,
        extensions: {
          prf: { eval: { first: salt } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;

    if (!assertion) return null;

    const results = (assertion.getClientExtensionResults() as {
      prf?: { results?: { first?: ArrayBuffer } };
    }).prf?.results?.first;

    return results ? new Uint8Array(results) : null;
  } catch (e) {
    console.warn("PRF derivation failed:", e);
    return null;
  }
}

/**
 * Real passkey authentication gate: registers a credential the first time and
 * asserts it (biometric / PIN prompt) on every subsequent login. Throws with a
 * descriptive message when WebAuthn is unavailable or the user cancels: the
 * caller must NOT let the user through in that case.
 */
export async function authenticatePasskey(): Promise<void> {
  if (!isWebAuthnAvailable()) {
    throw new Error("This browser does not support passkeys (WebAuthn)");
  }
  assertSecureContext();

  const credId = localStorage.getItem(CRED_ID_KEY);

  if (!credId) {
    // First login on this device: create the passkey (prompts the authenticator).
    try {
      const { registered } = await registerCredential();
      if (!registered) throw new Error("Passkey registration was cancelled");
    } catch (e) {
      // A device with no screen lock configured fails here with an opaque
      // DOMException. Say what actually has to be done instead.
      if (!(await hasPlatformAuthenticator())) throw new NoAuthenticatorError();
      throw e;
    }
    return; // registration already proved user presence
  }

  // Subsequent logins: assert the existing credential.
  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: window.location.hostname,
        allowCredentials: [{ id: b64urlToBuf(credId), type: "public-key" }],
        userVerification: "preferred",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    if (isUserCancellation(e)) {
      throw new Error("Passkey authentication was cancelled", { cause: e });
    }
    // The stored credential may no longer exist on this authenticator (e.g. the
    // user deleted it). Drop it so the next attempt registers a fresh one.
    clearPrfCredential();
    throw new Error(`Passkey unavailable, please try again, ${describe(e)}`, { cause: e });
  }

  if (!assertion) throw new Error("Passkey authentication was cancelled");
  localStorage.setItem(CRED_LAST_USED_KEY, new Date().toISOString());
}

/** Whether a PRF passkey has already been registered on this device. */
export function hasPrfCredential(): boolean {
  return localStorage.getItem(CRED_ID_KEY) !== null;
}

export function clearPrfCredential(): void {
  localStorage.removeItem(CRED_ID_KEY);
  localStorage.removeItem(CRED_CREATED_KEY);
  localStorage.removeItem(CRED_LAST_USED_KEY);
}
