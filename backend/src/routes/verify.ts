import { Router, Request, Response } from 'express';
import { sdJwt, SELECTIVE_DISCLOSURE_FRAME, type VotainCredentialPayload } from '../sd/issuer.js';
import { statusIndexFor, DEFAULT_LIST_ID } from '../status/statusList.js';
import { verifySession } from '../auth/session.js';
import {
  readSessionCookie,
  setSessionCookie,
  clearSessionCookie,
  readPendingCookie,
  setPendingCookie,
  clearPendingCookie,
} from '../auth/cookie.js';
import { sanitiseCallbackUrl } from '../utils/callbackUrl.js';
import {
  startPendingVerification,
  readPendingVerification,
  endPendingVerification,
} from '../auth/worldIdBridge.js';
import { verifyWorldIdProof, worldIdAction, type WorldIdPayload } from '../auth/worldId.js';

const router = Router();

// ────────────────────────────────────────────────
// GET /me: check for an active session
// ────────────────────────────────────────────────
router.get('/me', async (req: Request, res: Response) => {
  // The signature is checked, not just the payload decoded. Without that, a
  // handcrafted `header.{"sub":"…","exp":<future>}.garbage` cookie would be
  // accepted as any voter's session.
  const session = await verifySession(readSessionCookie(req));
  if (!session) {
    // Cleared with the attributes it was set with, or the browser keeps it and
    // every later request arrives with a credential this server has refused.
    clearSessionCookie(res);
    return res.status(401).json({ authenticated: false });
  }

  return res.status(200).json({
    authenticated: true,
    nullifier: session.nullifier,
    // The level this session was signed in with. Not sensitive: it is the
    // holder's own credential, told to the holder. The browser needs it to stop
    // showing a green tick against a requirement the enrollment will refuse.
    // Absent on credentials issued before the claim existed, and the caller has
    // to read that absence as "unproved" rather than as the lowest level.
    personhood: session.personhood,
    /**
     * When this credential stops being one, in seconds.
     *
     * The cookie is httpOnly, so the browser cannot read its own expiry and
     * had no way to know a session had run out other than by trying something
     * and being refused. Telling the holder when their own credential expires
     * gives nothing away and lets the page end the session at the moment it
     * ends rather than at the next failed action.
     */
    expiresAt: session.payload.exp,
  });
});

// ────────────────────────────────────────────────
// POST /logout
// ────────────────────────────────────────────────
router.post('/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res);
  return res.status(200).json({ success: true });
});

// ────────────────────────────────────────────────
// World ID verifications that outlive the tab that started one
//
// See `auth/worldIdBridge` for why they are held here at all. In short: a
// phone discards the backgrounded tab while its owner is in World App, and the
// SDK cannot rebuild a request from its id, so a verification that had already
// SUCCEEDED was being thrown away by the reload.
// ────────────────────────────────────────────────

/** POST /worldid/request — opens one, and names it in an httpOnly cookie. */
router.post('/worldid/request', async (req: Request, res: Response) => {
  try {
    // No `action` from the body, whatever it says: see `worldIdAction`.
    const { returnTo } = req.body as { returnTo?: unknown };

    // One verification per browser at a time. Without this, pressing the
    // button twice leaves the first one orphaned in the store with nothing
    // able to collect it, for the whole five minutes.
    endPendingVerification(readPendingCookie(req));

    const { pendingId, connectorURI } = await startPendingVerification(
      worldIdAction(),
      // KEPT FOR A CLIENT THAT CAN USE IT, which the web frontend is not.
      // `return_to` is a deep link, and World's own example is a custom
      // scheme: `myapp://verify-done`. A native app registers one of those and
      // World App comes back into the running instance. A website can only
      // offer an https address, which Android hands to the DEFAULT browser in
      // a NEW tab, possibly a browser holding none of the voter's cookies. So
      // the web client stopped sending one and this endpoint still takes one,
      // because the parameter is right and it was the caller that was wrong.
      //
      // Sanitised rather than trusted: World App navigates to this on Votain's
      // behalf, so an unchecked value is an open redirect wearing Votain's
      // name.
      sanitiseCallbackUrl(returnTo),
    );

    setPendingCookie(res, pendingId);
    return res.status(200).json({ connectorURI });
  } catch (error: unknown) {
    console.error('Error opening World ID request:', error);
    return res.status(500).json({ error: 'Could not open a World ID request' });
  }
});

/**
 * GET /worldid/request — what became of it.
 *
 * `?wait=1` holds the connection for up to 25 seconds and answers the moment
 * the bridge does, which is both cheaper and quicker than polling. Without it
 * the answer is whatever is true right now, which is what a page asks on mount
 * to find out whether it is resuming something it does not remember starting.
 */
