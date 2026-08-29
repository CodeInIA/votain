/**
 * Where each view of an election lives, and who is allowed to switch to it.
 *
 * Kept out of the component so a page can import the rule without importing the
 * button, and so the button file exports nothing but a component.
 */

/**
 * Where "view as a voter would" leads, mirroring how `ElectionCard` picks its
 * own destination so the two cannot disagree.
 */
export function voterViewHref(electionId: string, voterLoggedIn: boolean): string {
  return voterLoggedIn ? `/voter/election/${electionId}` : `/election/${electionId}`;
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
