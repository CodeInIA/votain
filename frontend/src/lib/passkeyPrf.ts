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
 * Thrown when the authenticator refuses to create a passkey because it already
 * holds one that is registered for this voter. Not a failure: the device is
 * already able to vote, and the caller should say so rather than report an error.
 */
/** What a missing local credential id should be taken to mean. */
export type PasskeyIntent = "existing" | "first";

/**
 * Thrown when the authenticator offered nothing and the person had said they
 * already had a passkey. Distinct from a cancellation: the caller can offer to
 * create one instead of repeating the same prompt.
 */
export class NoPasskeyFoundError extends Error {
  constructor() {
    super("No passkey was available on this device");
    this.name = "NoPasskeyFoundError";
  }
}

export class PasskeyAlreadyRegisteredError extends Error {
  constructor() {
    super("This device already has a passkey registered for your identity.");
    this.name = "PasskeyAlreadyRegisteredError";
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
 *  - The PRF value is requested during creation. Authenticators that answer
 *    (Firefox 154 over Windows Hello, measured) hand back the secret right here
 *    and the caller needs no second ceremony. Ones that ignore it cost nothing.
 *  - On failure we walk down a ladder: eval, then a bare PRF request, then no
 *    extensions at all. The order matters. Dropping straight to no extensions
 *    would mint a credential with no hmac-secret, permanently PRF-incapable,
 *    which is far worse than one extra prompt.
 */
async function registerCredential(
  salt: Uint8Array = IDENTITY_SALT,
  excludeCredentialIds: string[] = [],
): Promise<{
  registered: boolean;
  prfEnabled: boolean;
  credentialId?: string;
  /** Set only when the authenticator evaluated the PRF during creation. */
  prfSecret?: Uint8Array;
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
    // Let the authenticator itself refuse a duplicate. It knows which
    // credentials it holds; this browser only knows what it happens to have
    // cached, which is nothing at all on a device the voter has used from
    // another browser.
    excludeCredentials: excludeCredentialIds.map(id => ({
      id: b64urlToBuf(id),
      type: "public-key" as const,
    })),
    timeout: 60_000,
  };

  const attempts: Array<{ label: string; prf?: AuthenticationExtensionsClientInputs }> = [
    { label: "prf.eval", prf: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs },
    { label: "prf", prf: { prf: {} } as AuthenticationExtensionsClientInputs },
    { label: "no extensions" },
  ];

  let cred: PublicKeyCredential | null = null;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      cred = (await navigator.credentials.create({
        publicKey: attempt.prf ? { ...base, extensions: attempt.prf } : base,
      })) as PublicKeyCredential | null;
      break;
    } catch (e) {
      if (isUserCancellation(e)) {
        throw new Error("Passkey creation was cancelled", { cause: e });
      }
      // The exclusion list matched: this authenticator already holds one of the
      // voter's passkeys. Retrying only prompts again and fails again.
      if (e instanceof DOMException && e.name === "InvalidStateError") {
        throw new PasskeyAlreadyRegisteredError();
      }
      if (i === attempts.length - 1) {
        throw new Error(`Could not create a passkey, ${describe(e)}`, { cause: e });
      }
      console.warn(`Passkey creation with ${attempt.label} failed, retrying:`, describe(e));
    }
  }

  if (!cred) return { registered: false, prfEnabled: false };

  const ext = cred.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };
  localStorage.setItem(CRED_ID_KEY, bufToB64url(cred.rawId));
  localStorage.setItem(CRED_CREATED_KEY, new Date().toISOString());
  localStorage.setItem(CRED_LAST_USED_KEY, new Date().toISOString());
  const evaluated = ext.prf?.results?.first;
  return {
    registered: true,
    prfEnabled: Boolean(ext.prf?.enabled),
    credentialId: bufToB64url(cred.rawId),
    prfSecret: evaluated ? new Uint8Array(evaluated) : undefined,
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
 *
 * The assertion is what decides, never `prf.enabled` from the creation. Windows
 * Hello does not evaluate PRF while creating a credential, so it reports
 * `enabled: false` and then answers the very next `get()` with a valid 32-byte
 * secret (w3c/webauthn#1857). Gating on that flag rejected every Windows Hello
 * passkey as PRF-incapable and silently dropped the voter into the single-device
 * localStorage fallback.
 */
export async function enrollPrfPasskey(
  excludeCredentialIds: string[] = [],
  salt: Uint8Array = IDENTITY_SALT,
): Promise<PrfAssertion | null> {
  const { registered, prfEnabled, credentialId, prfSecret } = await registerCredential(
    salt,
    excludeCredentialIds,
  );
  if (!registered || !credentialId) return null;
  // The authenticator already evaluated the PRF while creating the credential,
  // so the voter is spared a second prompt. Same (credential, salt) pair, so
  // this is the same secret a later assertion would return.
  if (prfSecret) return { credentialId, secret: prfSecret };
  if (!prfEnabled) {
    console.info("Authenticator reported prf.enabled=false at creation, trying the assertion anyway");
  }
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
      // A missing id does NOT mean a missing passkey: it is only this browser's
      // cache, and the authenticator may still hold the credential (the
      // organizer cleared it, moved browser, or wiped site data). Ask for it
      // before minting a new one, because for the organizer a new credential is
      // a new PRF, which is a new Paillier key, which makes every election they
      // created on this device impossible to decrypt.
      const recovered = await assertPrf([], salt);
      if (recovered) return recovered.secret;

      // Only `registered` is load-bearing: see enrollPrfPasskey on why
      // `prf.enabled` from a creation cannot be trusted to mean anything.
      const { registered, prfSecret } = await registerCredential(salt);
      if (!registered) return null; // fall back to stored identity
      if (prfSecret) return prfSecret; // evaluated at creation, no second prompt
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
 * Real passkey authentication gate: asserts an existing credential (biometric /
 * PIN prompt) and registers one only when the person says they have none.
 * Throws with a descriptive message when WebAuthn is unavailable or the user
 * cancels: the caller must NOT let the user through in that case.
 *
 * `intent` is what a missing local credential id means, because it does not
 * mean a missing passkey: it is only THIS browser's cache. An organizer on a
 * second browser, or one who cleared site data, still holds their credential in
 * the authenticator or synced through their password manager.
 *
 * Getting that wrong is not a login annoyance. The organizer's Paillier tally
 * keys are re-derived from the passkey's PRF output and stored nowhere, so a
 * silently minted second credential is a different key for every election they
 * ever created, discovered only when a result refuses to decrypt.
 * `derivePrfSecret` already asks the authenticator before minting; this is the
 * same rule on the login path, which is where the fork actually started.
 */
export async function authenticatePasskey(intent: PasskeyIntent = "existing"): Promise<void> {
  if (!isWebAuthnAvailable()) {
    throw new Error("This browser does not support passkeys (WebAuthn)");
  }
  assertSecureContext();

  const credId = localStorage.getItem(CRED_ID_KEY);

  // Nothing cached: ask the authenticator what it has, unless the person has
  // explicitly said this is their first passkey. The empty allowCredentials
  // list is what reaches a synced passkey, and, over WebAuthn's hybrid
  // transport, one that lives on their phone and answers by QR.
  if (!credId && intent === "existing") {
    const recovered = await assertPrf();
    if (recovered) return;
    throw new NoPasskeyFoundError();
  }

  if (!credId) {
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

  // Cached id: assert that exact credential, which keeps the prompt narrow.
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
    // user deleted it). Drop it so the next attempt can discover another.
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
