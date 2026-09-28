/**
 * Checks a published result against the chain, with no key and no trust.
 *
 * TWO FACTS MAKE A RESULT CORRECT, and this establishes the second:
 *
 *   1. The counts decrypt the election's aggregate. The contract verified the
 *      tally circuit's proof of exactly that before it accepted them, and would
 *      have refused anything else, so there is nothing left to redo here.
 *   2. The aggregate is the sum of the ballots everyone can see. The contract
 *      keeps it itself as ballots arrive; re-adding every `BallotCast` in the
 *      reader's own browser and landing on the same point shows that nothing
 *      was left out and nothing added.
 *
 * The answer is the same for every reader, which is what makes the result
 * verifiable rather than merely published.
 */
import { aggregate as addBallots, equals, unflattenPoints, type Ballot } from "./ballotCrypto";
import { getElection } from "./contracts";
import { eventArgs, queryLogsFrom } from "./logs";

export type TallyAudit =
  | { status: "verified"; ballots: number; voters: number }
  | { status: "failed"; reason: string; voters: number };

export async function auditPublishedTally(address: string): Promise<TallyAudit> {
  const election = getElection(address);
  const [onChain, voters, slots] = await Promise.all([
    election.aggregate() as Promise<[bigint[], bigint[]]>,
    election.voters() as Promise<bigint>,
    election.numOptions().then((n: bigint) => Number(n) + 1),
  ]);

  const events = await queryLogsFrom(election, election.filters.BallotCast());
  const ballots: Ballot[] = events.map(e => {
    const args = eventArgs<{
      tag: bigint;
      voteA: bigint[];
      voteB: bigint[];
      cancelA: bigint[];
      cancelB: bigint[];
    }>(e);
    return {
      tag: args.tag,
      voteA: [args.voteA[0], args.voteA[1]],
      voteB: unflattenPoints(args.voteB),
      cancelA: [args.cancelA[0], args.cancelA[1]],
      cancelB: unflattenPoints(args.cancelB),
    };
  });

  const recomputed = addBallots(ballots, slots);
  const stored = unflattenPoints(onChain[1]);
  const matches =
    equals(recomputed.a, [onChain[0][0], onChain[0][1]]) && recomputed.b.every((p, i) => equals(p, stored[i]));

  return matches
    ? { status: "verified", ballots: ballots.length, voters: Number(voters) }
    : { status: "failed", reason: "the ballots on chain do not add up to the aggregate the result was proved against", voters: Number(voters) };
}
