import { getRegistry } from "./contracts";
import { isChainConfigured } from "./deployments";

/**
 * Whether the chain still knows the voter this browser thinks it is signed in
 * as.
 *
 * THE GAP THIS FILLS. The session is a credential in a cookie, issued by the
 * backend, and it says nothing about the chain. `PlatformRegistry` is where a
 * human actually becomes a member, and the two can part company: the local
 * chain is wiped and redeployed, the platform is deployed somewhere else, an
 * identity is rotated from another device. The cookie stays valid for its seven
 * days through all of it, so the app went on offering a voter their history and
 * an enrol button while the registry had never heard of them, and the first
 * sign of trouble was a revert with a name that reads like an accusation
 * (`NotPlatformVerified`).
 *
 * NOTHING HERE PROMPTS. It compares a nullifier and a commitment, both public,
 * both already on this device: the session's own nullifier, which `/api/me`
 * reports, and the commitment cached beside it. Asking the passkey to unseal
 * the secret on every page load would be the obvious way to check and the wrong
 * one, since an authenticator dialog is not something to summon to draw a
 * badge.
 */

export type MembershipVerdict =
  /** The chain could not answer. Never a reason to end anything. */
  | "unknown"
  /** The registry holds this human, with the identity this browser has. */
  | "registered"
  /** The registry has never heard of this human. */
  | "not-registered"
  /** The human is registered, under an identity this browser does not hold. */
  | "other-identity";

/**
 * Asks the registry about one human.
 *
 * `storedCommitment` is what this browser believes it votes with. Pass null
 * when it holds none: a voter part-way through setting up is signed in and not
 * yet registered, and that is a stage rather than a problem.
 */
export async function checkPlatformMembership(
  nullifier: string,
  storedCommitment: bigint | null,
): Promise<MembershipVerdict> {
  if (!isChainConfigured()) return "unknown";

  try {
    const registry = getRegistry();
    const known: boolean = await registry.registeredNullifiers(BigInt(nullifier));
    if (!known) return "not-registered";

    // Registered, but as whom. `commitmentOf` is the identity currently active
    // for this human; a rotation moves it, and a browser left behind keeps the
    // old one, which enrols nowhere.
    const active: bigint = await registry.commitmentOf(BigInt(nullifier));
    if (storedCommitment === null) return "registered";
    return active === storedCommitment ? "registered" : "other-identity";
  } catch (error: unknown) {
    // An unreachable node, a wrong address, a chain still starting up. All of
    // them mean "no answer", and acting on no answer would sign people out of
    // a working session every time their connection hiccuped.
    console.warn("Could not ask the registry about this session:", error);
    return "unknown";
  }
}
