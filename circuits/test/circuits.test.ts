/**
 * The ballot and tally circuits, driven with real witnesses.
 *
 * Witness generation evaluates every constraint, so a witness that computes is
 * a ballot the verifier would accept and one that throws is one it would not.
 * No proving key is needed, which keeps this fast enough to run on every build.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import * as snarkjs from "snarkjs";
import { poseidon2 } from "poseidon-lite/poseidon2";
import { poseidon3 } from "poseidon-lite/poseidon3";
import { poseidon4 } from "poseidon-lite/poseidon4";
import { LeanIMT } from "@zk-kit/lean-imt";
import { Identity } from "@semaphore-protocol/identity";

import {
  aggregate,
  ballotCircuitInputs,
  decryptTally,
  deriveTallyKeys,
  tallyCircuitInputs,
  type Ballot,
  type CastBallot,
  type Point,
} from "../../frontend/src/lib/ballotCrypto.ts";

const BUILD = join(dirname(fileURLToPath(import.meta.url)), "..", "build");
const SLOTS = 5;
const BALLOT_WASM = join(BUILD, `ballot_s${SLOTS}_js`, `ballot_s${SLOTS}.wasm`);
const TALLY_WASM = join(BUILD, `tally_s${SLOTS}_js`, `tally_s${SLOTS}.wasm`);

const p3 = (x: bigint[]) => poseidon3(x);
const p4 = (x: bigint[]) => poseidon4(x);

async function witness(wasm: string, inputs: object): Promise<void> {
  const out = { type: "mem" } as { type: "mem"; data?: Uint8Array };
  await snarkjs.wtns.calculate(inputs as never, wasm, out);
}

const accepts = (wasm: string, inputs: object) => assert.doesNotReject(witness(wasm, inputs));
const refuses = (wasm: string, inputs: object) => assert.rejects(witness(wasm, inputs));

describe("ballot and tally circuits", { skip: !existsSync(BALLOT_WASM) || !existsSync(TALLY_WASM) }, () => {
  const scope = 777n;
  const epoch = 5n;
  let keys: Point[];
  let secrets: bigint[];
  const voters = [new Identity("alice"), new Identity("bob"), new Identity("carol")];
  const members = new LeanIMT<bigint>((a, b) => poseidon2([a, b]), voters.map(v => v.commitment));
  const ballots = new LeanIMT<bigint>((a, b) => poseidon2([a, b]));
  const cast: CastBallot[] = [];

  before(async () => {
    // Four options in use out of five slots: the fifth is padding.
    ({ keys, secrets } = await deriveTallyKeys(new TextEncoder().encode("organizer-secret-32-bytes-long!!"), "0x1", 4));
  });

  function build(voter: number, choice: number, k: bigint, previous: CastBallot | null, epochFor = epoch) {
    const prevIndex = previous ? cast.indexOf(previous) : -1;
    return ballotCircuitInputs({
      poseidon3: p3,
      poseidon4: p4,
      circuitSlots: SLOTS,
      secret: voters[voter].secretScalar,
      scope,
      epoch: epochFor,
      keys,
      choice,
      k,
      voters: members.generateProof(voter),
      ballotsRoot: ballots.size ? ballots.root : 0n,
      previous: previous ? { a: previous.voteA, b: previous.voteB, path: ballots.generateProof(prevIndex) } : null,
    });
  }

  function record(ballot: CastBallot) {
    cast.push(ballot);
    ballots.insert(ballot.leaf);
  }

  test("takes a first ballot, and the tag and leaf it outputs are the client's", async () => {
    const { inputs, ballot } = build(0, 1, 0n, null);
    await accepts(BALLOT_WASM, inputs);
    record(ballot);
  });

  test("takes a re-vote that cancels the same voter's previous ballot", async () => {
    const first = build(1, 2, 0n, null);
    await accepts(BALLOT_WASM, first.inputs);
    record(first.ballot);
    const second = build(1, 0, 1n, first.ballot, epoch + 1n);
    await accepts(BALLOT_WASM, second.inputs);
    record(second.ballot);
  });

  test("refuses to cancel a ballot that is not the voter's own", async () => {
    // Carol claims step 1 and points at Alice's ballot: her own step-0 tag
    // does not match the leaf, so the tree membership fails.
    const { inputs } = build(2, 0, 1n, cast[0]);
    await refuses(BALLOT_WASM, inputs);
  });

  test("refuses a vote for two options at once", async () => {
    const { inputs } = build(2, 0, 0n, null);
    await refuses(BALLOT_WASM, { ...inputs, choice: ["1", "1", "0", "0", "0"] });
  });

  test("refuses a vote for a slot the election does not have", async () => {
    const { inputs } = build(2, 0, 0n, null);
    // Slot 4 is padding in a four-slot election.
    await refuses(BALLOT_WASM, { ...inputs, choice: ["0", "0", "0", "0", "1"] });
  });

  test("refuses a ballot encrypted to keys other than the election's", async () => {
    const other = await deriveTallyKeys(new TextEncoder().encode("another-organizer-secret-32bytes"), "0x1", 4);
    const honest = build(2, 0, 0n, null);
    const forged = ballotCircuitInputs({
      poseidon3: p3, poseidon4: p4, circuitSlots: SLOTS, secret: voters[2].secretScalar, scope, epoch,
      keys: other.keys, choice: 0, k: 0n, voters: members.generateProof(2), ballotsRoot: ballots.root, previous: null,
    });
    await refuses(BALLOT_WASM, { ...forged.inputs, keysHash: honest.inputs.keysHash });
  });

  test("refuses a non-member", async () => {
    const outsider = new Identity("mallory");
    const { inputs } = build(2, 0, 0n, null);
    await refuses(BALLOT_WASM, { ...inputs, secret: outsider.secretScalar.toString() });
  });

  test("tallies the last vote of each voter, proved against the aggregate", async () => {
    const third = build(2, 3, 0n, null);
    await accepts(BALLOT_WASM, third.inputs);
    record(third.ballot);

    const onChain: Ballot[] = cast.map(b => ({ ...b, voteB: b.voteB, cancelB: b.cancelB }));
    const total = aggregate(onChain, SLOTS);
    const counts = decryptTally(secrets, { a: total.a, b: total.b.slice(0, 4) }, cast.length);
    // Alice 1; Bob 2 then 0; Carol 3.
    assert.deepEqual(counts, [1n, 1n, 0n, 1n]);

    const base = { poseidon3: p3, circuitSlots: SLOTS, keys, secrets, aggregate: total };
    await accepts(TALLY_WASM, tallyCircuitInputs({ ...base, counts, quorum: 2n, publish: true }));
    // A count moved from one option to another.
    await refuses(TALLY_WASM, tallyCircuitInputs({ ...base, counts: [2n, 0n, 0n, 1n], quorum: 2n, publish: true }));
    // Voiding is only for an election below its quorum.
    await refuses(TALLY_WASM, tallyCircuitInputs({ ...base, counts, quorum: 3n, publish: false }));
    await accepts(TALLY_WASM, tallyCircuitInputs({ ...base, counts, quorum: 4n, publish: false }));
  });
});
