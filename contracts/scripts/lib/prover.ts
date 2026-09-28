/**
 * Proves ballots and tallies from Node, exactly as the browser does.
 *
 * The E2E suite and the demo seed both need real proofs against real
 * verifiers, and they should build them the way a voter's browser and an
 * organizer's browser do, or they prove nothing about those. So the inputs
 * come from the same `ballotCrypto.ts` the frontend uses; only the plumbing
 * differs: events via ethers, artefacts from disk.
 *
 * The artefacts are `circuits/build`, produced by `npm run build` in circuits/.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LeanIMT } from "@zk-kit/lean-imt";
import { poseidon2, poseidon3, poseidon4 } from "poseidon-lite";
import * as snarkjs from "snarkjs";

import {
  ballotCalldata,
  ballotCircuitInputs,
  ballotTag,
  decryptTally,
  solidityProof,
  tallyCircuitInputs,
  unflattenPoints,
  type Point,
  type SolidityProof,
} from "../../../frontend/src/lib/ballotCrypto.js";

export const CIRCUITS_BUILD = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "circuits", "build");

/** Whether the circuits have been built for this size, so real proofs can be made. */
export function circuitsBuilt(slots: number): boolean {
  return ["ballot", "tally"].every(kind => existsSync(join(CIRCUITS_BUILD, `${kind}_s${slots}.zkey`)));
}

function artefacts(kind: "ballot" | "tally", slots: number) {
  const name = `${kind}_s${slots}`;
  return { wasm: join(CIRCUITS_BUILD, `${name}_js`, `${name}.wasm`), zkey: join(CIRCUITS_BUILD, `${name}.zkey`) };
}

/** A voter as the prover needs them: the Semaphore secret and its commitment. */
export interface Voter {
  secretScalar: bigint;
  commitment: bigint;
}

interface BallotEvent {
  tag: bigint;
  index: number;
  leaf: bigint;
  voteA: Point;
  voteB: Point[];
}

async function readBallots(election: any): Promise<BallotEvent[]> {
  const slots = Number(await election.numOptions()) + 1;
  const events = await election.queryFilter(election.filters.BallotCast());
  return events.map((e: { args: Record<string, any> }) => ({
    tag: e.args.tag as bigint,
    index: Number(e.args.index),
    leaf: e.args.leaf as bigint,
    voteA: [e.args.voteA[0], e.args.voteA[1]] as Point,
    voteB: unflattenPoints([...e.args.voteB]).slice(0, slots),
  }));
}

async function readMembers(election: any): Promise<bigint[]> {
  const events = await election.queryFilter(election.filters.MemberEnrolled());
  return events.map((e: { args: { identityCommitment: bigint } }) => e.args.identityCommitment);
}

const hash2 = (a: bigint, b: bigint) => poseidon2([a, b]);

/**
 * The voter's next ballot for `choice`, proved: their chain is walked from
 * their own tags, the last ballot found is cancelled. `epoch` defaults to the
 * current one; the previous one is also accepted by the contract.
 */
export async function proveBallot(
  election: any,
  voter: Voter,
  choice: number,
  /** `members` replaces the election's roll: how a test builds a proof against a roll of its own. */
  opts: { epoch?: bigint; members?: bigint[] } = {},
): Promise<{ ballot: ReturnType<typeof ballotCalldata>; proof: SolidityProof; tag: bigint }> {
  const [slots, keys, scope, currentEpoch, ballots, members] = await Promise.all([
    election.circuitSlots().then(Number) as Promise<number>,
    election.tallyKeys().then((k: bigint[]) => unflattenPoints([...k])) as Promise<Point[]>,
    election.scope() as Promise<bigint>,
    election.currentEpoch() as Promise<bigint>,
    readBallots(election),
    readMembers(election),
  ]);
  const epoch = opts.epoch ?? currentEpoch;

  const voters = new LeanIMT<bigint>(hash2, opts.members ?? members);
  const votersPath = voters.generateProof(voters.indexOf(voter.commitment));

  const byTag = new Map(ballots.map(b => [b.tag, b]));
  let k = 0n;
  while (byTag.has(ballotTag(poseidon4, voter.secretScalar, scope, k))) k++;
  const previousBallot = k === 0n ? null : byTag.get(ballotTag(poseidon4, voter.secretScalar, scope, k - 1n))!;

  let ballotsRoot: bigint = await election.ballotsRoot();
  let previous = null;
  if (previousBallot) {
    const tree = new LeanIMT<bigint>(hash2, ballots.map(b => b.leaf));
    const path = tree.generateProof(previousBallot.index);
    ballotsRoot = path.root;
    previous = { a: previousBallot.voteA, b: previousBallot.voteB, path };
  }

  const { inputs, ballot } = ballotCircuitInputs({
    poseidon3,
    poseidon4,
    circuitSlots: slots,
    secret: voter.secretScalar,
    scope,
    epoch,
    keys,
    choice,
    k,
    voters: votersPath,
    ballotsRoot,
    previous,
  });
  const files = artefacts("ballot", slots);
  const { proof } = await snarkjs.groth16.fullProve(inputs, files.wasm, files.zkey);
  return {
    ballot: ballotCalldata(ballot, { votersRoot: votersPath.root, ballotsRoot, epoch }),
    proof: solidityProof(proof),
    tag: ballot.tag,
  };
}

/**
 * The election's tally from its aggregate, proved. Publishes when the voters
 * reach the quorum, proves only that they did not otherwise.
 */
export async function proveTally(
  election: any,
  secrets: readonly bigint[],
): Promise<{ counts: bigint[]; voters: bigint; publish: boolean; proof: SolidityProof }> {
  const [slots, keys, aggregate, quorum, ballots] = await Promise.all([
    election.circuitSlots().then(Number) as Promise<number>,
    election.tallyKeys().then((k: bigint[]) => unflattenPoints([...k])) as Promise<Point[]>,
    election.aggregate() as Promise<[bigint[], bigint[]]>,
    election.privacyQuorum() as Promise<bigint>,
    election.voteCount() as Promise<bigint>,
  ]);
  const total = { a: [aggregate[0][0], aggregate[0][1]] as Point, b: unflattenPoints([...aggregate[1]]) };
  const counts = decryptTally(secrets, total, Number(ballots));
  const voters = counts.reduce((a, b) => a + b, 0n);
  const publish = voters >= quorum;
  const inputs = tallyCircuitInputs({ poseidon3, circuitSlots: slots, keys, secrets, counts, aggregate: total, quorum, publish });
  const files = artefacts("tally", slots);
  const { proof } = await snarkjs.groth16.fullProve(inputs, files.wasm, files.zkey);
  return { counts, voters, publish, proof: solidityProof(proof) };
}
