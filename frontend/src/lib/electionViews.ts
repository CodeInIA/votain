/**
 * Where each view of an election lives, and who is allowed to switch to it.
 *
 * Kept out of the component so a page can import the rule without importing the
 * button, and so the button file exports nothing but a component.
 */

/**
 * Where "view as a voter would" leads.
 *
 * One path whoever is asking. The election page reads the session itself and
 * shows the ballot or the invitation to verify, so there is no longer a voter
 * copy of it to choose between. The signature keeps its second argument off:
 * nothing about the destination depends on it any more.
 */
export function voterViewHref(electionId: string): string {
  return `/election/${electionId}`;
}

export function organizerViewHref(electionId: string): string {
  return `/organizer/election/${electionId}`;
}

/**
 * Whether the person looking at a voter view may switch to the organizer one.
 *
 * Both halves matter: owning the election without a live organizer session
 * offers a route that bounces, and a live session on somebody else's election
 * offers a page that would refuse to load.
 */
export function canManageElection(
  organizerLoggedIn: boolean,
  walletAddress: string | undefined,
  organizerAddress: string | undefined,
): boolean {
  if (!organizerLoggedIn || !walletAddress || !organizerAddress) return false;
  return walletAddress.toLowerCase() === organizerAddress.toLowerCase();
}
