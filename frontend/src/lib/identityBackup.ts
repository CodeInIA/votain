import type { VaultState } from "./identityVault";

/**
 * The voter's own copy of their sealed identity.
 *
 * The vault lives on chain, which answers "what if the server disappears". This
 * answers the one it does not: what if the CHAIN is unreachable, or the entry
 * was removed, or the voter simply wants their identity in their own hands
 * rather than in anyone's system. It is the same ciphertext, in a file they
 * hold.
 *
 * IT IS NOT A SECRET IN THE USUAL SENSE, and saying so plainly matters more
 * than warning about it. The blob is sealed under a key derived from the
 * passkey's WebAuthn PRF output, which never leaves the authenticator. A file
 * without the passkey opens nothing, which is exactly why it is safe to write
 * to disk, mail to yourself, or print. What it protects against is losing
 * access to the vault, not losing the passkey: lose that and no copy of this
 * file helps, which is what `/identity/recover` exists for.
 */

/** Bumped only if the shape changes in a way an older reader would misread. */
const BACKUP_VERSION = 1;

export interface IdentityBackup {
  format: "votain-identity-backup";
  version: number;
  /** Decimal string. Public, and the value the chain binds this human to. */
  commitment: string;
  entries: Array<{ credentialId: string; blob: string; addedAt?: string }>;
  exportedAt: string;
}

export function buildBackup(vault: VaultState): IdentityBackup {
  if (!vault.commitment) throw new Error("This voter has no identity to export");
  return {
    format: "votain-identity-backup",
    version: BACKUP_VERSION,
    commitment: vault.commitment,
    entries: vault.entries.map(e => ({
      credentialId: e.credentialId,
      blob: e.blob,
      addedAt: e.addedAt,
    })),
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Reads a file back, refusing anything that is not one of ours.
 *
 * Strict on purpose. A backup that parses but is wrong produces a passkey that
 * "does not open your identity", which is indistinguishable to the voter from
 * having lost it. Better to say the file is not a Votain backup.
 */
export function parseBackup(text: string): IdentityBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not a Votain identity backup");
  }

  const backup = raw as Partial<IdentityBackup>;
  if (backup?.format !== "votain-identity-backup") {
    throw new Error("That file is not a Votain identity backup");
  }
  if (typeof backup.version !== "number" || backup.version > BACKUP_VERSION) {
    throw new Error("That backup was written by a newer version of Votain");
  }
  if (typeof backup.commitment !== "string" || !/^\d+$/.test(backup.commitment)) {
    throw new Error("That backup carries no identity commitment");
  }
  if (!Array.isArray(backup.entries) || backup.entries.length === 0) {
    throw new Error("That backup carries no sealed keys");
  }
  for (const entry of backup.entries) {
    if (typeof entry?.credentialId !== "string" || typeof entry?.blob !== "string") {
      throw new Error("That backup is missing part of a sealed key");
    }
  }

  return backup as IdentityBackup;
}

/**
 * A filename the voter can find again in a year.
 *
 * Dated, and carrying the first characters of the commitment so two backups
 * from two identities do not overwrite each other in a downloads folder.
 */
export function backupFilename(backup: IdentityBackup): string {
  const day = backup.exportedAt.slice(0, 10);
  return `votain-identity-${backup.commitment.slice(0, 8)}-${day}.json`;
}

/** Hands the file to the browser. Returns the name it was saved under. */
export function downloadBackup(backup: IdentityBackup): string {
  const name = backupFilename(backup);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return name;
}
