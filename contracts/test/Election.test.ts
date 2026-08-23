import { expect } from "chai";
import { network } from "hardhat";
import {
  deployStack,
  deployElection,
  baseConfig,
  VotingType,
  Phase,
  Outcome,
  DUMMY_PROOF,
  type Stack,
} from "./fixtures.js";

const { ethers, networkHelpers } = await network.create();

const FORWARDER = ethers.Wallet.createRandom().address;

let stack: Stack;
let organizer: any;
let voter: any;

before(async () => {
  [, organizer, voter] = await ethers.getSigners();
  stack = await deployStack(ethers, FORWARDER);
});

/// Registers a member on the platform registry (issuer-owned) so it can enroll.
async function platformRegister(nullifier: bigint, commitment: bigint): Promise<void> {
  await (await stack.registry.registerMember(nullifier, commitment)).wait();
}

async function freshElection(overrides = {}): Promise<any> {
  const now = await networkHelpers.time.latest();
  return deployElection(ethers, stack, FORWARDER, organizer, baseConfig(now, overrides));
}

let commitmentSeq = 1_000n;
function nextCommitment(): { nullifier: bigint; commitment: bigint } {
  commitmentSeq += 1n;
  return { nullifier: commitmentSeq * 7n, commitment: commitmentSeq };
}

describe("ElectionV4, config validation", () => {
  it("rejects invalid time windows and option counts", async () => {
    const now = await networkHelpers.time.latest();
    const Election = await ethers.getContractFactory("ElectionV4", {
      libraries: { "PoseidonT3": stack.poseidonAddress },
    });

    const deployWith = (cfg: ReturnType<typeof baseConfig>) =>
      Election.deploy(
        FORWARDER,
        stack.verifier.getAddress(),
        stack.registry.getAddress(),
        organizer.address,
        cfg,
      );

    // enrollEnd before enrollStart
    await expect(deployWith(baseConfig(now, { enrollEnd: now - 500 })))
      .to.be.revertedWithCustomError(Election, "InvalidConfig");
    // voteEnd before voteStart
    await expect(deployWith(baseConfig(now, { voteEnd: now + 999 })))
      .to.be.revertedWithCustomError(Election, "InvalidConfig");
    // zero options
    await expect(deployWith(baseConfig(now, { numOptions: 0n })))
      .to.be.revertedWithCustomError(Election, "InvalidConfig");
    // two-thirds must be yes/no
    await expect(
      deployWith(baseConfig(now, { votingType: VotingType.SUPERMAJORITY_TWO_THIRDS, numOptions: 3n })),
    ).to.be.revertedWithCustomError(Election, "InvalidConfig");
    // witness threshold needs thresholdValue >= 1
    await expect(
      deployWith(
        baseConfig(now, { votingType: VotingType.WITNESS_THRESHOLD, numOptions: 2n, thresholdValue: 0n }),
      ),
    ).to.be.revertedWithCustomError(Election, "InvalidConfig");
  });
});

describe("ElectionV4, phase timeline", () => {
  it("reports UPCOMING before enrollment opens, then ENROLLING", async () => {
    const now = await networkHelpers.time.latest();
    // Enrollment opens 500s from now → currently UPCOMING.
    const election = await freshElection({
      enrollStart: now + 500,
      enrollEnd: now + 1500,
      voteStart: now + 1500,
      voteEnd: now + 2500,
    });
    expect(await election.phase()).to.equal(Phase.UPCOMING);

    await networkHelpers.time.increaseTo(now + 501);
    expect(await election.phase()).to.equal(Phase.ENROLLING);
  });

  it("reports PENDING_VOTE in the gap between enrollment close and voting start", async () => {
    const now = await networkHelpers.time.latest();
    // Deliberate gap: enrollment closes at +1000, voting starts at +2000.
    const election = await freshElection({
      enrollStart: now - 10,
      enrollEnd: now + 1000,
      voteStart: now + 2000,
      voteEnd: now + 3000,
    });
    expect(await election.phase()).to.equal(Phase.ENROLLING);

    await networkHelpers.time.increaseTo(now + 1001);
    expect(await election.phase()).to.equal(Phase.PENDING_VOTE);

    await networkHelpers.time.increaseTo(now + 2001);
    expect(await election.phase()).to.equal(Phase.ACTIVE);
  });

  it("has no PENDING_VOTE when enrollEnd == voteStart (no separate window)", async () => {
    const now = await networkHelpers.time.latest();
    const election = await freshElection(); // baseConfig: enrollEnd == voteStart
    await networkHelpers.time.increaseTo((await election.voteStart()) - 1n);
    expect(await election.phase()).to.equal(Phase.ENROLLING);
    await networkHelpers.time.increaseTo(await election.voteStart());
    expect(await election.phase()).to.equal(Phase.ACTIVE);
  });
});

