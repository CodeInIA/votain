import { describe, it, expect, beforeEach } from 'vitest';
import { Identity } from '@semaphore-protocol/identity';
import {
  forgetElectionIdentities,
  identityForElection,
  storedElectionCommitment,
} from './electionIdentity';

/**
 * One voter, one secret, a different commitment in every election.
 *
 * The defect this closes: the platform commitment went into every election's
 * tree, and `PlatformRegistry.nullifierOf` names its human publicly, so the
 * chain carried a list of the elections each person had joined. Measured on the
 * local chain before the fix: one commitment appeared in seventeen of the
 * thirty-eight seeded elections, and the registry answered with its World ID
 * nullifier for every one of them.
 */

const ELECTION = '0x979DC264DAE62e8957090F0b6D45B9b0652D1Dee';
const OTHER = '0x2e234DAe75C793f67A35089C9d99245E1C58470b';

beforeEach(() => {
  forgetElectionIdentities();
  localStorage.clear();
});

describe('identityForElection', () => {
  it('derives the same identity every time, so a voter can come back', async () => {
    const master = new Identity('a-voter');

    const first = await identityForElection(master, ELECTION);
    forgetElectionIdentities();
    const again = await identityForElection(master, ELECTION);

    expect(again.commitment).toBe(first.commitment);
  });

  it('derives a different one for another election', async () => {
    const master = new Identity('a-voter');

    const here = await identityForElection(master, ELECTION);
    const there = await identityForElection(master, OTHER);

    expect(there.commitment).not.toBe(here.commitment);
  });

  it('never reuses the platform commitment, which is the one that names them', async () => {
    const master = new Identity('a-voter');

    const here = await identityForElection(master, ELECTION);

    expect(here.commitment).not.toBe(master.commitment);
  });

  it('gives two voters different commitments in the same election', async () => {
    const mine = await identityForElection(new Identity('me'), ELECTION);
    forgetElectionIdentities();
    const theirs = await identityForElection(new Identity('you'), ELECTION);

    expect(theirs.commitment).not.toBe(mine.commitment);
  });

  it('does not care how the address was capitalised', async () => {
    const master = new Identity('a-voter');

    const mixed = await identityForElection(master, ELECTION);
    forgetElectionIdentities();
    const lower = await identityForElection(master, ELECTION.toLowerCase());

    expect(lower.commitment).toBe(mixed.commitment);
  });

  it('remembers the commitment so a badge needs no passkey prompt', async () => {
    const master = new Identity('a-voter');
    expect(storedElectionCommitment(ELECTION)).toBeNull();

    const identity = await identityForElection(master, ELECTION);

    expect(storedElectionCommitment(ELECTION)).toBe(identity.commitment);
    // Only the public half is kept, never anything that could rebuild it.
    expect(JSON.stringify(localStorage)).not.toContain(String(master.privateKey));
  });

  it('forgets everything when the voter signs out', async () => {
    await identityForElection(new Identity('a-voter'), ELECTION);

    forgetElectionIdentities();

    expect(storedElectionCommitment(ELECTION)).toBeNull();
  });
});

describe('identityForElection, across identities in one tab', () => {
  it("never hands one identity's derivation to another", async () => {
    // The cache used to be keyed by election alone, so after a recovery the old
    // identity's commitment kept coming back for elections already visited.
    const before = await identityForElection(new Identity('before-recovery'), ELECTION);
    const after = await identityForElection(new Identity('after-recovery'), ELECTION);
    expect(after.commitment).not.toBe(before.commitment);
  });
});
