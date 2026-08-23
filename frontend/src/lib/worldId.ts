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
 */
import { IDKit, orbLegacy, type IDKitResult } from "@worldcoin/idkit-core";

const BACKEND = import.meta.env.VITE_BACKEND_URL as string | undefined;

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
  if (!BACKEND) throw new Error("VITE_BACKEND_URL is not configured");

  const action = opts.action ?? (import.meta.env.VITE_WORLD_ID_ACTION as string) ?? "vote-registration";
  // IDKit types the app id as a literal `app_${string}`; the env value is a
  // plain string, so the shape is asserted here rather than at every call site.
  const appId = import.meta.env.VITE_WORLD_ID_APP_ID as `app_${string}`;
  const rpId = import.meta.env.VITE_WORLD_ID_RP_ID as string;

  // The issuer signs the request so World ID can attribute it to this app.
  const sigRes = await fetch(`${BACKEND}/api/rp-signature`, {
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
    environment: "production",
  }).preset(orbLegacy({}));

  opts.onConnectorUri?.(request.connectorURI);

  const completion = await request.pollUntilCompletion();
  return completion.success ? completion.result : null;
}