describe("ElectionV4, enrollment", () => {
  it("only platform-verified commitments can enroll, once", async () => {
    const election = await freshElection();
    const { nullifier, commitment } = nextCommitment();

    // Not registered on the platform yet
    await expect(election.connect(voter).enroll(commitment)).to.be.revertedWithCustomError(
      election,
      "NotPlatformVerified",
    );

    await platformRegister(nullifier, commitment);

    await expect(election.connect(voter).enroll(commitment))
      .to.emit(election, "MemberEnrolled");

    expect(await election.memberCount()).to.equal(1n);
    expect(await election.hasMember(commitment)).to.equal(true);
    expect(await election.rootTimestamps(await election.merkleTreeRoot())).to.be.greaterThan(0n);

    // Duplicate enrollment
    await expect(election.connect(voter).enroll(commitment)).to.be.revertedWithCustomError(
      election,
      "AlreadyEnrolled",
    );
  });

  it("rejects enrollment outside the enrollment window", async () => {
    const election = await freshElection();
    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);

    const enrollEnd = await election.enrollEnd();
    await networkHelpers.time.increaseTo(enrollEnd + 1n);

    await expect(election.connect(voter).enroll(commitment)).to.be.revertedWithCustomError(
      election,
      "EnrollmentNotOpen",
    );
  });

  // Rotation is the account-recovery path. It must never become a way to get a
  // second leaf in a tree, because each identity produces its own Semaphore
  // nullifier and the election would count both ballots as different voters.
  it("a rotated identity cannot enroll again in an election the human already joined", async () => {
    const election = await freshElection();
    const { nullifier, commitment } = nextCommitment();
    const { commitment: rotated } = nextCommitment();

    await platformRegister(nullifier, commitment);
    await (await election.connect(voter).enroll(commitment)).wait();

    await (await stack.registry.rotateMember(nullifier, rotated)).wait();
    expect(await stack.registry.verifiedMembers(rotated)).to.equal(true);

    await expect(election.connect(voter).enroll(rotated)).to.be.revertedWithCustomError(
      election,
      "AlreadyEnrolled",
    );
    expect(await election.memberCount()).to.equal(1n);
  });

  it("a rotated identity can still enroll in elections the human had not joined", async () => {
    const { nullifier, commitment } = nextCommitment();
    const { commitment: rotated } = nextCommitment();

    await platformRegister(nullifier, commitment);
    await (await stack.registry.rotateMember(nullifier, rotated)).wait();

    // A brand new election: recovery must restore the ability to participate.
    const election = await freshElection();
    await expect(election.connect(voter).enroll(rotated)).to.emit(election, "MemberEnrolled");

    // The revoked commitment is no longer usable anywhere.
    await expect(election.connect(voter).enroll(commitment)).to.be.revertedWithCustomError(
      election,
      "NotPlatformVerified",
    );
  });
});

