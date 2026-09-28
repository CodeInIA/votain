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
// One subpath per arity, never the package root: its CommonJS index loads the
// round constants of all sixteen arities, 580 kB the bundler cannot drop.
import { poseidon2 } from "poseidon-lite/poseidon2";
import { poseidon3 } from "poseidon-lite/poseidon3";
import { poseidon4 } from "poseidon-lite/poseidon4";

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
import { getElection, getReadProvider } from "./contracts";
import { circuitsBaseUrl } from "./deployments";
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
 * How long before the epoch turns a proof naming the PREVIOUS epoch is still
 * worth making: proving and relaying take seconds, and once the epoch turns the
 * contract refuses it as stale. Inside this margin the voter waits instead,
 * never more than this long, and the new epoch is free.
 */
export const PREVIOUS_EPOCH_MARGIN_SECONDS = 120n;

/**
 * Which epoch a ballot names: the current one, or the one that just ended.
 *
 * The contract accepts either, each tag once, which is two ballots per voter in
 * any hour. The app used to name only the current epoch, so a voter who had
 * just cast waited for the next clock hour, and a vote forced after the last
 * hour boundary before the close could not be replaced at all. Naming the
 * previous epoch gives that voter one immediate override.
 *
 * CHOSEN AT RANDOM WHEN BOTH ARE FREE, and that is the privacy argument, not a
 * detail. The epoch is public calldata. Were the previous epoch used only once
 * the current one was spent, a ballot naming it would say "this voter already
 * cast this hour": a re-vote, visible, in exactly the last hour where a coercer
 * is watching. Drawn at random, a first ballot names either epoch half the
 * time, a re-vote names whichever is left, and no single ballot says which it
 * is.
 */
export function chooseEpoch(args: {
  current: bigint;
  epochLength: bigint;
  /** Chain time, in seconds: the clock the contract judges staleness by. */
  now: bigint;
  currentUsed: boolean;
  previousUsed: boolean;
  /** Injected for tests; a fair coin otherwise. */
  coin?: () => boolean;
}): bigint {
  const { current, epochLength, now, currentUsed, previousUsed } = args;
  const coin = args.coin ?? (() => crypto.getRandomValues(new Uint8Array(1))[0] < 128);
  const nextAt = (current + 1n) * epochLength;
  const previousUsable = current > 0n && !previousUsed && nextAt - now > PREVIOUS_EPOCH_MARGIN_SECONDS;

  if (!currentUsed && previousUsable) return coin() ? current - 1n : current;
  if (!currentUsed) return current;
  if (previousUsable) return current - 1n;
  throw new EpochAlreadyUsedError(new Date(Number(nextAt) * 1000));
}

/**
 * Where the proving artefacts for one circuit size are served from.
 *
 * The files belong to the ceremony that produced the deployed verifiers and are
 * far too large for the repository, so `circuits/scripts/publish.mjs` uploads
 * them and records the URL in the deployment manifest (`circuitsBaseUrl`).
 * Locally, `circuits/scripts/build.mjs` copies them into `public/circuits/`. A
 * wrong file is harmless beyond wasting the voter's time: its proofs simply
 * fail on chain, and CI checks the published ones against the verifiers.
 */
export function circuitFiles(kind: "ballot" | "tally", slots: number): { wasm: string; zkey: string } {
  const base = `${circuitsBaseUrl}/${kind}_s${slots}`;
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

  const [ballots, group, current, epochLength, block] = await Promise.all([
    fetchBallots(address, context.keys.length),
    fetchElectionGroup(address),
    election.currentEpoch() as Promise<bigint>,
    election.EPOCH_LENGTH() as Promise<bigint>,
    getReadProvider().getBlock("latest"),
  ]);

  // Checked before proving, because the proof would be refused anyway and it
  // is seconds of work the voter should not wait through for nothing.
  const [currentUsed, previousUsed] = await Promise.all([
    election.usedEpochTags(epochTag(poseidon4, secret, context.scope, current)) as Promise<boolean>,
    current > 0n
      ? (election.usedEpochTags(epochTag(poseidon4, secret, context.scope, current - 1n)) as Promise<boolean>)
      : Promise.resolve(true),
  ]);
  const epoch = chooseEpoch({
    current,
    epochLength,
    now: BigInt(block?.timestamp ?? Math.floor(Date.now() / 1000)),
    currentUsed,
    previousUsed,
  });

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
