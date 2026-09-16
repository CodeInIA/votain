import { describe, it, expect } from 'vitest';
import { electionHrefFor } from './electionViews';

/**
 * Where a card leads, which depends on who is reading the list.
 *
 * Every list but the organizer's dashboard linked to the public page, and that
 * is right until the reader owns the election: an organizer browsing Discover
 * clicked one of their own and landed on the page their voters see, with the
 * controls a click further away and nothing saying why.
 */

const MINE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const SOMEBODY_ELSE = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const ID = '0xB281e17F2a4c91364867CBE7a128ABeA6f3Dc8D9';

const href = (over: Partial<Parameters<typeof electionHrefFor>[0]> = {}) =>
  electionHrefFor({
    electionId: ID,
    listView: 'public',
    activeRole: 'organizer',
    organizerLoggedIn: true,
    walletAddress: MINE,
    organizerAddress: MINE,
    ...over,
  });

describe('electionHrefFor', () => {
  it('sends an organizer to their own panel for their own election', () => {
    expect(href()).toBe(`/organizer/election/${ID}`);
  });

  it('sends them to the public page for somebody else\'s', () => {
    expect(href({ organizerAddress: SOMEBODY_ELSE })).toBe(`/election/${ID}`);
  });

  it('respects a voter who happens to own it', () => {
    // Both sessions, wearing the voter one: looking at your own election as a
    // voter would is a thing organizers do before opening enrolment, and the
    // switch inside the page is there for when they want the other side.
    expect(href({ activeRole: 'voter' })).toBe(`/election/${ID}`);
  });

  it('sends a visitor to the public page', () => {
    expect(
      href({ activeRole: 'public', organizerLoggedIn: false, walletAddress: undefined }),
    ).toBe(`/election/${ID}`);
  });

  it('keeps the dashboard pointing at the panel whatever else is true', () => {
    expect(href({ listView: 'organizer', activeRole: 'voter' })).toBe(`/organizer/election/${ID}`);
  });

  it('does not offer the panel to an organizer session that is not live', () => {
    // A remembered address with no session behind it would route to a page
    // that bounces straight back.
    expect(href({ organizerLoggedIn: false })).toBe(`/election/${ID}`);
  });

  it('matches addresses regardless of how they were capitalised', () => {
    expect(href({ organizerAddress: MINE.toLowerCase() })).toBe(`/organizer/election/${ID}`);
  });
});
