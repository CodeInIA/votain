/**
 * The organizer's tally master secret, and the passkeys that can open it.
 *
 * THE PROBLEM THIS SOLVES. Tally keys are re-derived from the passkey's PRF
 * output rather than stored, which is what keeps them off every disk. It also
 * meant a different passkey was a different key: an organizer signing in on a
 * second browser, or replacing a lost authenticator, silently lost the ability
 * to decrypt every election they had already created. Passkey sync hid it for
 * some people and not others, and the failure surfaced only at the tally, long
 * after the mistake.
 *
 * So the secret is generated once and sealed under each passkey, exactly as the
 * voter's identity vault does, with the sealed copies in `OrganizerVault` on
 * chain. The wallet is the key there because it already owns the organizer's
 * elections; no operator has to vouch for anything.
 *
 * NOTHING CHANGES FOR EXISTING ELECTIONS. The first copy seals the PRF output
 * of the passkey already in use, so the master secret IS what that organizer
 * has always derived from, and every key they can currently compute stays
 * exactly the same. The migration happens on the next tally, silently and
 * without a version flag to get wrong.
 */
import { Contract, type JsonRpcProvider, type Signer } from "ethers";

import { addresses } from "./deployments";
import { getReadProvider } from "./contracts";
import { derivePrfSecret, getCachedCredentialId, assertPrf, enrollPrfPasskey } from "./passkeyPrf";
import { wrapSecret, unwrapSecret } from "./identityVault";

const VAULT_ABI = [
  "function addEntry(bytes credentialId, bytes blob)",
  "function removeEntry(bytes credentialId)",
  "function entriesOf(address organizer) view returns (tuple(bytes credentialId, bytes blob, uint64 addedAt)[])",
  "function entryCount(address organizer) view returns (uint256)",
];

/**
 * PRF-eval salt for the organizer's tally master secret, independent from the
 * voter identity secret derived from the same passkey.
 *
 * Exported so  evaluates the PRF on the same salt this vault seals
 * with. Two copies of it would agree until one of them was edited, and then
 * disagree by producing a secret that opens nothing.
 */
export const TALLY_PRF_SALT = new TextEncoder().encode("votain:tally-key:v1");

export interface OrganizerVaultEntry {
  credentialId: string;
  blob: string;
  addedAt: Date;
}

/** Thrown when this passkey holds no sealed copy and cannot make one. */
export class VaultLockedError extends Error {
  constructor() {
    super("This passkey cannot open your tally vault");
    this.name = "VaultLockedError";
  }
}

export class VaultUnavailableError extends Error {
  constructor() {
    super("OrganizerVault address not configured");
    this.name = "VaultUnavailableError";
  }
}

/**
 * The credential id travels as bytes on chain and as base64url everywhere in
 * the browser, the same convention the backend vault used.
 *
 * Exported for its test: a mismatch here does not throw, it makes every entry
 * unfindable, which reads exactly like a vault that was never written.
 */
export const toHex = (b64url: string): string => {
  const pad = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return "0x" + [...raw].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
};

