/**
 * Identity vault endpoints.
 *
 * Lets a voter unlock their single Semaphore identity from any of their
 * passkeys. Everything stored here is ciphertext or public data; see
 * `identity/vault.ts` for why the issuer must not be able to decrypt it.
 *
 * Authentication is the voter's SD-JWT session cookie, so a vault can only be
 * read or written by the human it belongs to.
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getVault,
  putVaultEntry,
  removeVaultEntry,
  clearVault,
  resetVault,
  CommitmentMismatchError,
  VaultUnavailableError,
} from '../identity/vault.js';
import { registerOnChain, rotateOnChain, isRegistrarConfigured } from '../chain/registrar.js';
import { verifySession } from '../auth/session.js';
import { readSessionCookie } from '../auth/cookie.js';
import { verifyWorldIdProof, type WorldIdPayload } from '../auth/worldId.js';
import { perVoterLimit, requireSession, sessionOf } from '../auth/voterLimit.js';
import { chainFailure, errorMessage } from '../utils/errors.js';

const router = Router();

/// Rebinding a voting identity is a heavy, auditable operation. A tight limit
/// keeps a leaked World App from being replayed into a rotation storm.
const recoverLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Vault writes are registry transactions the platform pays for, so they are
 * counted per voter. A voter adds a passkey a handful of times in their life;
 * ten an hour is a ceiling nobody honest meets.
 */
const vaultWriteQuota = perVoterLimit(60 * 60 * 1000, 10);

/**
 * The ceilings `PlatformRegistry` enforces, checked here first so an oversized
 * request is refused before it costs a simulation. A WebAuthn credential id is
 * at most 1023 bytes by specification; a sealed secret is an IV, a recovery
 * phrase and a tag.
 */
const MAX_CREDENTIAL_ID_BYTES = 1023;
const MAX_VAULT_BLOB_BYTES = 512;
const MAX_VAULT_ENTRIES = 8;

/** Why a base64url vault field is unacceptable, or null when it is fine. */
function vaultFieldProblem(value: unknown, maxBytes: number, name: string): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return `${name} must be base64url`;
  }
  if (Buffer.from(value, 'base64url').length > maxBytes) {
    return `${name} must be at most ${maxBytes} bytes`;
  }
  return null;
}

/** Reads the voter's World ID nullifier from their verified session cookie. */
async function sessionNullifier(req: Request): Promise<string | null> {
  const session = await verifySession(readSessionCookie(req));
  return session?.nullifier ?? null;
}

// ────────────────────────────────────────────────
// GET /identity/vault: wrapped secrets for this voter
// ────────────────────────────────────────────────
router.get('/identity/vault', async (req: Request, res: Response) => {
  const nullifier = await sessionNullifier(req);
  if (!nullifier) return res.status(401).json({ error: 'Not authenticated' });

  // The vault lives in `PlatformRegistry`, so with no chain configured there is
  // nothing to read and no file to fall back on. Reported as unavailable rather
  // than as a server error: the deployment is incomplete, not broken, and the
  // browser can tell a voter to try again instead of showing them a stack.
  let record;
  try {
    record = await getVault(nullifier);
  } catch (error: unknown) {
    if (error instanceof VaultUnavailableError) {
      return res.status(503).json({ error: error.message, code: 'vault_unavailable' });
    }
    throw error;
  }
  return res.status(200).json({
    commitment: record?.commitment ?? null,
    entries: (record?.entries ?? []).map(e => ({
      credentialId: e.credentialId,
      blob: e.blob,
      addedAt: e.addedAt,
    })),
  });
});

