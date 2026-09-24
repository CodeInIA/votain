/**
 * A voter's ballots in one election: reading their chain, building the next
 * ballot and proving it.
 *
 * WHAT A VOTER'S CHAIN IS. Every ballot is filed on chain under a tag,
 * Poseidon(TAG, secret, scope, k), for k = 0, 1, 2... Only the voter can
 * compute those tags, so only the voter can tell which ballots are theirs;
 * everyone else sees a list of unrelated ballots. Finding one's place in the
 * chain is therefore a walk: compute tag 0, look for it, then tag 1, and so on
 * until a tag is missing. That tag is the next ballot's, and the ballot found
 * under the tag before it is the one the next ballot cancels.
 *
 * WHAT IS PROVED, in the browser, with the ballot circuit (circuits/src): that
 * the voter is on the roll, that the ballot is one option, that it cancels the
 * voter's own previous ballot, and that the tags are theirs. See ballotCrypto
 * for the arithmetic and the circuit for the statement.
 */
import type { Identity } from "@semaphore-protocol/identity";
import { LeanIMT } from "@zk-kit/lean-imt";
import { poseidon2, poseidon3, poseidon4 } from "poseidon-lite";

import {
  ballotCalldata,
  ballotCircuitInputs,
  ballotTag,
  epochTag,
  solidityProof,
  unflattenPoints,
  type CastBallot,
  type Point,
  type SolidityProof,
} from "./ballotCrypto";
import { getElection } from "./contracts";
import { eventArgs, queryLogsFrom } from "./logs";
import { fetchElectionGroup } from "./semaphore";

/** A ballot as the chain shows it. B lists hold the slots the election uses. */
export interface BallotEvent {
  tag: bigint;
  index: number;
  leaf: bigint;
  voteA: Point;
  voteB: Point[];
  timestamp: Date;
  txHash: string;
}

/** The public parameters every ballot in an election is built against. */
export interface BallotContext {
  address: string;
  circuitSlots: number;
  keys: Point[];
  scope: bigint;
}

export async function readBallotContext(address: string): Promise<BallotContext> {
  const election = getElection(address);
  const [slots, keys, scope] = await Promise.all([
    election.circuitSlots() as Promise<bigint>,
    election.tallyKeys() as Promise<bigint[]>,
    election.scope() as Promise<bigint>,
  ]);
  return { address, circuitSlots: Number(slots), keys: unflattenPoints(keys), scope };
}

/** Every ballot cast in an election, in the order they joined the ballots tree. */
export async function fetchBallots(address: string, slotsInUse?: number): Promise<BallotEvent[]> {
  const election = getElection(address);
  const events = await queryLogsFrom(election, election.filters.BallotCast());
  return events.map(e => {
    const args = eventArgs<{
      tag: bigint;
      index: bigint;
      leaf: bigint;
      voteA: bigint[];
      voteB: bigint[];
      timestamp: bigint;
    }>(e);
    const voteB = unflattenPoints(args.voteB);
    return {
      tag: args.tag,
      index: Number(args.index),
      leaf: args.leaf,
      voteA: [args.voteA[0], args.voteA[1]],
      voteB: slotsInUse === undefined ? voteB : voteB.slice(0, slotsInUse),
      timestamp: new Date(Number(args.timestamp) * 1000),
      txHash: e.transactionHash,
    };
  });
}

/**
 * Where a voter stands: their ballots so far, oldest first, and the step the
 * next one takes. Needs the voter's secret and nothing else from them.
 */
export function voterChain(
  secret: bigint,
  scope: bigint,
  ballots: readonly BallotEvent[],
): { mine: BallotEvent[]; next: bigint } {
  const byTag = new Map(ballots.map(b => [b.tag, b]));
  const mine: BallotEvent[] = [];
  for (let k = 0n; ; k++) {
    const found = byTag.get(ballotTag(poseidon4, secret, scope, k));
    if (!found) return { mine, next: k };
    mine.push(found);
  }
}

/** This voter already cast a ballot in the current epoch; the next one opens at `nextAt`. */
export class EpochAlreadyUsedError extends Error {
  constructor(readonly nextAt: Date) {
    super("You already voted in this hour. You can change your vote again after " + nextAt.toISOString());
    this.name = "EpochAlreadyUsedError";
  }
}

