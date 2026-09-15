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
/**
 * Whether an assertion on THIS device has ever returned a PRF secret.
 *
 * "ok" is written by `assertPrf` and by nothing else, because an assertion
 * that hands back a secret is the only proof that exists. Sealing proves
 * nothing: Chrome and Firefox on Windows evaluate the extension while a
 * credential is being created and refuse to on an assertion.
 *
 * It answers a question the WebAuthn API does not: when an assertion for a
 * known credential id comes back empty, is that a platform that cannot
 * evaluate PRF, or a credential the person has since deleted from their
 * password manager? With "ok" on the record it can only be the second.
 */
const PRF_READBACK_KEY = "votain_prf_readback";
const CRED_CREATED_KEY = "votain_prf_credential_created";
const CRED_LAST_USED_KEY = "votain_prf_credential_last_used";
const RP_NAME = "Votain";

/**
 * Which of the two roles a passkey belongs to.
 *
 * Somebody can hold both, and the app is built for that: the header switches
 * between them. Creating every credential under one name left a password
 * manager showing two identical "votain-user" entries with no way to tell which
 * opens the voter identity and which opens the organizer's tally keys, and
 * deleting the wrong one is not recoverable.
 */
export type PasskeyRole = "voter" | "organizer";

/** The role part of the label. The date is appended when a credential is made. */
const ROLE_LABEL: Record<PasskeyRole, { name: string; displayName: string }> = {
  voter: { name: "votain-voter", displayName: "Votain voter" },
  organizer: { name: "votain-organizer", displayName: "Votain organizer" },
};

/**
 * What the authenticator stores and the password manager shows.
 *
 * THE MOMENT IS PART OF IT, because the role alone is not enough to tell two
 * apart. Somebody with a passkey on two devices, or who enrolled a second one
 * after clearing a browser, sees identical rows in their password manager and no
 * way to know which is which. Deleting the wrong one is not recoverable.
 *
 * The date alone was not enough either, and the reason is this very project:
 * clearing site data and enrolling again is a thing people do several times in
 * one afternoon, and it produced a stack of rows all saying the same day. So the
 * time goes in to the minute, which is as fine as it needs to be for a person
 * deciding which row is the one they just made.
 *
 * LOCAL time, not UTC. The only reader is the person looking at the list, and an
 * hour they did not live through helps nobody recognise anything.
 *
 * Baked in at creation because it has to be: WebAuthn writes these when the
 * credential is made and offers nothing that renames one afterwards. The same
 * reason they are not translated, since a translated name would freeze whatever
 * language was selected that day and then disagree with the interface forever.
 */
export function passkeyLabel(
  role: PasskeyRole,
  when: Date = new Date(),
): { name: string; displayName: string } {
  const pad = (n: number): string => String(n).padStart(2, "0");
  // YYYY-MM-DD, which sorts and reads anywhere, plus the wall clock.
  const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  const hhmm = `${pad(when.getHours())}:${pad(when.getMinutes())}`;

  const base = ROLE_LABEL[role];
  return {
    // No colon in the machine name: it is written into the credential and read
    // back by tooling that has no reason to cope with one.
    name: `${base.name}-${day}-${hhmm.replace(":", "")}`,
    displayName: `${base.displayName} (${day} ${hhmm})`,
  };
}

// Fixed salt → the PRF output is stable for this purpose on a given credential.
// Distinct salts yield independent secrets from the same passkey (domain
// separation): identity for the voter's Semaphore key, tally for the
// organizer's decryption key.
const IDENTITY_SALT = new TextEncoder().encode("votain:semaphore-identity:v1");

