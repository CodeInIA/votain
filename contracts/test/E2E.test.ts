/**
 * End-to-end election, exercised the way the real dApp does it.
 *
 * The other suites use mock verifiers, so this is the one place the generated
 * Groth16 verifiers check real proofs. That is the riskiest joint in the whole
 * stack: the contract has to lay out the public signals in exactly the order
 * the circuits declare them, hash the keys exactly as they do and accumulate
 * exactly the points they encrypt. If any of that is off, every ballot reverts
 * on Amoy and no unit test would have caught it.
 *
 * So this suite deploys the generated verifiers, proves ballots and tallies
 * with the same `ballotCrypto.ts` the browser uses, routes everything through
 * ElectionPaymaster exactly as the relayer does, and has the election itself
 * verify the decryption before it publishes a result.
 *
 * It needs the circuits built (`npm run build` in circuits/). Without them it
 * skips, loudly, unless REQUIRE_CIRCUITS=1, which CI sets so that a missing
 * build fails instead of passing by doing nothing.
 */
import { expect } from "chai";
import { network } from "hardhat";
import { Identity } from "@semaphore-protocol/identity";

import {
  aggregate as addBallots,
  deriveTallyKeys,
  equals,
  flattenPoints,
  unflattenPoints,
  type Point,
} from "../../frontend/src/lib/ballotCrypto.js";
import { circuitsBuilt, proveBallot, proveTally } from "../scripts/lib/prover.js";
import { baseConfig, deployPoseidon, Outcome, Phase, signPrivateEnrollment, VotingType } from "./fixtures.js";

const { ethers, networkHelpers } = await network.create();

/** Circuit sizes this suite deploys: the two the default build produces. */
const SIZES = [5, 9];

interface Voter {
  seed: string;
  identity: Identity;
  nullifier: bigint;
}

