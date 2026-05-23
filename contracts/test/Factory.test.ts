import { expect } from "chai";
import { network } from "hardhat";
import { describe, it } from "node:test";

const { ethers, networkHelpers } = await network.create();

describe("Factory and Paymaster E2E", function () {
  it("Should allow the organizer to fund the factory, deploy an election and route funds to paymaster", async function () {
    const [, organizer] = await ethers.getSigners();
    const forwarder = ethers.Wallet.createRandom().address;

    const Paymaster = await ethers.getContractFactory("ElectionPaymaster");
    const paymaster = await Paymaster.deploy();
    await paymaster.waitForDeployment();

    const Verifier = await ethers.getContractFactory("MockVerifier");
    const verifier = await Verifier.deploy();
    await verifier.waitForDeployment();

    const Factory = await ethers.getContractFactory("ElectionFactory");
    const factory = await Factory.deploy(
      await paymaster.getAddress(),
      forwarder,
      await verifier.getAddress(),
    );
    await factory.waitForDeployment();

    const fundingAmount = ethers.parseEther("2.0");
    const groupId = 1n;
    const scope = 2n;
    const latestTime = await networkHelpers.time.latest();
    const startTime = latestTime + 3600;
    const endTime = startTime + 7200;

    const tx = await factory.connect(organizer).createElection(
      "Presidential 2026",
      groupId,
      scope,
      startTime,
      endTime,
      { value: fundingAmount },
    );

    const receipt = await tx.wait();
    expect(receipt).not.to.be.null;

    const filter = factory.filters.ElectionCreated();
    const events = await factory.queryFilter(filter, receipt!.blockNumber, receipt!.blockNumber);
    expect(events.length).to.equal(1);
    expect(events[0].args.name).to.equal("Presidential 2026");
    expect(events[0].args.electionAddress).to.not.equal(ethers.ZeroAddress);

    const organizerBalanceInPaymaster = await paymaster.gasBalance(organizer.address);
    expect(organizerBalanceInPaymaster).to.equal(fundingAmount);
  });
});
