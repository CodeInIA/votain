import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

let owner: any;
let organizer: any;
let entryPoint: any;
let stranger: any;
let paymaster: any;

before(async () => {
  [owner, organizer, entryPoint, stranger] = await ethers.getSigners();
  const Paymaster = await ethers.getContractFactory("ElectionPaymaster");
  paymaster = await Paymaster.deploy();
  await paymaster.waitForDeployment();
});

describe("ElectionPaymaster", () => {
  it("accepts deposits via receive() and depositFor()", async () => {
    await (
      await organizer.sendTransaction({
        to: await paymaster.getAddress(),
        value: ethers.parseEther("1.0"),
      })
    ).wait();
    expect(await paymaster.gasBalance(organizer.address)).to.equal(ethers.parseEther("1.0"));

    await (
      await paymaster.connect(stranger).depositFor(organizer.address, { value: ethers.parseEther("0.5") })
    ).wait();
    expect(await paymaster.gasBalance(organizer.address)).to.equal(ethers.parseEther("1.5"));
  });

  it("only the owner can configure sponsors", async () => {
    await expect(
      paymaster.connect(stranger).setSponsors(entryPoint.address, entryPoint.address),
    ).to.be.revertedWithCustomError(paymaster, "NotOwner");

    await expect(paymaster.connect(owner).setSponsors(entryPoint.address, entryPoint.address)).to.emit(
      paymaster,
      "SponsorsConfigured",
    );
  });

  it("sponsorVote is restricted to configured sponsors", async () => {
    await expect(
      paymaster.connect(stranger).sponsorVote(organizer.address, 1n),
    ).to.be.revertedWithCustomError(paymaster, "NotAuthorizedSponsor");

    const cost = ethers.parseEther("0.1");
    await expect(paymaster.connect(entryPoint).sponsorVote(organizer.address, cost)).to.emit(
      paymaster,
      "VoteSponsored",
    );
    expect(await paymaster.gasBalance(organizer.address)).to.equal(ethers.parseEther("1.4"));
  });

  it("rejects sponsoring beyond the organizer's balance", async () => {
    await expect(
      paymaster.connect(entryPoint).sponsorVote(organizer.address, ethers.parseEther("100")),
    ).to.be.revertedWithCustomError(paymaster, "InsufficientBalance");
  });

  it("organizers can withdraw their unused balance", async () => {
    const before = await ethers.provider.getBalance(organizer.address);
    const amount = ethers.parseEther("0.4");

    const tx = await paymaster.connect(organizer).withdraw(amount);
    const receipt = await tx.wait();
    const gasCost = BigInt(receipt!.gasUsed) * BigInt(receipt!.gasPrice);

    expect(await paymaster.gasBalance(organizer.address)).to.equal(ethers.parseEther("1.0"));
    expect(await ethers.provider.getBalance(organizer.address)).to.equal(before + amount - gasCost);

    await expect(
      paymaster.connect(organizer).withdraw(ethers.parseEther("100")),
    ).to.be.revertedWithCustomError(paymaster, "InsufficientBalance");
  });
});
