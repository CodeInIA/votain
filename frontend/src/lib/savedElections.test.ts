import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Identity } from '@semaphore-protocol/identity';
import {
  forgetSavedElections,
  hasSavedAnything,
  isSaved,
  mergeEntries,
  openEntries,
  savedElectionIds,
  sealEntries,
  toggleSaved,
} from './savedElections';

/**
 * The elections a voter kept, and the two things that can go wrong with them.
 *
 * ONE: the chain must learn nothing. The blob is sealed under a key derived
 * from the voter's own secret, and a list of which elections interest a named
 * human is exactly the record the private enrolment work removed.
 *
 * TWO: two devices must not fight. The same person saves on a phone and unsaves
 * on a laptop, and whichever syncs second must not undo what the other decided
 * afterwards. That is what the merge is, and a merge that simply took the union
 * would resurrect every election they ever removed.
 */

const ELECTION = '0x979DC264DAE62e8957090F0b6D45B9b0652D1Dee';
const OTHER = '0x2e234DAe75C793f67A35089C9d99245E1C58470b';

beforeEach(() => {
  forgetSavedElections();
  localStorage.clear();
  vi.useRealTimers();
});

describe('keeping an election for later', () => {
  it('saves, answers and unsaves', () => {
    expect(isSaved(ELECTION)).toBe(false);

    expect(toggleSaved(ELECTION)).toBe(true);
    expect(isSaved(ELECTION)).toBe(true);
    expect(savedElectionIds()).toEqual([ELECTION.toLowerCase()]);

    expect(toggleSaved(ELECTION)).toBe(false);
    expect(isSaved(ELECTION)).toBe(false);
    expect(savedElectionIds()).toEqual([]);
  });

  it('does not care how an address was capitalised', () => {
    // The chain hands addresses back checksummed, the URL carries them lower
    // case, and a card and a list must not disagree about the same election.
    toggleSaved(ELECTION.toUpperCase());
    expect(isSaved(ELECTION.toLowerCase())).toBe(true);
  });

  it('remembers that something was unsaved, not just that it is not saved', () => {
    // The tombstone is what stops another device's older copy putting it back.
    toggleSaved(ELECTION);
    toggleSaved(ELECTION);
    expect(isSaved(ELECTION)).toBe(false);
    expect(hasSavedAnything()).toBe(true);
  });

  it('survives storage it cannot read', () => {
    localStorage.setItem('votain_saved_elections', 'not json');
    expect(isSaved(ELECTION)).toBe(false);
    expect(savedElectionIds()).toEqual([]);
  });
});

describe('two devices reconciling one list', () => {
  const id = ELECTION.toLowerCase().slice(2);
  const other = OTHER.toLowerCase().slice(2);

  it('keeps the later decision about each election', () => {
    const phone = { [id]: 200 };
    const laptop = { [id]: -300 };
    expect(mergeEntries(phone, laptop)[id]).toBe(-300);
    expect(mergeEntries(laptop, phone)[id]).toBe(-300);
  });

  it('does not resurrect what was removed after it was saved', () => {
    // The union would. An older device that still has the save writes back,
    // and the voter finds an election they deleted sitting in their list.
    const stale = { [id]: 100 };
    const current = { [id]: -400 };
    expect(mergeEntries(current, stale)[id]).toBe(-400);
  });

  it('takes the unsave when both happened in the same second', () => {
    expect(mergeEntries({ [id]: 500 }, { [id]: -500 })[id]).toBe(-500);
    expect(mergeEntries({ [id]: -500 }, { [id]: 500 })[id]).toBe(-500);
  });

  it('brings across what the other device knows about and this one does not', () => {
    const merged = mergeEntries({ [id]: 100 }, { [other]: 200 });
    expect(merged[id]).toBe(100);
    expect(merged[other]).toBe(200);
  });
});

