import { expect } from "chai";
import { network } from "hardhat";
import { deployStack, baseConfig, VotingType, type Stack } from "./fixtures.js";

const { ethers, networkHelpers } = await network.create();

const FORWARDER = ethers.Wallet.createRandom().address;

let stack: Stack;
let organizer: any;

before(async () => {
  [, organizer] = await ethers.getSigners();
  stack = await deployStack(ethers, FORWARDER);
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
    expect(await election.scope()).to.equal(cfg.scope);
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
