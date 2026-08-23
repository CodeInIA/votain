/**
 * Encrypted identity vault (client side).
 *
 * A voter has ONE Semaphore identity. Two active identities for the same human
 * would produce two independently countable ballots that no contract could
 * correlate, so multi-device support cannot mean "one identity per passkey".
 * Instead the single secret is stored once per passkey, each copy sealed under
 * a key derived from that passkey's WebAuthn PRF output.
 *
 * The issuer stores only ciphertext. The PRF secret never leaves the
 * authenticator, so the server cannot decrypt the identity and therefore cannot
 * compute the voter's per-election Semaphore nullifiers or link them to ballots.
 *
 * Wrapping: HKDF-SHA256(prf, info) -> AES-256-GCM key; blob = iv ‖ ciphertext.
 */

const HKDF_INFO = new TextEncoder().encode("votain:identity-vault:v1");
const IV_BYTES = 12;

const BACKEND = import.meta.env.VITE_BACKEND_URL as string | undefined;

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

/** Derives the AES key for one passkey from its PRF output. */
async function wrappingKey(prfSecret: Uint8Array): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", prfSecret as BufferSource, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: HKDF_INFO },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapSecret(prfSecret: Uint8Array, identitySecret: string): Promise<string> {
  const key = await wrappingKey(prfSecret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(identitySecret),
    ),
  );

  const blob = new Uint8Array(iv.length + ciphertext.length);
  blob.set(iv, 0);
  blob.set(ciphertext, iv.length);
  return b64urlEncode(blob);
}

/** Returns null when this PRF secret does not open the blob (wrong passkey). */
export async function unwrapSecret(prfSecret: Uint8Array, blob: string): Promise<string | null> {
  try {
    const raw = b64urlDecode(blob);
    const key = await wrappingKey(prfSecret);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, IV_BYTES) },
      key,
      raw.slice(IV_BYTES),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────
// Backend sync
// ────────────────────────────────────────────────

export interface VaultEntry {
  credentialId: string;
  blob: string;
  addedAt: string;
}

export interface VaultState {
  /** Decimal string, or null when this voter has no identity yet. */
  commitment: string | null;
  entries: VaultEntry[];
}

function requireBackend(): string {
  if (!BACKEND) throw new Error("VITE_BACKEND_URL is not configured");
  return BACKEND;
}

/** Reads this voter's wrapped secrets. Requires the SD-JWT session cookie. */
export async function fetchVault(): Promise<VaultState | null> {
  const res = await fetch(`${requireBackend()}/api/identity/vault`, {
    credentials: "include",
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Vault read failed: ${res.status}`);
  return (await res.json()) as Promise<VaultState>;
}

export interface VaultWriteResult {
  commitment: string;
  passkeyCount: number;
  onchainRegistered: boolean;
  registrationTx?: string;
  registrationError?: string;
}

/** Registers one passkey as able to unlock this voter's identity. */
export async function putVaultEntry(params: {
  credentialId: string;
  blob: string;
  commitment: string;
}): Promise<VaultWriteResult> {
  const res = await fetch(`${requireBackend()}/api/identity/vault`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });

  if (res.status === 409) {
    // The server already holds a different identity for this human. Binding a
    // second one is exactly what would enable a double vote, so it is refused;
    // recovery is PlatformRegistry.rotateMember, not a new vault entry.
    throw new Error(
      "This World ID is already bound to a different identity. Unlock it with one of your existing passkeys, or ask the issuer to reset it.",
    );
  }
  if (!res.ok) throw new Error(`Vault write failed: ${res.status}`);
  return (await res.json()) as Promise<VaultWriteResult>;
}

export async function removeVaultEntry(credentialId: string): Promise<void> {
  const res = await fetch(
    `${requireBackend()}/api/identity/vault/${encodeURIComponent(credentialId)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Vault delete failed: ${res.status}`);
  }
}

/**
 * Recovery: rebind this voter to a brand new identity after losing every
 * passkey that could open the old one.
 *
 * Authorised by a FRESH World ID proof, not by the session: this replaces the
 * identity the human votes with, so a stolen session must not be enough. Sent
 * with `credentials: "omit"` for the same reason the ballot is, the proof is
 * the authorisation and the cookie would add nothing but a linkage.
 */
export async function recoverIdentity(params: {
  credentialId: string;
  blob: string;
  commitment: string;
  worldIdProof: unknown;
}): Promise<{ commitment: string; rotationTx?: string }> {
  const res = await fetch(`${requireBackend()}/api/identity/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `Recovery failed: ${res.status}`);
  }
  return (await res.json()) as Promise<{ commitment: string; rotationTx?: string }>;
}