describe('sealing the list', () => {
  const master = new Identity('a voter secret');
  const stranger = new Identity('somebody else');
  const entries = { [ELECTION.toLowerCase().slice(2)]: 1726500000 };
  // One blob carries both roles' lists, because it is one device and one
  // secret; which list an election lands in is the reader's role.
  const lists = { voter: entries, organizer: {} };

  it('comes back exactly as it went in', async () => {
    const blob = await sealEntries(master, lists);
    expect(blob).not.toBeNull();
    expect(await openEntries(master, blob as string)).toEqual(lists);
  });

  it('hides the elections from anyone reading the chain', async () => {
    const blob = (await sealEntries(master, lists)) as string;
    // The address is what a plaintext blob would leak, and the whole reason
    // this is encrypted rather than a list of addresses in a mapping.
    expect(blob.toLowerCase()).not.toContain(ELECTION.toLowerCase().slice(2, 12));
  });

  it("is unreadable with another voter's secret", async () => {
    const blob = (await sealEntries(master, lists)) as string;
    expect(await openEntries(stranger, blob)).toBeNull();
  });

  it('answers null for a blob that is not one', async () => {
    // A substituted or corrupted value. The caller keeps what it has locally
    // rather than showing somebody a decryption error over a bookmark.
    expect(await openEntries(master, 'bm90IGEgYmxvYg')).toBeNull();
  });

  it('reads an empty blob as an empty list', async () => {
    // How a voter who cleared everything is stored, and it must not look like
    // a failure to decrypt.
    expect(await openEntries(master, '')).toEqual({ voter: {}, organizer: {} });
  });

  it('lets a device that unlocked once keep syncing without another tap', async () => {
    // In passkey mode the secret is not at rest, so every reload leaves it
    // locked. Without the remembered key the list would never sync, since
    // nobody accepts an authenticator prompt to reconcile a bookmark.
    const blob = (await sealEntries(master, lists)) as string;
    expect(await openEntries(null, blob)).toEqual(lists);
    expect(await sealEntries(null, lists)).not.toBeNull();
  });

  it('has nothing to seal with on a device that never unlocked', async () => {
    forgetSavedElections();
    expect(await sealEntries(null, lists)).toBeNull();
    expect(await openEntries(null, 'bm90IGEgYmxvYg')).toBeNull();
  });

  it('uses a fresh iv every time, so two writes do not look alike', async () => {
    const first = await sealEntries(master, lists);
    const second = await sealEntries(master, lists);
    expect(first).not.toEqual(second);
  });
});

describe('two roles, two lists, one person', () => {
  it("keeps the organizer's bookmarks out of the voter's", () => {
    toggleSaved(ELECTION, 'voter');
    toggleSaved(OTHER, 'organizer');

    expect(isSaved(ELECTION, 'voter')).toBe(true);
    expect(isSaved(ELECTION, 'organizer')).toBe(false);
    expect(savedElectionIds('voter')).toEqual([ELECTION.toLowerCase()]);
    expect(savedElectionIds('organizer')).toEqual([OTHER.toLowerCase()]);
  });

  it('lets the same election be saved in one role and not the other', () => {
    // The case that started this: an organizer cannot save an election they
    // run, and their VOTER self had saved it. One list made the rule reach
    // across and strip the bookmark off a screen dressed for the voter.
    toggleSaved(ELECTION, 'voter');
    expect(isSaved(ELECTION, 'voter')).toBe(true);
    expect(isSaved(ELECTION, 'organizer')).toBe(false);

    toggleSaved(ELECTION, 'organizer');
    expect(isSaved(ELECTION, 'voter')).toBe(true);
    expect(isSaved(ELECTION, 'organizer')).toBe(true);

    toggleSaved(ELECTION, 'organizer');
    expect(isSaved(ELECTION, 'voter')).toBe(true);
    expect(isSaved(ELECTION, 'organizer')).toBe(false);
  });

  it("reads a list written before the split as the voter's", () => {
    // Version 1 blobs carry one list, which is what it was: saving was offered
    // to a voter session alone when they were written.
    localStorage.setItem(
      'votain_saved_elections',
      JSON.stringify({ v: 1, e: { [ELECTION.toLowerCase().slice(2)]: 1726500000 } }),
    );

    expect(isSaved(ELECTION, 'voter')).toBe(true);
    expect(isSaved(ELECTION, 'organizer')).toBe(false);
  });
});