describe("E2E, real Groth16 ballots and tallies, relayed like production", () => {
  let organizer: any;
  let relayer: any;
  let platform: any;
  let registry: any;
  let paymaster: any;
  let factory: any;
  let tally: { secrets: bigint[]; keys: Point[] };

  before(async function () {
    if (!SIZES.every(circuitsBuilt)) {
      const message = "circuits not built: run `npm run build` in circuits/ to run the E2E suite";
      if (process.env.REQUIRE_CIRCUITS === "1") throw new Error(message);
      console.warn(`      SKIPPED: ${message}`);
      this.skip();
    }
    this.timeout(180_000);
    [, organizer, relayer, platform] = await ethers.getSigners();

    const libraries = await deployPoseidon(ethers);
    registry = await (await ethers.getContractFactory("PlatformRegistry")).deploy();
    paymaster = await (await ethers.getContractFactory("ElectionPaymaster")).deploy();

    // The generated verifiers, not the mocks. This is the point of the suite.
    const ballotVerifiers: string[] = [];
    const tallyVerifiers: string[] = [];
    for (const size of SIZES) {
      ballotVerifiers.push(await (await (await ethers.getContractFactory(`BallotVerifierS${size}`)).deploy()).getAddress());
      tallyVerifiers.push(await (await (await ethers.getContractFactory(`TallyVerifierS${size}`)).deploy()).getAddress());
    }
    const deployer = await (await ethers.getContractFactory("ElectionDeployer", { libraries })).deploy();

    factory = await (await ethers.getContractFactory("ElectionFactory")).deploy(
      await paymaster.getAddress(),
      await deployer.getAddress(),
      ballotVerifiers,
      tallyVerifiers,
      await registry.getAddress(),
      platform.address,
    );
    await (await paymaster.setFactory(await factory.getAddress())).wait();
  });

  /** Registers a voter on the platform and returns their Semaphore identity. */
  async function newVoter(seed: string): Promise<Voter> {
    const identity = new Identity(seed);
    const worldIdNullifier = BigInt(ethers.keccak256(ethers.toUtf8Bytes("worldid:" + seed)));
    await (await registry.registerMember(worldIdNullifier, identity.commitment)).wait();
    return { seed, identity, nullifier: worldIdNullifier };
  }

  /**
   * The identity a voter derives for ONE election, mirroring the frontend: it
   * is reproducible from their own secret and matches nothing they use
   * anywhere else. Their platform identity never appears on chain again.
   */
  function electionIdentity(voter: Voter, electionAddress: string): Identity {
    return new Identity(`${voter.seed}:${electionAddress.toLowerCase()}`);
  }

  /** What the platform derives to answer "has this person already enrolled here". */
  function humanTag(voter: Voter, electionAddress: string): bigint {
    return BigInt(
      ethers.solidityPackedKeccak256(["string", "uint256", "address"], ["test-pepper", voter.nullifier, electionAddress]),
    );
  }

  /** Enrols a voter the way the dApp does, and returns the identity they vote with. */
  async function enrolPrivately(election: any, voter: Voter): Promise<Identity> {
    const address = await election.getAddress();
    const identity = electionIdentity(voter, address);
    const tag = humanTag(voter, address);
    const deadline = (await networkHelpers.time.latest()) + 900;
    const signature = await signPrivateEnrollment(
      platform,
      address,
      (await ethers.provider.getNetwork()).chainId,
      identity.commitment,
      tag,
      deadline,
    );
    await (
      await paymaster.connect(relayer).relayEnrollPrivate(address, identity.commitment, tag, 0n, deadline, signature, "0x")
    ).wait();
    return identity;
  }

  async function createElection(overrides: Record<string, unknown> = {}, deposit = "5"): Promise<any> {
    const now = await networkHelpers.time.latest();
    const numOptions = (overrides.numOptions as bigint | undefined) ?? 3n;
    tally = await deriveTallyKeys(new Uint8Array(32).fill(9), "0xe2e", Number(numOptions) + 1);
    const cfg = baseConfig(now, {
      numOptions,
      // Long enough for re-votes an epoch apart.
      voteEnd: now + 6 * 3600,
      tallyKeys: flattenPoints(tally.keys),
      ...overrides,
    });
    await (await factory.connect(organizer).createElection(cfg, 0n, { value: ethers.parseEther(deposit) })).wait();
    const count = await factory.electionsCount();
    return ethers.getContractAt("ElectionV4", await factory.elections(count - 1n));
  }

  /** Proves and relays one ballot, as the voter's browser does. */
  async function relayedVote(election: any, identity: Identity, choice: number): Promise<{ tag: bigint; gas: bigint }> {
    const { ballot, proof, tag } = await proveBallot(election, identity, choice);
    const receipt = await (await paymaster.connect(relayer).relayVote(await election.getAddress(), ballot, proof)).wait();
    return { tag, gas: receipt.gasUsed };
  }

  it("runs a whole election: enroll, vote, re-vote unseen, tally, prove, publish", async function () {
    this.timeout(600_000);

    const election = await createElection();

    // ── Enrollment, relayed ──
    const voters = await Promise.all(["alice", "bob", "carol", "dave"].map(newVoter));
    const voting = new Map<string, Identity>();
    for (const v of voters) voting.set(v.seed, await enrolPrivately(election, v));
    expect(await election.memberCount()).to.equal(4n);

    // NONE of these are the commitments the registry knows: the tree says four
    // verified humans joined, and nothing on chain says which four.
    for (const v of voters) {
      expect(await election.hasMember(v.identity.commitment)).to.equal(false);
      expect(await election.hasMember(voting.get(v.seed)!.commitment)).to.equal(true);
    }

    // ── Voting ──
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);
    const first = await relayedVote(election, voting.get("alice")!, 0);
    await relayedVote(election, voting.get("bob")!, 0);
    await relayedVote(election, voting.get("dave")!, 2);
    console.log(`      relayed ballot gas (5 slots): ${first.gas}`);

    // Carol votes for option 2 under pressure, then, an epoch later, for what
    // she meant. Only her last ballot may count, and nothing public may say
    // that she voted twice.
    const coerced = await relayedVote(election, voting.get("carol")!, 2);
    await networkHelpers.time.increase(Number(await election.EPOCH_LENGTH()));
    const real = await relayedVote(election, voting.get("carol")!, 1);
    expect(real.tag).to.not.equal(coerced.tag);
    expect(await election.voteCount()).to.equal(5n);

    // What the chain shows is five unrelated ballots: every one of them carries
    // a vote AND a cancellation, whether it replaced anything or not.
    const events = await election.queryFilter(election.filters.BallotCast());
    expect(new Set(events.map((e: any) => e.args.tag)).size).to.equal(5);
    for (const e of events as any[]) {
      expect(equals([e.args.cancelA[0], e.args.cancelA[1]], [0n, 1n])).to.equal(false);
    }

    // ── Tally: the aggregate, decrypted and proved ──
    await networkHelpers.time.increaseTo((await election.voteEnd()) + 1n);
    const proven = await proveTally(election, tally.secrets);
    // Alice + Bob on 0, Carol's REPLACEMENT on 1, Dave on 2, nothing counted
    // for the coerced ballot.
    expect(proven.counts).to.deep.equal([2n, 1n, 1n, 0n]);
    expect(proven.voters).to.equal(4n);

    // The count an organizer might have preferred is refused by the proof.
    await expect(
      election.connect(organizer).publishResults("QmStuffed", [2n, 1n, 2n, 0n], proven.proof),
    ).to.be.revertedWithCustomError(election, "InvalidProof");

    await (await election.connect(organizer).publishResults("QmAuditTrail", proven.counts, proven.proof)).wait();
    expect(await election.resultsPublished()).to.equal(true);
    expect(await election.voters()).to.equal(4n);
    expect(await election.outcome()).to.equal(Outcome.WINNER);
    expect(await election.winnerIndex()).to.equal(0n);
    expect(await election.phase()).to.equal(Phase.CLOSED);

    // ── Audit, as any reader: the ballots on chain add up to the aggregate ──
    const [a, b] = await election.aggregate();
    const recomputed = addBallots(
      (events as any[]).map(e => ({
        tag: e.args.tag,
        voteA: [e.args.voteA[0], e.args.voteA[1]],
        voteB: unflattenPoints([...e.args.voteB]),
        cancelA: [e.args.cancelA[0], e.args.cancelA[1]],
        cancelB: unflattenPoints([...e.args.cancelB]),
      })),
      4,
    );
    expect(equals(recomputed.a, [a[0], a[1]])).to.equal(true);
    expect(recomputed.b.every((p, i) => equals(p, unflattenPoints([...b])[i]))).to.equal(true);
  });

  it("voids an election below its quorum with a proof, and never reveals the counts", async function () {
    this.timeout(600_000);

    // Three ballots from two voters: only the proof can say it was two.
    const election = await createElection({ privacyQuorum: 3n, cancellable: false });
    const [x, y] = await Promise.all(["void-x", "void-y"].map(newVoter));
    const ix = await enrolPrivately(election, x);
    const iy = await enrolPrivately(election, y);
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);
    await relayedVote(election, ix, 0);
    await relayedVote(election, iy, 1);
    await networkHelpers.time.increase(Number(await election.EPOCH_LENGTH()));
    await relayedVote(election, ix, 1);

    await networkHelpers.time.increaseTo((await election.voteEnd()) + 1n);
    // Three ballots meet a quorum of three, so voiding without a proof would be
    // a veto this election gave up.
    await expect(election.connect(organizer).markVoided()).to.be.revertedWithCustomError(election, "ResultPublishable");

    const proven = await proveTally(election, tally.secrets);
    expect(proven.publish).to.equal(false);
    expect(proven.voters).to.equal(2n);
    await expect(election.voidBelowQuorum(2n, proven.proof)).to.emit(election, "VoidedBelowQuorum").withArgs(2n);
    expect(await election.phase()).to.equal(Phase.VOIDED);
    expect(await election.tally()).to.deep.equal([]);
  });

  it("rejects a proof against a roll the voter made up", async function () {
    this.timeout(180_000);

    const election = await createElection();
    await enrolPrivately(election, await newVoter("member-only"));
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);

    // Internally consistent, but its root is not the election's.
    const outsider = new Identity("outsider");
    const { ballot, proof } = await proveBallot(election, outsider, 0, { members: [outsider.commitment] });
    await expect(
      paymaster.connect(relayer).relayVote(await election.getAddress(), ballot, proof),
    ).to.be.revertedWithCustomError(election, "UnknownOrExpiredRoot");
  });

  it("rejects a tampered proof or ballot against the real verifier, and charges nobody", async function () {
    this.timeout(180_000);

    const election = await createElection();
    const address = await election.getAddress();
    const identity = await enrolPrivately(election, await newVoter("tamper"));
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);
    const { ballot, proof } = await proveBallot(election, identity, 0);
    const tankBefore = await paymaster.reservedFor(address);

    // Flip one field element: the pairing check must fail.
    const bent = { ...proof, a: [proof.a[0] + 1n, proof.a[1]] };
    await expect(paymaster.connect(relayer).relayVote(address, ballot, bent)).to.be.revert(ethers);

    // Change the vote the proof was made for: the proof no longer holds.
    const swapped = { ...ballot, voteB: [...ballot.voteB.slice(2), ...ballot.voteB.slice(0, 2)] };
    await expect(paymaster.connect(relayer).relayVote(address, swapped, proof)).to.be.revertedWithCustomError(
      election,
      "InvalidProof",
    );

    expect(await paymaster.reservedFor(address)).to.equal(tankBefore);
  });

  it("refuses the same ballot twice, however it arrives", async function () {
    this.timeout(180_000);

    const election = await createElection();
    const identity = await enrolPrivately(election, await newVoter("replay"));
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);
    const { ballot, proof } = await proveBallot(election, identity, 0);

    await (await paymaster.connect(relayer).relayVote(await election.getAddress(), ballot, proof)).wait();
    await expect(election.connect(relayer).castVote(ballot, proof)).to.be.revertedWithCustomError(
      election,
      "TagAlreadyCast",
    );
    expect(await election.voteCount()).to.equal(1n);
  });

  it("counts a Yes/No supermajority correctly through the same pipeline", async function () {
    this.timeout(600_000);

    // 2 options (Yes/No) + blank. Two thirds of ballots cast must be Yes.
    const election = await createElection({ numOptions: 2n, votingType: VotingType.SUPERMAJORITY_TWO_THIRDS });
    const voting: Identity[] = [];
    for (const seed of ["s1", "s2", "s3"]) voting.push(await enrolPrivately(election, await newVoter("two-thirds-" + seed)));
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);

    // 2 Yes (index 0), 1 No (index 1) => exactly 2/3.
    await relayedVote(election, voting[0], 0);
    await relayedVote(election, voting[1], 0);
    await relayedVote(election, voting[2], 1);

    await networkHelpers.time.increaseTo((await election.voteEnd()) + 1n);
    const proven = await proveTally(election, tally.secrets);
    expect(proven.counts).to.deep.equal([2n, 1n, 0n]);
    await (await election.connect(organizer).publishResults("QmTwoThirds", proven.counts, proven.proof)).wait();
    expect(await election.outcome()).to.equal(Outcome.APPROVED);
  });

  it("uses the larger circuit for an election with more options", async function () {
    this.timeout(600_000);

    const election = await createElection({ numOptions: 6n });
    expect(await election.circuitSlots()).to.equal(9n);
    const voting: Identity[] = [];
    for (const seed of ["l1", "l2"]) voting.push(await enrolPrivately(election, await newVoter("large-" + seed)));
    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);
    const { gas } = await relayedVote(election, voting[0], 5);
    console.log(`      relayed ballot gas (9 slots): ${gas}`);
    await relayedVote(election, voting[1], 6); // the blank vote

    await networkHelpers.time.increaseTo((await election.voteEnd()) + 1n);
    const proven = await proveTally(election, tally.secrets);
    expect(proven.counts).to.deep.equal([0n, 0n, 0n, 0n, 0n, 1n, 1n]);
    await (await election.connect(organizer).publishResults("", proven.counts, proven.proof)).wait();
    expect(await election.tally()).to.deep.equal(proven.counts);
  });

  it("keeps every voter's call arriving from the paymaster, never from the voter", async function () {
    this.timeout(180_000);

    const election = await createElection();
    const voter = await newVoter("unlinkable");
    const voting = await enrolPrivately(election, voter);
    const enrollTx = await (await election.queryFilter(election.filters.MemberEnrolled()))[0].getTransaction();

    await networkHelpers.time.increaseTo((await election.voteStart()) + 1n);
    await relayedVote(election, voting, 0);
    const voteTx = await (await election.queryFilter(election.filters.BallotCast()))[0].getTransaction();
    const paymasterAddress = await paymaster.getAddress();

    // Both operations were sent TO the paymaster, so the on-chain trace exposes
    // no address that belongs to this voter and links enrollment to ballot.
    expect(enrollTx.to).to.equal(paymasterAddress);
    expect(voteTx.to).to.equal(paymasterAddress);

    // And the leaf is not the voter's platform identity, so the enrolment
    // cannot be matched against the registry either.
    expect(await election.hasMember(voter.identity.commitment)).to.equal(false);
    expect(await registry.nullifierOf(voting.commitment)).to.equal(0n);
  });
});