// ────────────────────────────────────────────────
// POST /identity/vault: register a passkey for this identity
// ────────────────────────────────────────────────
router.post('/identity/vault', requireSession, vaultWriteQuota, async (req: Request, res: Response) => {
  const nullifier = sessionOf(res).nullifier;

  const { credentialId, blob, commitment } = req.body as {
    credentialId?: string;
    blob?: string;
    commitment?: string;
  };

  if (!commitment) {
    return res.status(400).json({ error: 'commitment is required' });
  }
  if (!/^\d+$/.test(commitment)) {
    return res.status(400).json({ error: 'commitment must be a decimal string' });
  }
  // Both or neither. One without the other is a caller bug, and accepting it
  // would write half a vault entry that no assertion could ever open.
  if (Boolean(credentialId) !== Boolean(blob)) {
    return res.status(400).json({ error: 'credentialId and blob go together' });
  }
  if (credentialId && blob) {
    const problem =
      vaultFieldProblem(credentialId, MAX_CREDENTIAL_ID_BYTES, 'credentialId') ??
      vaultFieldProblem(blob, MAX_VAULT_BLOB_BYTES, 'blob');
    if (problem) return res.status(400).json({ error: problem });
  }

  // Ahead of the read, not after it: `getVault` throws without a configured
  // chain, so every 503 this route can return had to be decided before it.
  if (!isRegistrarConfigured()) {
    return res.status(503).json({
      error: 'The identity vault needs a configured chain connection',
      code: 'vault_unavailable',
    });
  }

  const existing = await getVault(nullifier);
  const isFirstEntry = existing === null;

  // REGISTRATION IS NOT THE SAME FACT AS "HAS A PASSKEY", and this route used to
  // treat them as one: it demanded a credential, so a voter whose authenticator
  // refused to hold the secret was never written to the chain at all. They kept
  // their twelve words, the screen said they were set up, and the first
  // enrollment weeks later failed with NotPlatformVerified. Worse, the next
  // device saw an empty vault, read it as "new voter", and minted a SECOND
  // identity for the same human.
  //
  // `PlatformRegistry` already keeps the two apart: `registerMember` records the
  // human and their commitment, `addVaultEntry` records one passkey that can
  // open it and refuses to run before registration. A body with no credential
  // therefore means exactly "register me, a passkey may follow".
  if (!credentialId || !blob) {
    if (existing && existing.commitment !== commitment) {
      return res.status(409).json({
        error: 'This voter already has a different identity commitment',
        code: 'commitment_mismatch',
      });
    }
    const probe = await registerOnChain(nullifier, commitment);
    if (probe.boundToOtherIdentity) {
      return res.status(409).json({ error: probe.error, code: 'bound_to_other_identity' });
    }
    if (!probe.registered) {
      return res.status(502).json({ error: probe.error, code: 'registration_failed' });
    }
    return res.status(200).json({
      commitment,
      passkeyCount: existing?.entries.length ?? 0,
      onchainRegistered: true,
      registrationTx: probe.txHash,
    });
  }

  // Check the chain BEFORE writing. A human already bound to another commitment
  // would otherwise get an entry the chain will never honour, and every later
  // enroll would fail with an unrelated-looking NotPlatformVerified.
  if (isFirstEntry) {
    const probe = await registerOnChain(nullifier, commitment);
    if (probe.boundToOtherIdentity) {
      return res.status(409).json({ error: probe.error, code: 'bound_to_other_identity' });
    }
    if (!probe.registered) {
      return res.status(502).json({ error: probe.error, code: 'registration_failed' });
    }

    // Registration went through and the vault entry is a SECOND transaction, so
    // it can fail on its own: a registrar out of gas, a reverted call, an RPC
    // that dropped. Outside the try below this used to surface as a bare 500
    // with nothing in it, which is a poor thing to hand somebody asking why
    // their working passkey never reached the chain. The voter is registered
    // either way and their phrase still opens everything, so this reports what
    // is missing rather than pretending the whole request failed.
    try {
      const record = await putVaultEntry(nullifier, commitment, { credentialId, blob });
      return res.status(200).json({
        commitment: record.commitment,
        passkeyCount: record.entries.length,
        onchainRegistered: true,
        registrationTx: probe.txHash,
      });
    } catch (error: unknown) {
      console.error('Registered, but the vault entry did not get written:', errorMessage(error));
      return res.status(502).json({
        error: chainFailure(error),
        code: 'vault_write_failed',
        onchainRegistered: true,
        registrationTx: probe.txHash,
      });
    }
  }

  const replacing = existing?.entries.some(e => e.credentialId === credentialId) ?? false;
  if (!replacing && (existing?.entries.length ?? 0) >= MAX_VAULT_ENTRIES) {
    return res.status(409).json({
      error: `At most ${MAX_VAULT_ENTRIES} passkeys can open one identity`,
      code: 'too_many_passkeys',
    });
  }

  let record;
  try {
    record = await putVaultEntry(nullifier, commitment, { credentialId, blob });
  } catch (error: unknown) {
    if (error instanceof CommitmentMismatchError) {
      // The caller is trying to bind a second identity to one human. Recovery
      // must go through PlatformRegistry.rotateMember instead.
      return res.status(409).json({ error: error.message, code: 'commitment_mismatch' });
    }
    if (error instanceof VaultUnavailableError) {
      return res.status(503).json({ error: error.message, code: 'vault_unavailable' });
    }
    throw error;
  }

  // Additional passkeys for an identity that is already on chain: nothing to
  // register, the commitment has not changed.
  return res.status(200).json({
    commitment: record.commitment,
    passkeyCount: record.entries.length,
    onchainRegistered: true,
  });
});

