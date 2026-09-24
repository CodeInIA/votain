import { expect } from "chai";
import { network } from "hardhat";
import { deployStack, baseConfig, VotingType, type Stack } from "./fixtures.js";

const { ethers, networkHelpers } = await network.create();


let stack: Stack;
let organizer: any;

before(async () => {
  [, organizer] = await ethers.getSigners();
  stack = await deployStack(ethers);
});

describe("ElectionFactory", () => {
  it("deploys an election, routes the deposit to the paymaster and tracks it", async () => {
    const now = await networkHelpers.time.latest();
    const cfg = baseConfig(now, { name: "Presidential 2026" });
    const funding = ethers.parseEther("2.0");

    const balanceBefore = await stack.paymaster.gasBalance(organizer.address);
    const countBefore = await stack.factory.electionsCount();

    const tx = await stack.factory.connect(organizer).createElection(cfg, 0n, { value: funding });
    const receipt = await tx.wait();

    // Event with the organizer and config data
    const events = await stack.factory.queryFilter(
      stack.factory.filters.ElectionCreated(),
      receipt!.blockNumber,
      receipt!.blockNumber,
    );
    expect(events.length).to.equal(1);
    expect(events[0].args.name).to.equal("Presidential 2026");
    expect(events[0].args.organizer).to.equal(organizer.address);
    expect(events[0].args.electionAddress).to.not.equal(ethers.ZeroAddress);

    // Deposit landed BEHIND THIS ELECTION, not in the shared tank. Money
    // attached to the creation of an election is plainly meant for it, and
    // leaving it withdrawable let an organizer defund their own voters
    // mid-vote.
    expect(await stack.paymaster.reservedFor(events[0].args.electionAddress)).to.equal(funding);
    expect(await stack.paymaster.gasBalance(organizer.address)).to.equal(balanceBefore);

    // Election registered and enumerable
    expect(await stack.factory.electionsCount()).to.equal(countBefore + 1n);
    const page = await stack.factory.getElections(countBefore, 10n);
    expect(page[0]).to.equal(events[0].args.electionAddress);

    // The deployed election belongs to the organizer with the right config
    const election = await ethers.getContractAt("ElectionV4", events[0].args.electionAddress);
    expect(await election.organizer()).to.equal(organizer.address);
    expect(await election.name()).to.equal("Presidential 2026");
    expect(await election.votingType()).to.equal(BigInt(VotingType.SIMPLE_PLURALITY));
    // Three options and the blank vote: the smallest circuit, five slots.
    expect(await election.circuitSlots()).to.equal(5n);
    expect(await election.ballotVerifier()).to.equal(await stack.ballotVerifiers[0].getAddress());
    expect(await election.tallyVerifier()).to.equal(await stack.tallyVerifiers[0].getAddress());
  });

  it("gives each election the smallest circuit that holds its options, and refuses past the largest", async () => {
    const [b5] = await stack.factory.verifiersFor(4n);
    const [b9, t9] = await stack.factory.verifiersFor(5n);
    const [b51] = await stack.factory.verifiersFor(50n);
    expect(b5).to.equal(await stack.ballotVerifiers[0].getAddress());
    expect(b9).to.equal(await stack.ballotVerifiers[1].getAddress());
    expect(t9).to.equal(await stack.tallyVerifiers[1].getAddress());
    expect(b51).to.equal(await stack.ballotVerifiers[2].getAddress());
    await expect(stack.factory.verifiersFor(51n)).to.be.revertedWithCustomError(stack.factory, "TooManyOptions");
  });

  it("refuses verifier lists that are empty, unequal or out of size order", async () => {
    const Factory = await ethers.getContractFactory("ElectionFactory");
    const [b5, b9] = [await stack.ballotVerifiers[0].getAddress(), await stack.ballotVerifiers[1].getAddress()];
    const [t5, t9] = [await stack.tallyVerifiers[0].getAddress(), await stack.tallyVerifiers[1].getAddress()];
    const deploy = (ballots: string[], tallies: string[]) =>
      Factory.deploy(
        stack.paymaster.getAddress(),
        stack.factory.deployer(),
        ballots,
        tallies,
        stack.registry.getAddress(),
        ethers.ZeroAddress,
      );
    await expect(deploy([], [])).to.be.revertedWithCustomError(Factory, "BadVerifiers");
    await expect(deploy([b5, b9], [t5])).to.be.revertedWithCustomError(Factory, "BadVerifiers");
    await expect(deploy([b9, b5], [t9, t5])).to.be.revertedWithCustomError(Factory, "BadVerifiers");
    await expect(deploy([b5, b9], [t9, t5])).to.be.revertedWithCustomError(Factory, "BadVerifiers");
    await expect(deploy([b5, b9], [t5, t9])).to.not.be.revert(ethers);
  });

  it("paginates the elections list", async () => {
    const now = await networkHelpers.time.latest();
    const base = await stack.factory.electionsCount();

    for (let i = 0; i < 3; i++) {
      await (
        await stack.factory.connect(organizer).createElection(baseConfig(now, { name: `Paginated ${i}` }), 0n)
      ).wait();
    }

    const all = await stack.factory.getElections(base, 100n);
    expect(all.length).to.equal(3);

    const middle = await stack.factory.getElections(base + 1n, 1n);
    expect(middle.length).to.equal(1);
    expect(middle[0]).to.equal(all[1]);

    const outOfRange = await stack.factory.getElections(base + 100n, 10n);
    expect(outOfRange.length).to.equal(0);
  });
});