describe("ElectionV4, voting", () => {
  it("full happy path: enroll, vote, re-vote (coercion resistance), close", async () => {
    const election = await freshElection();
    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);
    await (await election.connect(voter).enroll(commitment)).wait();

    const root = await election.merkleTreeRoot();

    // Voting not open yet
    await expect(
      election.connect(voter).castVote("0x01", nullifier, root, 1n, DUMMY_PROOF.pA, DUMMY_PROOF.pB, DUMMY_PROOF.pC),
    ).to.be.revertedWithCustomError(election, "VotingNotOpen");

    await networkHelpers.time.increaseTo(await election.voteStart());
    expect(await election.phase()).to.equal(Phase.ACTIVE);

    // First vote (nonce 0)
    await expect(
      election.connect(voter).castVote("0x0111", nullifier, root, 1n, DUMMY_PROOF.pA, DUMMY_PROOF.pB, DUMMY_PROOF.pC),
    ).to.emit(election, "VoteCast");
    expect(await election.nullifierNonces(nullifier)).to.equal(1n);

    // Re-vote (nonce 1): coercion resistance: no revert on duplicate nullifier
    await expect(
      election.connect(voter).castVote("0x0222", nullifier, root, 1n, DUMMY_PROOF.pA, DUMMY_PROOF.pB, DUMMY_PROOF.pC),
    ).to.emit(election, "VoteCast");
    expect(await election.nullifierNonces(nullifier)).to.equal(2n);
    expect(await election.voteCount()).to.equal(2n);

    // After voteEnd
    await networkHelpers.time.increaseTo((await election.voteEnd()) + 1n);
    expect(await election.phase()).to.equal(Phase.TALLYING);
    await expect(
      election.connect(voter).castVote("0x0333", nullifier, root, 1n, DUMMY_PROOF.pA, DUMMY_PROOF.pB, DUMMY_PROOF.pC),
    ).to.be.revertedWithCustomError(election, "VotingNotOpen");
  });

  it("rejects unknown merkle roots and out-of-range depths", async () => {
    const election = await freshElection();
    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);
    await (await election.connect(voter).enroll(commitment)).wait();
    const root = await election.merkleTreeRoot();

    await networkHelpers.time.increaseTo(await election.voteStart());

    await expect(
      election.castVote("0x01", nullifier, 999999n, 1n, DUMMY_PROOF.pA, DUMMY_PROOF.pB, DUMMY_PROOF.pC),
    ).to.be.revertedWithCustomError(election, "UnknownOrExpiredRoot");

    await expect(
      election.castVote("0x01", nullifier, root, 0n, DUMMY_PROOF.pA, DUMMY_PROOF.pB, DUMMY_PROOF.pC),
    ).to.be.revertedWithCustomError(election, "InvalidTreeDepth");

    await expect(
      election.castVote("0x01", nullifier, root, 33n, DUMMY_PROOF.pA, DUMMY_PROOF.pB, DUMMY_PROOF.pC),
    ).to.be.revertedWithCustomError(election, "InvalidTreeDepth");
  });

  it("accepts recent superseded roots but rejects expired ones", async () => {
    const now = await networkHelpers.time.latest();
    // Long voting window so we can play with the root validity clock
    const election = await freshElection({
      enrollStart: now - 10,
      enrollEnd: now + 100_000,
      voteStart: now + 100_000,
      voteEnd: now + 200_000,
    });

    const a = nextCommitment();
    const b = nextCommitment();
    await platformRegister(a.nullifier, a.commitment);
    await platformRegister(b.nullifier, b.commitment);

    await (await election.connect(voter).enroll(a.commitment)).wait();
    const oldRoot = await election.merkleTreeRoot();
    await (await election.connect(voter).enroll(b.commitment)).wait();
    const newRoot = await election.merkleTreeRoot();
    expect(oldRoot).to.not.equal(newRoot);

    await networkHelpers.time.increaseTo(await election.voteStart());

    // The superseded root was created long ago (enrollment happened at t≈now,
    // voting starts at now+100_000) so it is already expired.
    await expect(
      election.castVote("0x01", a.nullifier, oldRoot, 1n, DUMMY_PROOF.pA, DUMMY_PROOF.pB, DUMMY_PROOF.pC),
    ).to.be.revertedWithCustomError(election, "UnknownOrExpiredRoot");

    // The current root always works
    await expect(
      election.castVote("0x01", a.nullifier, newRoot, 1n, DUMMY_PROOF.pA, DUMMY_PROOF.pB, DUMMY_PROOF.pC),
    ).to.emit(election, "VoteCast");
  });
});

describe("ElectionV4, organizer lifecycle", () => {
  it("only the organizer can run lifecycle actions", async () => {
    const election = await freshElection();
    await expect(election.connect(voter).cancelElection()).to.be.revertedWithCustomError(
      election,
      "NotOrganizer",
    );
    await expect(election.connect(voter).closeEnrollmentEarly()).to.be.revertedWithCustomError(
      election,
      "NotOrganizer",
    );
  });

  it("cancelElection is terminal and blocks everything", async () => {
    const election = await freshElection();
    const { nullifier, commitment } = nextCommitment();
    await platformRegister(nullifier, commitment);

    await expect(election.connect(organizer).cancelElection()).to.emit(election, "ElectionCancelled");
    expect(await election.phase()).to.equal(Phase.CANCELLED);

    await expect(election.connect(voter).enroll(commitment)).to.be.revertedWithCustomError(
      election,
      "AlreadyCancelled",
    );
    await expect(election.connect(organizer).cancelElection()).to.be.revertedWithCustomError(
      election,
      "AlreadyCancelled",
    );
  });

  it("closeEnrollmentEarly starts voting immediately", async () => {
    const election = await freshElection();
    await expect(election.connect(organizer).closeEnrollmentEarly()).to.emit(
      election,
      "EnrollmentClosedEarly",
    );
    expect(await election.phase()).to.equal(Phase.ACTIVE);
  });

  it("closeVotingEarly moves to tallying", async () => {
    const election = await freshElection();
    await networkHelpers.time.increaseTo(await election.voteStart());
    await expect(election.connect(organizer).closeVotingEarly()).to.emit(election, "VotingClosedEarly");
    // voteEnd == now: phase() must flip to TALLYING immediately, in the same
    // block: an organizer refreshing the page right after the tx must not
    // see the election as still ACTIVE.
    expect(await election.phase()).to.equal(Phase.TALLYING);
  });

  it("markVoided only works after voting ended and is terminal", async () => {
    const election = await freshElection();

    await expect(election.connect(organizer).markVoided()).to.be.revertedWithCustomError(
      election,
      "VotingNotEnded",
    );

    await networkHelpers.time.increaseTo((await election.voteEnd()) + 1n);
    await expect(election.connect(organizer).markVoided()).to.emit(election, "ElectionVoided");
    expect(await election.phase()).to.equal(Phase.VOIDED);

    await expect(
      election.connect(organizer).publishResults("cid", [1n, 1n, 1n, 0n]),
    ).to.be.revertedWithCustomError(election, "AlreadyDecided");
  });
});