router.get('/worldid/request', async (req: Request, res: Response) => {
  const pendingId = readPendingCookie(req);
  const state = await readPendingVerification(pendingId, req.query.wait ? 25_000 : 0);

  if (!state) {
    // Expired, collected, or never existed. All three mean the same thing to
    // the page: there is nothing of yours here, start one if you want one.
    clearPendingCookie(res);
    return res.status(200).json({ status: 'none' });
  }

  if (state.status === 'confirmed') {
    // Handed over once. The proof is a bearer credential, so a cookie that
    // leaks after this moment is worth nothing.
    endPendingVerification(pendingId);
    clearPendingCookie(res);
    return res.status(200).json({ status: 'confirmed', result: state.result });
  }

  if (state.status === 'failed') {
    endPendingVerification(pendingId);
    clearPendingCookie(res);
    return res.status(200).json({ status: 'failed', error: state.error });
  }

  // The connector URI comes back with it, so a page that was reloaded mid-flow
  // can put the QR code back up instead of only knowing that something is out
  // there. It is not a secret: it is what gets rendered as a QR code.
  return res.status(200).json({ status: 'waiting', connectorURI: state.connectorURI });
});

/** DELETE /worldid/request — the person pressed cancel. */
router.delete('/worldid/request', (req: Request, res: Response) => {
  endPendingVerification(readPendingCookie(req));
  clearPendingCookie(res);
  return res.status(200).json({ success: true });
});

// ────────────────────────────────────────────────
// POST /verify-human
// Verifies the World ID proof, issues the SD-JWT VC (selective disclosure +
// revocation status) and registers the voter's Semaphore identity commitment
// in the on-chain PlatformRegistry.
// ────────────────────────────────────────────────
router.post('/verify-human', async (req: Request, res: Response) => {
  try {
    const worldIdPayload = req.body as WorldIdPayload;

    // Through the shared helper rather than a second copy of the fetch. This
    // route had its own, and both were missing the credential-level check, so
    // the hole had to be closed twice or not at all.
    const verified = await verifyWorldIdProof(worldIdPayload);
    if (!verified.ok) {
      console.error('World ID verification failed:', verified.error);
      return res.status(400).json({ error: 'Invalid World ID proof', details: verified.error });
    }

    const nullifier_hash = verified.nullifier ?? '';

    // The slot belongs to the HUMAN and is assigned by `registerMember`, so
    // signing in costs no transaction. Zero until they are registered, which is
    // the state a first-time voter is in while the vault write is still to come;
    // the credential then carries no status entry rather than a wrong one.
    const statusIndex = await statusIndexFor(nullifier_hash);
    const baseUrl = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

    const now = Math.floor(Date.now() / 1000);
    const credentialPayload: VotainCredentialPayload = {
      iss: process.env.ISSUER_DID ?? 'https://issuer.votain.local',
      sub: nullifier_hash,
      iat: now,
      exp: now + 7 * 24 * 60 * 60,
      vct: 'votain:voter-credential:v1',
      // Recorded now so an election that demands an Orb can be answered without
      // sending the voter through World ID a second time. Sign-in itself still
      // accepts any credential: Orbs were withdrawn from Spain, and gating the
      // front door on one would lock out the voters this project is for.
      personhood: verified.level,
      // NO IDENTITY ATTRIBUTES. This credential used to assert a country, a
      // region and `ageOver18: true` for everybody, as placeholders. A signed
      // credential is a statement by the issuer, and nothing here has verified
      // any of those facts: age and nationality are proved per election, from
      // the voter's own document, through `eligibility/`. The selective
      // disclosure frame stays for when a verified source provides them.
      //
      // A status entry only once the human HAS a slot. Slot 0 names nobody and
      // could never be revoked; a first-time voter is registered moments later,
      // and `verifySession` then checks the slot their registration assigned.
      ...(statusIndex > 0
        ? {
            credentialStatus: {
              id: `${baseUrl}/api/credentials/status/${DEFAULT_LIST_ID}#${statusIndex}`,
              type: 'StatusList2021Entry' as const,
              statusPurpose: 'revocation' as const,
              statusListIndex: String(statusIndex),
              statusListCredential: `${baseUrl}/api/credentials/status/${DEFAULT_LIST_ID}`,
            },
          }
        : {}),
    };

    const issuedCredential = await sdJwt.issue(credentialPayload, SELECTIVE_DISCLOSURE_FRAME);

    // On-chain registration does NOT happen here. The voter resolves their
    // Semaphore identity from the encrypted vault first (which may require
    // unlocking with a passkey from another device), and POST /identity/vault
    // registers the resulting commitment. Doing it here would force a brand new
    // identity on every device, and a human with two identities can vote twice.

    // The SD-JWT itself is the session, in an httpOnly cookie no script can
    // read. Name and attributes live in `auth/cookie`: see it for why the
    // name carries the `__Host-` prefix.
    setSessionCookie(res, issuedCredential);

    return res.status(200).json({
      success: true,
      message: 'Human verified successfully',
      nullifier: nullifier_hash,
    });

  } catch (error: unknown) {
    console.error('Error verifying human:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