/**
 * Where the proving artefacts for one circuit size are served from.
 *
 * VITE_CIRCUITS_URL in a deployment: the files belong to the ceremony that
 * produced the deployed verifiers and are far too large for the repository, so
 * they are published with the deployment (an IPFS pin, say) rather than built
 * with the site. Locally, `circuits/scripts/build.mjs` copies them into
 * `public/circuits/`. A wrong file is harmless beyond wasting the voter's time:
 * its proofs simply fail on chain.
 */
export function circuitFiles(kind: "ballot" | "tally", slots: number): { wasm: string; zkey: string } {
  const root = (import.meta.env.VITE_CIRCUITS_URL as string | undefined) ?? `${import.meta.env.BASE_URL ?? "/"}circuits`;
  const base = `${root.replace(/\/$/, "")}/${kind}_s${slots}`;
  return { wasm: `${base}.wasm`, zkey: `${base}.zkey` };
}

export interface PreparedBallot {
  ballot: CastBallot;
  calldata: ReturnType<typeof ballotCalldata>;
  proof: SolidityProof;
  /** The step of the voter's chain this ballot is. Zero on a first ballot. */
  k: bigint;
}

/**
 * Builds and proves the voter's next ballot for `choice` (blank = numOptions).
 *
 * Proving takes seconds and a few hundred megabytes, and the artefacts are
 * fetched the first time: the caller shows progress.
 */
export async function prepareBallot(
  address: string,
  identity: Identity,
  choice: number,
): Promise<PreparedBallot> {
  const election = getElection(address);
  const context = await readBallotContext(address);
  const secret = identity.secretScalar;

  const [ballots, group, epoch, epochLength] = await Promise.all([
    fetchBallots(address, context.keys.length),
    fetchElectionGroup(address),
    election.currentEpoch() as Promise<bigint>,
    election.EPOCH_LENGTH() as Promise<bigint>,
  ]);

  // Checked before proving, because the proof would be refused anyway and it
  // is seconds of work the voter should not wait through for nothing.
  if (await election.usedEpochTags(epochTag(poseidon4, secret, context.scope, epoch))) {
    throw new EpochAlreadyUsedError(new Date(Number((epoch + 1n) * epochLength) * 1000));
  }

  const memberIndex = group.indexOf(identity.commitment);
  if (memberIndex < 0) throw new Error("This identity is not enrolled in this election");
  const votersPath = group.generateMerkleProof(memberIndex);

  const { mine, next } = voterChain(secret, context.scope, ballots);
  const previousBallot = mine.at(-1) ?? null;

  // The ballots tree as it stands, rebuilt from the events. A first ballot
  // proves nothing against it, so it takes the chain's own current root, which
  // stays valid however many ballots land before this one does.
  let ballotsRoot: bigint = await election.ballotsRoot();
  let previous: Parameters<typeof ballotCircuitInputs>[0]["previous"] = null;
  if (previousBallot) {
    const tree = new LeanIMT<bigint>((a, b) => poseidon2([a, b]), ballots.map(b => b.leaf));
    const path = tree.generateProof(previousBallot.index);
    ballotsRoot = path.root;
    previous = { a: previousBallot.voteA, b: previousBallot.voteB, path };
  }

  const { inputs, ballot } = ballotCircuitInputs({
    poseidon3,
    poseidon4,
    circuitSlots: context.circuitSlots,
    secret,
    scope: context.scope,
    epoch,
    keys: context.keys,
    choice,
    k: next,
    voters: { root: votersPath.root, index: votersPath.index, siblings: votersPath.siblings },
    ballotsRoot,
    previous,
  });

  const { groth16 } = await import("snarkjs");
  const files = circuitFiles("ballot", context.circuitSlots);
  const { proof } = await groth16.fullProve(inputs, files.wasm, files.zkey);

  return {
    ballot,
    calldata: ballotCalldata(ballot, { votersRoot: votersPath.root, ballotsRoot, epoch }),
    proof: solidityProof(proof),
    k: next,
  };
}