describe("ElectionV4, publishResults & outcomes", () => {
  async function publish(election: any, tallyArr: bigint[]): Promise<void> {
    await networkHelpers.time.increaseTo((await election.voteEnd()) + 1n);
    await (await election.connect(organizer).publishResults("QmTestCid", tallyArr)).wait();
  }

  it("validates timing and tally length", async () => {
    const election = await freshElection(); // 3 options → tally length must be 4

    await expect(
      election.connect(organizer).publishResults("cid", [1n, 2n, 3n, 0n]),
    ).to.be.revertedWithCustomError(election, "VotingNotEnded");

    await networkHelpers.time.increaseTo((await election.voteEnd()) + 1n);
    await expect(
      election.connect(organizer).publishResults("cid", [1n, 2n, 3n]),
    ).to.be.revertedWithCustomError(election, "InvalidTally");
  });

  it("SIMPLE_PLURALITY: highest vote count wins; equal top is a tie", async () => {
    const winnerCase = await freshElection();
    await publish(winnerCase, [10n, 30n, 20n, 5n]);
    expect(await winnerCase.outcome()).to.equal(Outcome.WINNER);
    expect(await winnerCase.winnerIndex()).to.equal(1n);
    expect(await winnerCase.phase()).to.equal(Phase.CLOSED);
    expect(await winnerCase.resultsCid()).to.equal("QmTestCid");

    const tieCase = await freshElection();
    await publish(tieCase, [30n, 30n, 10n, 2n]);
    expect(await tieCase.outcome()).to.equal(Outcome.TIE);
  });

  it("ABSOLUTE_MAJORITY: winner needs more than half of all votes cast", async () => {
    const majority = await freshElection({ votingType: VotingType.ABSOLUTE_MAJORITY });
    await publish(majority, [60n, 30n, 5n, 5n]); // 60 of 100 → majority
    expect(await majority.outcome()).to.equal(Outcome.WINNER);
    expect(await majority.winnerIndex()).to.equal(0n);

    const noMajority = await freshElection({ votingType: VotingType.ABSOLUTE_MAJORITY });
    await publish(noMajority, [40n, 35n, 15n, 10n]); // 40 of 100 → not enough
    expect(await noMajority.outcome()).to.equal(Outcome.THRESHOLD_NOT_MET);
  });

  it("SUPERMAJORITY_TWO_THIRDS: yes needs at least 2/3 of votes cast", async () => {
    const approved = await freshElection({
      votingType: VotingType.SUPERMAJORITY_TWO_THIRDS,
      numOptions: 2n,
    });
    await publish(approved, [70n, 20n, 10n]); // 70/100 >= 2/3
    expect(await approved.outcome()).to.equal(Outcome.APPROVED);

    const rejected = await freshElection({
      votingType: VotingType.SUPERMAJORITY_TWO_THIRDS,
      numOptions: 2n,
    });
    await publish(rejected, [60n, 35n, 5n]); // 60/100 < 2/3
    expect(await rejected.outcome()).to.equal(Outcome.REJECTED);
  });

  it("WITNESS_THRESHOLD: yes votes must reach the configured threshold", async () => {
    const approved = await freshElection({
      votingType: VotingType.WITNESS_THRESHOLD,
      numOptions: 2n,
      thresholdValue: 4n,
    });
    await publish(approved, [4n, 1n, 0n]);
    expect(await approved.outcome()).to.equal(Outcome.APPROVED);

    const rejected = await freshElection({
      votingType: VotingType.WITNESS_THRESHOLD,
      numOptions: 2n,
      thresholdValue: 4n,
    });
    await publish(rejected, [3n, 2n, 0n]);
    expect(await rejected.outcome()).to.equal(Outcome.REJECTED);
  });

  it("publishing twice is impossible", async () => {
    const election = await freshElection();
    await publish(election, [1n, 2n, 3n, 0n]);
    await expect(
      election.connect(organizer).publishResults("cid2", [9n, 9n, 9n, 9n]),
    ).to.be.revertedWithCustomError(election, "AlreadyDecided");
  });

  it("exposes the stored tally", async () => {
    const election = await freshElection();
    await publish(election, [7n, 8n, 9n, 1n]);
    const stored = await election.tally();
    expect(stored.map((x: bigint) => x)).to.deep.equal([7n, 8n, 9n, 1n]);
  });
});
