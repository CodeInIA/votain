import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Identity } from '@semaphore-protocol/identity';

/**
 * Finding the elections this voter joined, now that every one of them holds a
 * different commitment.
 *
 * THE BUG THIS PINS. The list was built by asking the chain for
 * `MemberEnrolled` logs indexed by ONE commitment, the platform one. That was
 * exact until enrolments went private and each election started holding a
 * commitment derived for it: the query then matched nothing, so "my elections"
 * was empty for a voter who had just enrolled, in the browser they enrolled
 * from, and in every other browser they owned.
 *
 * There is no single value to filter on any more, and that is the point of the
 * change: nobody else can ask this question. The voter can, because they hold
 * the secret the commitments come from.
 */

const { state } = vi.hoisted(() => ({
  state: {
    /** Every MemberEnrolled log on the chain, as [electionAddress, commitment]. */
    logs: [] as Array<{ address: string; topics: string[] }>,
    known: [] as string[],
    topicsAsked: [] as Array<Array<string | null>>,
  },
}));

vi.mock('./contracts', () => ({
  getElection: () => ({}),
  getFactory: () => ({
    electionsCount: async () => BigInt(state.known.length),
    getElections: async () => state.known,
  }),
  getReadProvider: () => ({}),
}));

vi.mock('./logs', async () => ({
  // The real one: these tests are about reading events, and stubbing the
  // decode would leave the project's only cast unexercised.
  ...(await vi.importActual<typeof import('./logs')>('./logs')),
  queryLogsFrom: async () => [],
  queryTopicLogs: async (_provider: unknown, topics: Array<string | null>) => {
    state.topicsAsked.push(topics);
    return state.logs;
  },
}));

const { fetchEnrolledElectionAddresses } = await import('./chainElections');
const { identityForElection, forgetElectionIdentities } = await import('./electionIdentity');

const PRIVATE_ONE = '0xB281e17F2a4c91364867CBE7a128ABeA6f3Dc8D9';
const PRIVATE_TWO = '0x772a593Fc121E8F1aad79d5B649E19d5ADcf78EB';
const LEGACY = '0x6499a5a51bCa6A9791CC6946d445a9f700627c88';
const SOMEBODY_ELSE = 55555n;

const asTopic = (value: bigint): string => '0x' + value.toString(16).padStart(64, '0');

const enrolment = (address: string, commitment: bigint) => ({
  address,
  topics: ['0xmemberenrolled', asTopic(commitment)],
});

beforeEach(() => {
  forgetElectionIdentities();
  localStorage.clear();
  state.logs = [];
  state.known = [PRIVATE_ONE, PRIVATE_TWO, LEGACY];
  state.topicsAsked = [];
});

describe('fetchEnrolledElectionAddresses', () => {
  it('finds the elections whose leaf this secret derives', async () => {
    const master = new Identity('a-voter');
    const here = await identityForElection(master, PRIVATE_ONE);
    forgetElectionIdentities();
    localStorage.clear();

    state.logs = [
      enrolment(PRIVATE_ONE, here.commitment),
      enrolment(PRIVATE_TWO, SOMEBODY_ELSE),
    ];

    expect(await fetchEnrolledElectionAddresses(master, 999n)).toEqual([PRIVATE_ONE]);
  });

  it('asks for every enrolment, because no single commitment identifies a voter', async () => {
    await fetchEnrolledElectionAddresses(new Identity('a-voter'), 999n);

    // One topic and no second filter: the matching happens in the browser,
    // where the secret is, rather than on an index anybody could query.
    expect(state.topicsAsked[0]).toHaveLength(1);
  });

  it('still finds elections from before enrolments went private', async () => {
    // Their trees hold the platform commitment, which is the whole reason it
    // is still passed in.
    const platform = 4242n;
    state.logs = [enrolment(LEGACY, platform)];

    expect(await fetchEnrolledElectionAddresses(new Identity('a-voter'), platform)).toEqual([LEGACY]);
  });

  it('works from the cache when the secret is locked', async () => {
    // A browser that derived before, then reloaded without unlocking. It knows
    // the commitments it wrote down, and nothing else.
    const master = new Identity('a-voter');
    const here = await identityForElection(master, PRIVATE_TWO);
    state.logs = [enrolment(PRIVATE_TWO, here.commitment)];

    expect(await fetchEnrolledElectionAddresses(null, null)).toEqual([PRIVATE_TWO]);
  });

  it('finds nothing rather than everything when it knows nothing', async () => {
    // No secret and no cache: reading every election to discover that would be
    // a thousand calls to reach an empty list.
    state.logs = [enrolment(PRIVATE_ONE, SOMEBODY_ELSE)];

    expect(await fetchEnrolledElectionAddresses(null, null)).toEqual([]);
  });

  it('never claims an election somebody else enrolled in', async () => {
    const master = new Identity('a-voter');
    state.logs = [
      enrolment(PRIVATE_ONE, SOMEBODY_ELSE),
      enrolment(PRIVATE_TWO, SOMEBODY_ELSE),
      enrolment(LEGACY, SOMEBODY_ELSE),
    ];

    expect(await fetchEnrolledElectionAddresses(master, 999n)).toEqual([]);
  });
});