export const fromHex = (hex: string): string => {
  const bytes = hex.slice(2).match(/.{2}/g) ?? [];
  const raw = String.fromCharCode(...bytes.map(h => parseInt(h, 16)));
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function vaultContract(runner: Signer | JsonRpcProvider): Contract {
  if (!addresses.organizerVault) throw new VaultUnavailableError();
  return new Contract(addresses.organizerVault, VAULT_ABI, runner);
}

/** Every passkey that can open this organizer's vault. */
export async function fetchOrganizerVault(address: string): Promise<OrganizerVaultEntry[]> {
  const raw = (await vaultContract(getReadProvider()).entriesOf(address)) as [string, string, bigint][];
  return raw.map(([credentialId, blob, addedAt]) => ({
    credentialId: fromHex(credentialId),
    blob: fromHex(blob),
    addedAt: new Date(Number(addedAt) * 1000),
  }));
}

/**
 * The secret every tally key is derived from.
 *
 * Four cases, and the order matters:
 *
 * 1. This passkey already has a sealed copy: open it. The ordinary path.
 * 2. The vault is empty: this organizer predates it, so the current PRF output
 *    BECOMES the master secret and is sealed. Their existing elections keep
 *    deriving what they always did.
 * 3. There are copies but none for this passkey, and another one on this device
 *    can be reached: open through it, then seal a copy for this one too.
 * 4. Nothing here can open it: refuse. Minting a fresh secret would be the
 *    silent fork this vault exists to prevent, so the caller must add this
 *    passkey from a device that already works.
 */
export async function getTallyMasterSecret(signer: Signer): Promise<Uint8Array> {
  const address = await signer.getAddress();
  const entries = await fetchOrganizerVault(address);
  const prf = await derivePrfSecret(TALLY_PRF_SALT);
  if (!prf) throw new VaultLockedError();

  const credentialId = getCachedCredentialId();

  // 1. A copy sealed under the passkey in hand.
  const mine = credentialId ? entries.find(e => e.credentialId === credentialId) : undefined;
  if (mine) {
    const opened = await unwrapSecret(prf, mine.blob);
    if (opened) return hexToBytes(opened);
  }

  // 2. Nothing sealed yet: adopt what this organizer has always derived from.
  if (entries.length === 0) {
    if (!credentialId) throw new VaultLockedError();
    await sealFor(signer, credentialId, prf, prf);
    return prf;
  }

  // 3. Another passkey on this authenticator may hold a copy.
  const other = await assertPrf(entries.map(e => e.credentialId), TALLY_PRF_SALT);
  if (other) {
    const entry = entries.find(e => e.credentialId === other.credentialId);
    const opened = entry ? await unwrapSecret(other.secret, entry.blob) : null;
    if (opened) {
      const master = hexToBytes(opened);
      // The passkey we started with is worth sealing for, so the next sign in
      // on this device does not go through the picker again.
      if (credentialId && credentialId !== other.credentialId) {
        await sealFor(signer, credentialId, prf, master);
      }
      return master;
    }
  }

  // 4.
  throw new VaultLockedError();
}

/**
 * Registers ANOTHER passkey and seals the same master secret under it.
 *
 * Runs on a device that can already open the vault, because sealing needs the
 * plaintext. That is the same shape as the voter's "add this device", and the
 * reason a new machine is enrolled from the old one rather than the other way
 * round.
 */
export async function addPasskeyToVault(signer: Signer): Promise<OrganizerVaultEntry[]> {
  const master = await getTallyMasterSecret(signer);
  const address = await signer.getAddress();
  const entries = await fetchOrganizerVault(address);

  const enrolled = await enrollPrfPasskey(
    entries.map(e => e.credentialId),
    TALLY_PRF_SALT,
  );
  if (!enrolled) throw new Error("The new passkey could not evaluate PRF");

  await sealFor(signer, enrolled.credentialId, enrolled.secret, master);
  return fetchOrganizerVault(address);
}

/** Drops a passkey. The contract refuses the last one; see `OrganizerVault`. */
export async function removePasskeyFromVault(
  signer: Signer,
  credentialId: string,
): Promise<void> {
  await (await vaultContract(signer).removeEntry(toHex(credentialId))).wait();
}

async function sealFor(
  signer: Signer,
  credentialId: string,
  prfSecret: Uint8Array,
  master: Uint8Array,
): Promise<void> {
  const blob = await wrapSecret(prfSecret, bytesToHex(master));
  await (await vaultContract(signer).addEntry(toHex(credentialId), toHex(blob))).wait();
}

const bytesToHex = (b: Uint8Array): string =>
  [...b].map(x => x.toString(16).padStart(2, "0")).join("");

const hexToBytes = (hex: string): Uint8Array =>
  new Uint8Array((hex.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)));
