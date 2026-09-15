/**
 * World ID proof requests.
 *
 * Extracted so the login flow and the identity-recovery flow can share one
 * implementation of the RP-signature + QR dance. They need the same proof for
 * different reasons: login turns it into a session, recovery turns it into
 * authority to rebind the voter's on-chain identity.
 *
 * The proof itself is what matters in both cases. World ID returns only public
 * values (merkle root, nullifier hash, the proof, verification level), so this
 * never yields anything that could serve as the voter's Semaphore secret; see
 * `identityVault.ts` for where that actually comes from.
 *
 * WHAT SIGNING IN NO LONGER CLAIMS. It establishes an account, not a person.
 * Personhood comes from the document proof an election asks for, recorded on
 * chain as `usedPersonhoodNullifiers`; see `lib/eligibility.ts`.
 */
import { IDKit, deviceLegacy, type IDKitResult } from "@worldcoin/idkit-core";
import { backendBase } from "./backend";



/**
 * STILL ON A 3.0 PRESET, AND EXACTLY WHY.
 *
 * World ID 4.0 knows four credentials: `proof_of_human` (an Orb), `passport`
 * and `mnc` (an NFC document), and `selfie` (a liveness check). There is no
 * device level and no successor that means the same thing.
 *
 * In Spain that leaves nothing a voter can actually hold. Orbs were withdrawn,
 * and NEITHER of the two checks that would replace them has launched here:
 * not the document one (which is why documents are proved through Self instead,
 * see `eligibility.ts`), and not the face one that `selfie` is issued from.
 * Cutting over today would lock out every voter who did not already own an Orb,
 * which is very nearly all of them. World says the same in its own migration
 * guide: confirm the users you support can produce the required v4 credentials
 * before cutting over.
 *
 * WHAT THIS PRESET IS ACTUALLY BUYING, because it is not personhood. At this
 * level World ID does not promise one account per human, and that promise is
 * not what the platform leans on: an election that needs it asks for an Orb at
 * ENROLLMENT. What it does provide is a STABLE, REPRODUCIBLE identifier for an
 * account, which is the only thing that makes recovery possible. A passkey
 * cannot do that job: it proves possession of a device, and recovery is exactly
 * the case where the device is gone.
 *
 * THE MIGRATION, and what to watch for. It becomes possible the day either
 * check ships in Spain. The face one is the one-for-one replacement for what
 * this preset asks: same population, same absence of a uniqueness guarantee,
 * but native to 4.0, and access has to be requested from World
 * (developers@toolsforhumanity.com). The document one would be better still,
 * since it is unique per document. Then this whole flow becomes:
 *
 *   allow_legacy_proofs: false,
 *   .constraints(any(CredentialRequest("selfie"), CredentialRequest("proof_of_human")))
 *
 * and the backend needs no change: it already grades 4.0 responses by
 * `identifier` and `issuer_schema_id`.
 */

export interface WorldIdRequestOptions {
  /** Called once the QR / deep-link URI is ready, so the UI can render it. */
  onConnectorUri?: (uri: string) => void;
  /** Overrides the configured action (each action yields its own nullifier). */
  action?: string;
}

/**
 * Runs a full World ID request and resolves with the proof, or null when the
 * user abandons it. Throws only on configuration or transport failures.
 */
export async function requestWorldIdProof(
  opts: WorldIdRequestOptions = {},
): Promise<IDKitResult | null> {

  const action = opts.action ?? (import.meta.env.VITE_WORLD_ID_ACTION as string) ?? "vote-registration";
  // IDKit types the app id as a literal `app_${string}`; the env value is a
  // plain string, so the shape is asserted here rather than at every call site.
  const appId = import.meta.env.VITE_WORLD_ID_APP_ID as `app_${string}`;
  const rpId = import.meta.env.VITE_WORLD_ID_RP_ID as string;

  // The issuer signs the request so World ID can attribute it to this app.
  const sigRes = await fetch(`${backendBase()}/api/rp-signature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ action }),
  });
  if (!sigRes.ok) throw new Error("Failed to fetch rp-signature");

  const rpSig = (await sigRes.json()) as {
    sig: string;
    nonce: string;
    created_at: number;
    expires_at: number;
  };

  const request = await IDKit.request({
    app_id: appId,
    action,
    rp_context: {
      rp_id: rpId,
      nonce: rpSig.nonce,
      created_at: rpSig.created_at,
      expires_at: rpSig.expires_at,
      signature: rpSig.sig,
    },
    allow_legacy_proofs: true,
    // NO `return_to`, AND IT WAS TRIED. The field exists and does what it says:
    // World App offers a way back instead of leaving somebody staring at it
    // wondering whether anything happened.
    //
    // It cannot be used from a web app. `return_to` is an https address, Android
    // resolves one as an app link, and the destination is then whatever claims
    // it: with the app installed, a voter verifying in a browser tab was handed
    // the INSTALLED copy, which had no verification pending, while the tab they
    // left kept polling out of sight. Restricting it to the installed app fixed
    // the misrouting and exposed the real problem: coming back that way is a
    // COLD START. The request is a live object, the bridge payload is encrypted
    // with a key that lived inside it, and the SDK exposes no way to rebuild one
    // from its `requestId`. The reload therefore discards a verification that
    // had already succeeded, which is worse than the inconvenience it set out
    // to remove.
    //
    // The inconvenience is small, because this is polled over HTTP rather than
    // carried on a relay socket: a poll frozen by backgrounding resumes when the
    // page comes back, and the proof is still waiting. Switching apps by hand
    // costs a tap; a cold start costs the whole verification.
    environment: "production",
    // WHATEVER THE VOTER HAS, rather than demanding an Orb. Orbs were withdrawn
    // from Spain, so asking for personhood at the door would lock out the very
    // voters this exists for. An election that wants Orb asks for it at
    // ENROLLMENT instead, against its own personhood nullifier, where a refusal
    // costs one election rather than the whole account.
    //
    // See ACCEPTED_CREDENTIALS for which ones those are and why.
  }).preset(deviceLegacy({}));

  opts.onConnectorUri?.(request.connectorURI);

  /**
   * Five minutes, not the SDK's fifteen.
   *
   * The bridge is polled over HTTP, once a second, and the default gives up
   * after 900 seconds: a QR somebody opened and walked away from went on asking
   * `bridge.worldcoin.org` nine hundred times. Measured on a real verification,
   * scanning and approving took about twelve requests, so five minutes is
   * generous for the person and cuts the abandoned tail by two thirds.
   *
   * The INTERVAL is deliberately left at the SDK default. It is what World's own
   * widget does, and stretching it is felt directly: the seconds between
   * approving on the phone and the page moving on are seconds of wondering
   * whether anything happened.
   */
  const completion = await request.pollUntilCompletion({ timeout: 5 * 60 * 1000 });
  return completion.success ? completion.result : null;
}