/**
 * PRF secrets evaluated during THIS page's life, keyed by salt.
 *
 * Creating a credential returns the secret; asserting one returns it again, and
 * on most platforms the second is how it is obtained whenever it is needed,
 * which is why nothing is kept. Chrome with Windows Hello does the first and
 * refuses the second: measured across seven combinations of residency,
 * allowCredentials and user verification, over http://localhost and over HTTPS,
 * always NotAllowedError. An organizer there could sign in and then not open
 * their own tally vault, so creating an election failed on the device that had
 * just created the passkey.
 *
 * So the value creation already handed us is kept instead of discarded. IN
 * MEMORY ONLY: a reload clears it, which keeps the secret off disk and is the
 * line this does not cross. It makes the session that enrols a passkey work
 * end to end; it does not make the next one work, and on a platform that can
 * re-derive it changes nothing, because the assertion below is tried first and
 * succeeds.
 */
const sessionSecrets = new Map<string, Uint8Array>();

const saltKey = (salt: Uint8Array) => bufToB64url(salt.buffer as ArrayBuffer);

/** Remembers a secret the authenticator just produced, for this page's life. */
function rememberSecret(salt: Uint8Array, secret: Uint8Array): void {
  sessionSecrets.set(saltKey(salt), secret);
}

/** True once an assertion here has actually produced a secret. */
export function prfReadbackProven(): boolean {
  return localStorage.getItem(PRF_READBACK_KEY) === "ok";
}

/** True once an assertion here has been shown to come back without a secret. */
export function prfReadbackFailed(): boolean {
  return localStorage.getItem(PRF_READBACK_KEY) === "failed";
}

/** Recorded after an assertion comes back empty on a credential that exists. */
export function notePrfReadbackFailed(): void {
  if (!prfReadbackProven()) localStorage.setItem(PRF_READBACK_KEY, "failed");
}

/** Drops the verdict, so the next assertion measures again. */
export function clearPrfReadback(): void {
  localStorage.removeItem(PRF_READBACK_KEY);
}

/** Forgets every remembered secret. Called when a session ends. */
export function clearSessionSecrets(): void {
  sessionSecrets.clear();
  // The attempt it belonged to is over with the session, and the next person
  // at this browser must not be offered somebody else's half-made credential.
  unprovenCredential = null;
}

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
 * Thrown when the authenticator refuses to create a passkey because it already
 * holds one that is registered for this voter. Not a failure: the device is
 * already able to vote, and the caller should say so rather than report an error.
 */
/**
 * The person dismissed the passkey prompt.
 *
 * Typed, and not folded into the failures around it, because it means the
 * opposite of them: the device could have done this and was told not to.
 * Somewhere that decides where a secret is kept, those two answers cannot share
 * a branch, and they did: cancelling left a recovery phrase sitting in
 * localStorage in the clear while the screen said it had been restored.
 */
