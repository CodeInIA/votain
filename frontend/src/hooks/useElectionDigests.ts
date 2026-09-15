/**
 * Every election, read as cheaply as an election can be read.
 *
 * FOR THE TWO SCREENS THAT CANNOT BE PAGINATED. The receipt verifier searches
 * for one ballot among all of them, and the vote history looks for this voter's
 * ballots; both give a wrong answer if an election was not loaded, and the wrong
 * answer is the alarming one. "No such receipt" is what the verifier says about
 * a forgery, and a vote missing from your history is a vote you would reasonably
 * believe was lost.
 *
 * So the list stays complete and the READING gets cheaper: both screens use
 * three fields, and a digest is three calls per election where hydrating the
 * full model is about eighteen.
 *
 * `scope` narrows it further where the question allows. History is only ever
 * about elections this voter enrolled in, and the chain indexes those.
 */
import { useEffect, useState } from 'react';
import { ELECTIONS } from '../data/seed';
import { isChainConfigured } from '../lib/deployments';
import {
  fetchElectionDigests,
  fetchEnrolledElectionAddresses,
  type ElectionDigest,
} from '../lib/chainElections';
import { getStoredCommitment } from '../lib/semaphore';

export type { ElectionDigest };

interface DigestState {
  digests: ElectionDigest[];
  loading: boolean;
  live: boolean;
}

/**
 * Seed elections, in the same shape, so screens have one code path.
 *
 * Carrying the seed's `id` as the address, because on chain the two ARE the same
 * value and every screen here routes by it: the seed's own `contractAddress` is
 * an invented string that no route and no history record refers to, so a lookup
 * keyed on it silently matches nothing and the demo loses its links to results.
 */
const SEED_DIGESTS: ElectionDigest[] = ELECTIONS.map(e => ({
  contractAddress: e.id,
  title: e.title,
  phase: e.phase,
  resultsPublished: e.candidates.some(c => c.votes !== undefined),
}));

export function useElectionDigests(scope: 'all' | 'enrolled' = 'all'): DigestState {
  const live = isChainConfigured();
  const [digests, setDigests] = useState<ElectionDigest[]>(live ? [] : SEED_DIGESTS);
  const [loading, setLoading] = useState(live);

  useEffect(() => {
    if (!live) return; // seed digests are already the initial state
    let cancelled = false;

    void (async () => {
      try {
        let addresses: string[] | undefined;
        if (scope === 'enrolled') {
          const commitment = getStoredCommitment();
          addresses = commitment === null ? [] : await fetchEnrolledElectionAddresses(commitment);
        }
        const read = await fetchElectionDigests(addresses);
        if (!cancelled) setDigests(read);
      } catch (e) {
        console.error('Could not read the election list:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [live, scope]);

  return { digests, loading, live };
}