// ────────────────────────────────────────────────
// DELETE /identity/vault/:credentialId: unlink a passkey
// ────────────────────────────────────────────────
router.delete('/identity/vault/:credentialId', requireSession, vaultWriteQuota, async (req: Request, res: Response) => {
  const nullifier = sessionOf(res).nullifier;

  const record = await getVault(nullifier);
  if (!record) return res.status(404).json({ error: 'No vault for this voter' });

  // Removing the last passkey would strand the identity: the secret exists
  // nowhere else and the on-chain commitment would become unusable.
  if (record.entries.length <= 1) {
    return res.status(409).json({
      error: 'Cannot remove the only passkey, add another device first',
      code: 'last_passkey',
    });
  }

  const credentialId = String(req.params.credentialId);
  const updated = await removeVaultEntry(nullifier, credentialId);
  return res.status(200).json({ passkeyCount: updated?.entries.length ?? 0 });
});

// ────────────────────────────────────────────────
// POST /identity/recover: rebind after losing every passkey
// ────────────────────────────────────────────────
//
// Deliberately NOT authenticated by the session cookie. This endpoint replaces
// the identity a human votes with, so a stolen cookie must not be enough: the
// caller has to present a fresh World ID proof, and the nullifier it yields is
// what we rotate. Nobody can produce a proof carrying someone else's nullifier
// without being that person.
//
// What the voter gets back: a working identity for elections they had not yet
// joined. What they do NOT get: re-entry into elections they already enrolled
// in (ElectionV4 deduplicates by human), nor their old receipts, which were
// derived from the secret that is gone. Both are consequences of the anonymity
// guarantee, not gaps: the chain cannot tell whether they already voted.
router.post('/identity/recover', recoverLimiter, async (req: Request, res: Response) => {
  if (!isRegistrarConfigured()) {
    return res.status(503).json({ error: 'Registrar not configured' });
  }

  const { credentialId, blob, commitment, worldIdProof } = req.body as {
    credentialId?: string;
    blob?: string;
    commitment?: string;
    worldIdProof?: WorldIdPayload;
  };

  if (!commitment || !worldIdProof) {
    return res.status(400).json({ error: 'commitment and worldIdProof are required' });
  }
  if (!/^\d+$/.test(commitment)) {
    return res.status(400).json({ error: 'commitment must be a decimal string' });
  }
  // Both or neither, as on the vault route. Half an entry is a caller bug and
  // writing it would leave a blob no assertion could ever open.
  if (Boolean(credentialId) !== Boolean(blob)) {
    return res.status(400).json({ error: 'credentialId and blob go together' });
  }
  if (credentialId && blob) {
    const problem =
      vaultFieldProblem(credentialId, MAX_CREDENTIAL_ID_BYTES, 'credentialId') ??
      vaultFieldProblem(blob, MAX_VAULT_BLOB_BYTES, 'blob');
    if (problem) return res.status(400).json({ error: problem });
  }

  const proof = await verifyWorldIdProof(worldIdProof);
  if (!proof.ok || !proof.nullifier) {
    return res.status(400).json({ error: 'Invalid World ID proof', details: proof.error });
  }

  const rotated = await rotateOnChain(proof.nullifier, commitment);
  if (!rotated.registered) {
    return res.status(409).json({ error: rotated.error, code: 'rotation_failed' });
  }

  // Only once the chain agrees: the old blobs seal a secret that no longer
  // exists, so they are dropped rather than left to rot. Dropping them is the
  // part that is NOT optional, whatever comes after: they open the commitment
  // `rotateMember` has just revoked, so a browser that found them would assert
  // a passkey, derive the dead identity and fail every enrolment afterwards.
  if (!credentialId || !blob) {
    // NO PASSKEY, WHICH IS NOW A REAL ANSWER HERE. `resetVault` refuses an
    // empty entry, and calling it unconditionally made a working passkey
    // mandatory on the one screen that cannot fall back to the phrase, reached
    // by exactly the people most likely to be on a borrowed machine or on an
    // authenticator that creates credentials it will not evaluate.
    await clearVault(proof.nullifier);
    return res.status(200).json({
      commitment,
      passkeyCount: 0,
      rotationTx: rotated.txHash,
    });
  }

  const record = await resetVault(proof.nullifier, commitment, { credentialId, blob });

  return res.status(200).json({
    commitment: record.commitment,
    passkeyCount: record.entries.length,
    rotationTx: rotated.txHash,
  });
});

export default router;