export class PasskeyCancelledError extends Error {
  constructor(cause?: unknown) {
    super("Passkey creation was cancelled", { cause });
    this.name = "PasskeyCancelledError";
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

/**
 * A credential this device just made and cannot use, remembered for the screen.
 *
 * It is real: it exists in the authenticator, it will be offered forever, and
 * it opens nothing here. Nobody asked for it and nobody can remove it but its
 * owner, so the least this app can do is say it is there and that deleting it
 * costs nothing.
 *
 * In memory only, and for this session. It describes what just happened, not a
 * property of the machine: see the note where it is set for why that difference
 * matters.
 */
let unusableCredential: string | null = null;

export function passkeyLeftUnusable(): string | null {
  return unusableCredential;
}

export function forgetUnusablePasskey(): void {
  unusableCredential = null;
}

/**
 * A credential created here whose read-back nobody answered.
 *
 * Not the same as unusable: it exists, it may well work, and the only thing
 * missing is the one assertion that would prove it. It is kept so a RETRY can
 * ask that credential again instead of minting a second one, which is what
 * happened before: the credential is created first and the proof is asked for
 * afterwards, so every dismissed prompt left an unused passkey behind and the
 * next attempt left another. Somebody who hesitated three times ended up with
 * three identical rows in their password manager and no way to tell which was
 * which.
 *
 * In memory, for this page's life, like the session secrets it sits beside:
 * it describes an attempt in progress, not a property of the device.
 */
let unprovenCredential: { credentialId: string; role: PasskeyRole; salt: string } | null = null;

/** The credential a retry would re-use, if there is one. Exported for tests. */
export function pendingUnprovenPasskey(): string | null {
  return unprovenCredential?.credentialId ?? null;
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
/**
 * Where a new credential is allowed to live.
 *
 * "device" asks for the authenticator built into the machine in front of the
 * person: a fingerprint, a face, a PIN. Without it the browser has to offer
 * every transport it knows, and on Android that means a phone with a working
 * fingerprint reader is shown a list of USB and NFC security keys instead.
 *
 * "any" is for the flows that are about a DIFFERENT device: adding a second
 * passkey, or enrolling a security key. There the QR-to-phone option and the
 * security-key option are the whole point, so nothing is narrowed.
 */
export type CredentialTarget = "device" | "any";

async function registerCredential(
  role: PasskeyRole,
  salt: Uint8Array = IDENTITY_SALT,
  excludeCredentialIds: string[] = [],
  target: CredentialTarget = "device",
  /** See the attempt chain below: false drops the `prf.eval` first attempt. */
  evaluateAtCreation = true,
): Promise<{
  registered: boolean;
  prfEnabled: boolean;
  credentialId?: string;
  /** Set only when the authenticator evaluated the PRF during creation. */
  prfSecret?: Uint8Array;
}> {
  assertSecureContext();

  const platformAvailable = target === "device" && (await hasPlatformAuthenticator());

  const base: PublicKeyCredentialCreationOptions = {
    challenge: randomBytes(32),
    rp: { name: RP_NAME, id: window.location.hostname },
    // A fresh id every time, so a second credential never replaces the first:
    // an authenticator keys credentials by (rp.id, user.id), and reusing one
    // would overwrite the passkey a voter still needs.
    user: {
      id: randomBytes(16),
      ...passkeyLabel(role),
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 }, // ES256
      { type: "public-key", alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      // REQUIRED, not preferred. A non-discoverable credential cannot be found
      // by an assertion with an empty allowCredentials list, and that is
      // exactly how a second browser finds an existing passkey and how the
      // organizer vault avoids minting a second identity. "preferred" lets an
      // authenticator quietly create one that discovery can never see.
      residentKey: "required",
      requireResidentKey: true, // the pre-level-2 spelling, for older authenticators
      // `userVerification` and `authenticatorAttachment` are deliberately
      // absent: each attempt below sets its own, and a value here would be
      // dead config that reads as if it applied.
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

  /**
   * What to try, in order, and why there are two dimensions to it.
   *
   * EXTENSIONS, because not every authenticator understands PRF, and one that
   * does not may reject the whole request rather than ignore the extension.
   *
   * ATTACHMENT, because asking for the device's own authenticator is a
   * preference and WebAuthn offers no way to say so: the field is a filter or
   * it is absent. Forcing it turns "no fingerprint here" into a dead end,
   * which on Android arrives as `NotReadableError` from the credential
   * manager. So the platform pass runs first, and anything that says this
   * authenticator cannot serve the request falls through to the unrestricted
   * pass, where a security key or a phone over QR is still offered.
   */
  const extensionAttempts: Array<{ label: string; prf?: AuthenticationExtensionsClientInputs }> = [
    // Asking for the value at creation is an OPTIMISATION, not the contract.
    // W3C's explainer describes `prf: {}` at create() and the evaluation at
    // get(); returning a secret from create() needs hmac-secret-mc, and an
    // authenticator with plain hmac-secret answers it by running a second
    // operation, which verifies the user a second time. Worth paying when the
    // secret is used (a voter sealing their phrase, who would otherwise be
    // prompted again on the next page load) and pure waste when it is not.
    ...(evaluateAtCreation
      ? [{
          label: "prf.eval",
          prf: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
        }]
      : []),
    { label: "prf", prf: { prf: {} } as AuthenticationExtensionsClientInputs },
    { label: "no extensions" },
  ];

  /**
   * The passes, and the user-verification policy each one needs.
   *
   * A platform pass asks for it REQUIRED, because that is the combination
   * Google Password Manager treats as "create a passkey": with
   * `preferred` it declines and Android falls through to the security-key
   * chooser, so the phone in the person's hand never offers its own
   * fingerprint. It is also what makes PRF available, since an authenticator
   * that did not verify the user has nothing to derive a secret from.
   *
   * The unrestricted pass keeps `preferred`, so an older security key that
   * cannot verify a user is still allowed to enrol rather than being turned
   * away by a requirement it has no way to meet.
   */
  const passes: Array<{ attachment?: "platform"; uv: UserVerificationRequirement }> =
    platformAvailable
      ? [{ attachment: "platform", uv: "required" }, { uv: "preferred" }]
      : [{ uv: "preferred" }];

  const attempts = passes.flatMap(pass => extensionAttempts.map(e => ({ ...e, ...pass })));

  /** Errors that mean "not this authenticator", as opposed to "not this request". */
  const cannotServe = (e: unknown) =>
    e instanceof DOMException &&
    ["NotReadableError", "NotSupportedError", "ConstraintError"].includes(e.name);

  let cred: PublicKeyCredential | null = null;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      const publicKey: PublicKeyCredentialCreationOptions = {
        ...base,
        authenticatorSelection: {
          ...base.authenticatorSelection,
          ...(attempt.attachment ? { authenticatorAttachment: attempt.attachment } : {}),
          userVerification: attempt.uv,
        },
        ...(attempt.prf ? { extensions: attempt.prf } : {}),
      };
      cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
      break;
    } catch (e) {
      if (isUserCancellation(e)) {
        throw new PasskeyCancelledError(e);
      }
      // The exclusion list matched: this authenticator already holds one of the
      // voter's passkeys. Retrying only prompts again and fails again.
      if (e instanceof DOMException && e.name === "InvalidStateError") {
        throw new PasskeyAlreadyRegisteredError();
      }
      if (i === attempts.length - 1) {
        throw new Error(`Could not create a passkey, ${describe(e)}`, { cause: e });
      }
      console.warn(
        `Passkey creation with ${attempt.label} on ${attempt.attachment ?? "any"} failed, retrying:`,
        describe(e),
      );
      // No point walking the other extension variants of a pass the
      // authenticator has already refused outright: jump to the next
      // attachment, which is the thing that might actually differ.
      if (cannotServe(e) && attempt.attachment) {
        while (i + 1 < attempts.length && attempts[i + 1].attachment === attempt.attachment) i++;
      }
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
/**
 * What an assertion actually did, for the one caller that must tell the
 * difference.
 *
 * DISMISSED IS NOT INCAPABLE. Both used to arrive as `null`, and the read-back
 * proof in `enrollPrfPasskey` read that single value as a verdict on the
 * authenticator: a person who closed the second prompt (which arrives
 * unannounced on a phone, seconds after the first) had the passkey they had
 * just created branded useless, was told to delete it, and had their phrase
 * written to disk in the clear. The credential was fine.
 *
 *   ok        - a secret came back. This authenticator can do it.
 *   cancelled - the prompt was dismissed, or the platform refused the ceremony.
 *               Says NOTHING about the credential, so nothing may be concluded.
 *   empty     - it answered and carried no secret. That is a real verdict.
 */
export type AssertOutcome =
  | { status: "ok"; assertion: PrfAssertion }
  | { status: "cancelled" }
  | { status: "empty" };

export async function assertPrf(
  credentialIds: string[] = [],
  salt: Uint8Array = IDENTITY_SALT,
): Promise<PrfAssertion | null> {
  const outcome = await assertPrfOutcome(credentialIds, salt);
  return outcome.status === "ok" ? outcome.assertion : null;
}

export async function assertPrfOutcome(
  credentialIds: string[] = [],
  salt: Uint8Array = IDENTITY_SALT,
): Promise<AssertOutcome> {
  if (!isWebAuthnAvailable()) return { status: "empty" };

  // Inside the try on purpose. This is a READ, and every other way of failing
  // it returns null so the caller falls back; an origin that cannot do
  // WebAuthn at all should not be the one exception that throws. Creating a
  // credential still refuses loudly, because there the person asked for it.
  try {
    assertSecureContext();
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

    if (!assertion) {
      console.warn("PRF assertion: the browser returned no credential at all");
      return { status: "empty" };
    }

    const ext = assertion.getClientExtensionResults() as {
      prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
    };
    const secret = ext.prf?.results?.first;
    if (!secret) {
      // SAY WHAT CAME BACK, because "empty" is a verdict on the authenticator
      // and the three ways of reaching it are not the same problem. No `prf`
      // key at all means the extension was dropped (a browser or a transport
      // that does not carry it); `prf` present with no `results` means the
      // authenticator took the request and declined to evaluate; `enabled:
      // false` means it says it cannot. Reading the difference off a console
      // line is the whole reason this is not a bare `return null`.
      console.warn(
        "PRF assertion answered without a secret.",
        JSON.stringify({
          prfPresent: ext.prf !== undefined,
          enabled: ext.prf?.enabled,
          hasResults: ext.prf?.results !== undefined,
          credentialIdsAsked: credentialIds.length,
        }),
      );
      return { status: "empty" };
    }

    const credentialId = bufToB64url(assertion.rawId);
    localStorage.setItem(CRED_ID_KEY, credentialId);
    localStorage.setItem(CRED_LAST_USED_KEY, new Date().toISOString());
    // The only place this is ever written: an assertion that produced a secret.
    localStorage.setItem(PRF_READBACK_KEY, "ok");
    // Whatever was suspected before, this device has just read a secret back.
    // The doubt was about one credential and one moment, and both are over.
    forgetUnusablePasskey();
    const evaluated = new Uint8Array(secret);
    rememberSecret(salt, evaluated);
    return { status: "ok", assertion: { credentialId, secret: evaluated } };
  } catch (e) {
    if (isUserCancellation(e)) return { status: "cancelled" };
    console.warn("PRF assertion failed:", describe(e));
    return { status: "empty" };
  }
}

/**
 * Creates a passkey on THIS device and returns its PRF output, so the caller can
 * wrap the voter's existing identity secret under it. Null when the
 * authenticator cannot do PRF, in which case this device cannot join the vault.
 *
 * NEVER TRUST `prf.enabled` FROM THE CREATION, in either direction. It has been
 * wrong both ways on the same platform, a year apart.
 *
 * Older Windows Hello reported `enabled: false` and then answered the very next
 * `get()` with a valid 32-byte secret (w3c/webauthn#1857); gating on the flag
 * rejected every one of those passkeys as incapable and dropped the voter into
 * the single-device fallback. Windows Hello with hmac-secret does the exact
 * opposite: `enabled: true` AND a real secret at creation, and then
 * NotAllowedError on every assertion that asks for one.
 *
 * Measured on 2026-09-15, isolated from this app: the same credential asserts
 * fine with no `prf` in the request and fails with it, so the extension is what
 * is refused rather than the assertion. That is not a bug this code can fix; it
 * is why the creation secret is kept in memory (see `sessionSecrets`) and why a
 * device is only believed once an assertion has actually returned one
 * (`prfReadbackProven`).
 */
export async function enrollPrfPasskey(
  role: PasskeyRole,
  excludeCredentialIds: string[] = [],
  salt: Uint8Array = IDENTITY_SALT,
  /** Its callers are adding ANOTHER authenticator, so nothing is narrowed. */
  target: CredentialTarget = "any",
  /** False spares a user verification when the creation secret is not wanted. */
  evaluateAtCreation = true,
): Promise<PrfAssertion | null> {
  /**
   * THE RETRY ASKS THE CREDENTIAL THAT ALREADY EXISTS.
   *
   * A dismissed read-back leaves a real passkey on the authenticator, and going
   * straight back to `registerCredential` minted a second one for the same
   * person and the same salt. The retry is the same question as before, so it
   * is put to the same credential: one prompt, no litter, and if it answers,
   * the phrase seals under the passkey they made the first time.
   *
   * ONCE, and then never again for that credential. Dismissing the re-ask
   * clears it, so the following attempt goes the ordinary way and offers every
   * transport the browser has. Without that escape, somebody who cancelled on
   * the laptop because they wanted to use their phone would be handed the
   * laptop's credential on every press, with no way to reach the QR option.
   */
  const pending = unprovenCredential;
  if (pending && pending.role === role && pending.salt === saltKey(salt)) {
    unprovenCredential = null;
    const again = await assertPrfOutcome([pending.credentialId], salt);
    if (again.status === "ok") return again.assertion;
    if (again.status === "cancelled") throw new PasskeyCancelledError();
    // It answered, with nothing. That is the verdict the proof exists to get,
    // and it belongs to this credential rather than to the machine: see the
    // note where `unusableCredential` is set below.
    unusableCredential = pending.credentialId;
    console.info(
      "The passkey created a moment ago answered an assertion without a PRF " +
        "secret, so nothing can be sealed under it.",
    );
    return null;
  }

  const { registered, prfEnabled, credentialId, prfSecret } = await registerCredential(
    role,
    salt,
    excludeCredentialIds,
    target,
    evaluateAtCreation,
  );
  if (!registered || !credentialId) return null;
  // The authenticator already evaluated the PRF while creating the credential,
  // so the voter is spared a second prompt. Same (credential, salt) pair, so
  // this is the same secret a later assertion would return.
  //
  // ON WINDOWS HELLO THE PERSON IS ASKED FOR THEIR PIN TWICE ANYWAY, and it is
  // worth knowing that this is the authenticator rather than anything here,
  // because the obvious "fixes" all cost the same or more.
  //
  // CTAP has two ways to produce the secret while a credential is being made.
  // `hmac-secret-mc` does it in ONE user interaction; the older arrangement
  // needs the creation and then a separate operation to derive the secret, so
  // it verifies the user twice. Windows Hello, which gained hmac-secret in the
  // February 2026 cumulative update, does the second. Verified against a
  // virtual authenticator that supports the single-interaction form: there,
  // one call comes back with the secret and there is exactly one prompt.
  //
  // Dropping `prf.eval` from creation does not help. Creation would then cost
  // one verification and the assertion below another: two again, on every
  // authenticator rather than just this one. What is here is the better of the
  // two, and it only ever affects creation, since signing in afterwards is a
  // single assertion and a single prompt.
  if (prfSecret) {
    rememberSecret(salt, prfSecret);

    // PROVE IT CAN BE READ BACK, ONCE PER DEVICE, BEFORE ANYTHING DEPENDS ON IT.
    //
    // The creation secret is real and usable for this session, and it says
    // nothing about the next one. Windows Hello hands one over and then answers
    // NotAllowedError to every assertion that asks for the same value: measured
    // on 2026-09-15 against a credential that asserts perfectly well with no
    // `prf` in the request. Sealing under a passkey like that writes a vault
    // entry NOBODY can ever open, not that device and not another, because a
    // PRF secret belongs to its authenticator.
    //
    // So it used to be discovered weeks later, by somebody who needed their
    // phrase and could not have it. One assertion here turns that into an
    // answer at the moment of the decision, and the honest one: this device can
    // make a passkey and cannot use it to unlock, so the phrase stays the way
    // back.
    //
    // IT USED TO BE SKIPPED once this device had proven itself, and that was
    // wrong in the one case it mattered. `prfReadbackProven` is a fact about
    // the authenticator this machine reaches by default; the credential just
    // created may live somewhere else entirely, on a phone reached over the QR
    // transport, which has proven nothing. So a voter adding a SECOND passkey
    // got no read-back at all, and whatever the phone returned at creation was
    // sealed on trust: exactly what this proof exists to refuse.
    //
    // The cost is one extra verification when a passkey is created. That is the
    // price of never writing a vault entry nobody can open, and creating one is
    // a deliberate, rare act. Signing in afterwards is still a single prompt.

    const readBack = await assertPrfOutcome([credentialId], salt);
    if (readBack.status === "ok") return readBack.assertion;

    // DISMISSED, WHICH PROVES NOTHING. On a phone this second prompt arrives
    // unannounced seconds after the first, and closing it used to brand the
    // passkey that had just been created as useless: the modal told the voter
    // to delete it and kept their phrase on disk in the clear, about a
    // credential that worked perfectly.
    //
    // Nothing is sealed either, and that is the careful half. The creation
    // secret is real for this session, but the whole reason this proof exists
    // is that an authenticator can hand one over and then refuse every
    // assertion (Windows Hello, measured 2026-09-15), and sealing under one of
    // those writes a vault entry nobody can ever open. A dismissal does not
    // tell the two apart, so nothing may be sealed on the strength of it.
    //
    // Reported as the cancellation it is, for the same reason the creation
    // prompt is: from where the voter stands they closed a passkey dialog, and
    // every screen already knows what to do with that. `/voter/identity` keeps
    // them there with an offer to try again instead of moving on, and the seal
    // offer in the phrase modal says "not linked" rather than "this device
    // cannot", which would be a claim nobody has measured.
    if (readBack.status === "cancelled") {
      // Kept so the retry re-uses it instead of creating another. See the note
      // at the top of this function.
      unprovenCredential = { credentialId, role, salt: saltKey(salt) };
      console.info(
        "The read-back prompt was dismissed, so this passkey is unproven rather " +
          "than unusable: nothing sealed under it, and nothing concluded about it.",
      );
      throw new PasskeyCancelledError();
    }

    // NOT `notePrfReadbackFailed()`, and the difference matters. That flag says
    // THIS DEVICE cannot read a sealed copy back, and it stops the app from
    // prompting on every page load for something guaranteed to fail. What just
    // failed is narrower: ONE authenticator, the one they happened to pick.
    // A phone offered over a QR code is a different authenticator entirely and
    // may evaluate PRF perfectly, so blacklisting the machine would take away
    // the option that still works.
    unusableCredential = credentialId;
    console.info(
      "This authenticator returned a PRF secret while creating the passkey and " +
        "refused to evaluate it on an assertion, so nothing is sealed under it.",
    );
    return null;
  }
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
export async function derivePrfSecret(
  role: PasskeyRole,
  salt: Uint8Array = IDENTITY_SALT,
): Promise<Uint8Array | null> {
  if (!isWebAuthnAvailable()) return null;

  // Asserted or created earlier in this page's life. Checked before prompting,
  // so a platform that cannot evaluate PRF on an assertion still works for as
  // long as the session lasts, and one that can is spared a second prompt.
  const remembered = sessionSecrets.get(saltKey(salt));
  if (remembered) return remembered;

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
      const { registered, prfSecret } = await registerCredential(role, salt);
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

/** Whether a PRF passkey has already been registered on this device. */
export function hasPrfCredential(): boolean {
  return localStorage.getItem(CRED_ID_KEY) !== null;
}

export function clearPrfCredential(): void {
  clearSessionSecrets();
  localStorage.removeItem(CRED_ID_KEY);
  localStorage.removeItem(CRED_CREATED_KEY);
  localStorage.removeItem(CRED_LAST_USED_KEY);
}
