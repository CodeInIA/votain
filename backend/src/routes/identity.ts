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
  resetVault,
  CommitmentMismatchError,
  VaultUnavailableError,
} from '../identity/vault.js';
import { registerOnChain, rotateOnChain, isRegistrarConfigured } from '../chain/registrar.js';
import { verifySession } from '../auth/session.js';
import { verifyWorldIdProof, type WorldIdPayload } from '../auth/worldId.js';

const router = Router();

/// Rebinding a voting identity is a heavy, auditable operation. A tight limit
/// keeps a leaked World App from being replayed into a rotation storm.
const recoverLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Reads the voter's World ID nullifier from their verified session cookie. */
async function sessionNullifier(req: Request): Promise<string | null> {
  const session = await verifySession(req.cookies?.voter_vc);
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
router.post('/identity/vault', async (req: Request, res: Response) => {
  const nullifier = await sessionNullifier(req);
  if (!nullifier) return res.status(401).json({ error: 'Not authenticated' });

  const { credentialId, blob, commitment } = req.body as {
    credentialId?: string;
    blob?: string;
    commitment?: string;
  };

  if (!credentialId || !blob || !commitment) {
    return res.status(400).json({ error: 'credentialId, blob and commitment are required' });
  }
  if (!/^\d+$/.test(commitment)) {
    return res.status(400).json({ error: 'commitment must be a decimal string' });
  }

  const isFirstEntry = (await getVault(nullifier)) === null;

  // Check the chain BEFORE writing. A human already bound to another commitment
  // would otherwise get an entry the chain will never honour, and every later
  // enroll would fail with an unrelated-looking NotPlatformVerified.
  if (isFirstEntry && isRegistrarConfigured()) {
    const probe = await registerOnChain(nullifier, commitment);
    if (probe.boundToOtherIdentity) {
      return res.status(409).json({ error: probe.error, code: 'bound_to_other_identity' });
    }
    if (!probe.registered) {
      return res.status(502).json({ error: probe.error, code: 'registration_failed' });
    }

    const record = await putVaultEntry(nullifier, commitment, { credentialId, blob });
    return res.status(200).json({
      commitment: record.commitment,
      passkeyCount: record.entries.length,
      onchainRegistered: true,
      registrationTx: probe.txHash,
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
router.delete('/identity/vault/:credentialId', async (req: Request, res: Response) => {
  const nullifier = await sessionNullifier(req);
  if (!nullifier) return res.status(401).json({ error: 'Not authenticated' });

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

  if (!credentialId || !blob || !commitment || !worldIdProof) {
    return res
      .status(400)
      .json({ error: 'credentialId, blob, commitment and worldIdProof are required' });
  }
  if (!/^\d+$/.test(commitment)) {
    return res.status(400).json({ error: 'commitment must be a decimal string' });
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
  // exists, so they are dropped rather than left to rot.
  const record = await resetVault(proof.nullifier, commitment, { credentialId, blob });

  return res.status(200).json({
    commitment: record.commitment,
    passkeyCount: record.entries.length,
    rotationTx: rotated.txHash,
  });
});

export default router;
