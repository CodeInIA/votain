import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("Factory and Paymaster E2E", function () {
  it("Should allow the organizer to fund the factory, deploy an election and route funds to paymaster", async function () {
    const [deployer, organizer] = await hre.ethers.getSigners();
    const forwarder = hre.ethers.Wallet.createRandom().address;

    // 1. Deploy base infrastructure (Phase 1)
    const Paymaster = await hre.ethers.getContractFactory("ElectionPaymaster");
    const paymaster = await Paymaster.deploy();
    await paymaster.waitForDeployment();

    const Verifier = await hre.ethers.getContractFactory("MockVerifier");
    const verifier = await Verifier.deploy();
    await verifier.waitForDeployment();

    const Factory = await hre.ethers.getContractFactory("ElectionFactory");
    const factory = await Factory.deploy(await paymaster.getAddress(), forwarder, await verifier.getAddress());
    await factory.waitForDeployment();

    // 2. Organizer calls createElection with native MATIC value (e.g., 2 MATIC)
    const fundingAmount = hre.ethers.parseEther("2.0");
    const groupId = 1n;
    const scope = 2n;
    const latestTime = await time.latest();
    const startTime = latestTime + 3600;
    const endTime = startTime + 7200;

    // Create Election with value
    const tx = await factory.connect(organizer).createElection(
      "Presidential 2026",
      groupId,
      scope,
      startTime,
      endTime,
      { value: fundingAmount }
    );

    const receipt = await tx.wait();
    expect(receipt).not.to.be.null;

    // Check ElectionCreated event to get the address
    const filter = factory.filters.ElectionCreated();
    const events = await factory.queryFilter(filter, receipt!.blockNumber, receipt!.blockNumber);
    expect(events.length).to.equal(1);
    expect(events[0].args.name).to.equal("Presidential 2026");
    expect(events[0].args.electionAddress).to.not.equal(hre.ethers.ZeroAddress);

    // 3. Verify that the funds were correctly routed to the Paymaster's gasBalance mapping
    const organizerBalanceInPaymaster = await paymaster.gasBalance(organizer.address);
    expect(organizerBalanceInPaymaster).to.equal(fundingAmount);
  });
});
