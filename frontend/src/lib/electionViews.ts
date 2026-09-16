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

/**
 * Where a card in a LIST should lead.
 *
 * The organizer's own dashboard has always linked to their panel, and every
 * other list linked to the public page, which is right until the person
 * reading it owns the election: an organizer browsing Discover clicked one of
 * their own and landed on the page their voters see, with the controls a click
 * further away and nothing saying why.
 *
 * ONLY WHILE THEY ARE WEARING THE ROLE. Somebody with both sessions who is
 * acting as a voter means it: they are looking at their own election as a
 * voter would, which is a thing organizers do before opening enrolment, and
 * the switch inside the page takes them across when they want it.
 */
export function electionHrefFor(options: {
  electionId: string;
  /** The list this card belongs to. `organizer` is their own dashboard. */
  listView: 'public' | 'voter' | 'organizer';
  /** The role the person is currently acting as. */
  activeRole: string;
  organizerLoggedIn: boolean;
  walletAddress: string | undefined;
  organizerAddress: string | undefined;
}): string {
  const { electionId, listView, activeRole, organizerLoggedIn } = options;
  if (listView === 'organizer') return organizerViewHref(electionId);

  const mine = canManageElection(organizerLoggedIn, options.walletAddress, options.organizerAddress);
  return activeRole === 'organizer' && mine
    ? organizerViewHref(electionId)
    : voterViewHref(electionId);
}
