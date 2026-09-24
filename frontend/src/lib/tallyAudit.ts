/**
 * Checks a published result against the chain, with no key and no trust.
 *
 * Reads what anyone can read: every `VoteCast`, the election's public key and
 * counter base, the published counters and the `TallyProofPublished` event,
 * and runs `verifyTally` over them. The answer is the same for every reader,
 * which is what makes the result verifiable rather than merely published.
 */
import { getElection } from "./contracts";
import { eventArgs, queryLogsFrom } from "./logs";
import { counterBaseFor } from "./paillier";
import { decodeTallyProof, finalBallots, verifyTally } from "./tallyProof";

export type TallyAudit =
  | { status: "verified"; validBallots: number; invalidBallots: number; voters: number }
  | { status: "failed"; reason: string; voters: number }
  /** Published by a contract that predates the proof, so there is nothing to check. */
  | { status: "unproven"; voters: number };

export async function auditPublishedTally(address: string): Promise<TallyAudit> {
  const election = getElection(address);
  const [pkJson, metadataJson, tally, distinctVoters] = await Promise.all([
    election.paillierPublicKey() as Promise<string>,
    election.metadataJson() as Promise<string>,
    election.tally() as Promise<bigint[]>,
    election.distinctVoters() as Promise<bigint>,
  ]);
  const voters = Number(distinctVoters);

  const proofEvents = await queryLogsFrom(election, election.filters.TallyProofPublished());
  if (proofEvents.length === 0) return { status: "unproven", voters };
  const published = eventArgs<{ invalidBallots: bigint; proof: string }>(proofEvents[0]);

  let proof;
  try {
    proof = decodeTallyProof(published.proof);
  } catch {
    return { status: "failed", reason: "the published proof cannot be read", voters };
  }

  const { n, g } = JSON.parse(pkJson) as { n: string; g: string };
  const voteEvents = await queryLogsFrom(election, election.filters.VoteCast());
  const ballots = finalBallots(
    voteEvents.map(e => {
      const args = eventArgs<{ nullifier: bigint; voteCiphertext: string; nonce: bigint }>(e);
      return { nullifier: args.nullifier, nonce: args.nonce, ciphertext: args.voteCiphertext };
    }),
  );

  const verdict = verifyTally({
    publicKey: { n: BigInt(n), g: BigInt(g) },
    ballots,
    counts: [...tally],
    invalidBallots: published.invalidBallots,
    proof,
    base: counterBaseFor(metadataJson),
  });

  return verdict.ok
    ? { status: "verified", validBallots: verdict.validBallots, invalidBallots: verdict.invalidBallots, voters }
    : { status: "failed", reason: verdict.reason, voters };
}
