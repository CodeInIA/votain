import { expect } from "chai";
import { network } from "hardhat";
import { deployStack, baseConfig, type Stack } from "./fixtures.js";

const { ethers, networkHelpers } = await network.create();

const FORWARDER = "0x000000000000000000000000000000000000dEaD";

let owner: any;
let organizer: any;
let relayer: any;
let stranger: any;
let stack: Stack;

before(async () => {
  [owner, organizer, relayer, stranger] = await ethers.getSigners();
  stack = await deployStack(ethers, FORWARDER);
});

describe("ElectionPaymaster, gas tank", () => {
  it("accepts deposits via receive() and depositFor()", async () => {
    const paymaster = stack.paymaster;

    await (
      await organizer.sendTransaction({
        to: await paymaster.getAddress(),
        value: ethers.parseEther("1.0"),
      })
    ).wait();
    expect(await paymaster.gasBalance(organizer.address)).to.equal(ethers.parseEther("1.0"));

    await (
      await paymaster
        .connect(stranger)
        .depositFor(organizer.address, { value: ethers.parseEther("0.5") })
    ).wait();
    expect(await paymaster.gasBalance(organizer.address)).to.equal(ethers.parseEther("1.5"));
  });

  it("only the owner can configure the factory and relay params", async () => {
    const paymaster = stack.paymaster;

    await expect(
      paymaster.connect(stranger).setFactory(stranger.address),
    ).to.be.revertedWithCustomError(paymaster, "NotOwner");

    await expect(
      paymaster.connect(stranger).setRelayParams(1n, 1n, 1n, 1n),
    ).to.be.revertedWithCustomError(paymaster, "NotOwner");

    await expect(paymaster.connect(owner).setRelayParams(200_000_000_000n, 32_000n, 16n, 2_000_000n)).to.emit(
      paymaster,
      "RelayParamsChanged",
    );
  });

  it("only the factory may bind an election to an organizer", async () => {
    await expect(
      stack.paymaster.connect(stranger).registerElection(stranger.address, organizer.address),
    ).to.be.revertedWithCustomError(stack.paymaster, "NotFactory");
  });

  it("organizers can withdraw their unused balance", async () => {
    const paymaster = stack.paymaster;
    const before = await ethers.provider.getBalance(organizer.address);
    const amount = ethers.parseEther("0.4");

    const tx = await paymaster.connect(organizer).withdraw(amount);
    const receipt = await tx.wait();
    const gasCost = BigInt(receipt!.gasUsed) * BigInt(receipt!.gasPrice);

    expect(await ethers.provider.getBalance(organizer.address)).to.equal(before + amount - gasCost);

    await expect(
      paymaster.connect(organizer).withdraw(ethers.parseEther("100")),
    ).to.be.revertedWithCustomError(paymaster, "InsufficientBalance");
  });
});

describe("ElectionPaymaster, relaying", () => {
  let election: any;
  let commitmentSeq = 500_000n;

  function nextMember(): { nullifier: bigint; commitment: bigint } {
    commitmentSeq += 1n;
    return { nullifier: commitmentSeq * 11n, commitment: commitmentSeq };
  }

  beforeEach(async () => {
    const now = await networkHelpers.time.latest();
    const tx = await stack.factory
      .connect(organizer)
      .createElection(baseConfig(now), { value: ethers.parseEther("1") });
    await tx.wait();

    const count = await stack.factory.electionsCount();
    election = await ethers.getContractAt("ElectionV4", await stack.factory.elections(count - 1n));
  });

  it("binds each new election to the organizer that created it", async () => {
    expect(await stack.paymaster.organizerOf(await election.getAddress())).to.equal(
      organizer.address,
    );
  });

  it("relays an enrollment and reimburses the relayer from the organizer's tank", async () => {
    const { nullifier, commitment } = nextMember();
    await (await stack.registry.registerMember(nullifier, commitment)).wait();

    const tankBefore: bigint = await stack.paymaster.gasBalance(organizer.address);
    const relayerBefore = await ethers.provider.getBalance(relayer.address);

    const tx = await stack.paymaster
      .connect(relayer)
      .relayEnroll(await election.getAddress(), commitment);
    const receipt = await tx.wait();
    const spent = BigInt(receipt!.gasUsed) * BigInt(receipt!.gasPrice);

    expect(await election.hasMember(commitment)).to.equal(true);

    // The organizer paid, and the relayer is left roughly whole.
    const tankAfter: bigint = await stack.paymaster.gasBalance(organizer.address);
    const charged = tankBefore - tankAfter;
    expect(charged).to.be.greaterThan(0n);

    const relayerAfter = await ethers.provider.getBalance(relayer.address);
    expect(relayerAfter).to.equal(relayerBefore - spent + charged);
  });

  // The whole point of relaying: every voter's call arrives from this one
  // address, so the transport layer cannot link a commitment to a nullifier.
  it("makes the election see the paymaster as the caller, not the voter", async () => {
    const a = nextMember();
    const b = nextMember();
    await (await stack.registry.registerMember(a.nullifier, a.commitment)).wait();
    await (await stack.registry.registerMember(b.nullifier, b.commitment)).wait();

    const address = await election.getAddress();
    const t1 = await (await stack.paymaster.connect(relayer).relayEnroll(address, a.commitment)).wait();
    const t2 = await (await stack.paymaster.connect(stranger).relayEnroll(address, b.commitment)).wait();

    const enrolled = await election.queryFilter(election.filters.MemberEnrolled());
    expect(enrolled.length).to.equal(2);

    // Two different relayers, but the election was called by the paymaster both
    // times: the `to` of each tx is the paymaster, never a per-voter account.
    expect(t1!.to).to.equal(await stack.paymaster.getAddress());
    expect(t2!.to).to.equal(await stack.paymaster.getAddress());
  });

  // A flat overhead constant overcharged the cheap call and undercharged the
  // expensive one; charging calldata per byte keeps both within a few percent,
  // which is what stops anyone farming the difference out of a tank.
  it("reimburses close to what the relay actually cost", async () => {
    const { nullifier, commitment } = nextMember();
    await (await stack.registry.registerMember(nullifier, commitment)).wait();

    const before = await ethers.provider.getBalance(relayer.address);
    const tx = await stack.paymaster
      .connect(relayer)
      .relayEnroll(await election.getAddress(), commitment);
    const receipt = await tx.wait();
    const spent = BigInt(receipt!.gasUsed) * BigInt(receipt!.gasPrice);
    const after = await ethers.provider.getBalance(relayer.address);

    // net > 0 means the relayer profited, net < 0 that it subsidised the voter.
    // Either way the drift must stay under 15% of what the relay really cost.
    const net = after - before;
    const drift = net < 0n ? -net : net;
    expect(drift).to.be.lessThan((spent * 15n) / 100n);
  });

  // Solidity ignores calldata past the encoded arguments, but `msg.data.length`
  // still counts it. Billing from it let a relayer append zero bytes that cost
  // them 4 gas each and were reimbursed at 16, draining the tank at a profit.
  it("ignores trailing calldata padding when billing the tank", async () => {
    const a = nextMember();
    const b = nextMember();
    await (await stack.registry.registerMember(a.nullifier, a.commitment)).wait();
    await (await stack.registry.registerMember(b.nullifier, b.commitment)).wait();

    const address = await election.getAddress();
    const encode = (commitment: bigint): string =>
      stack.paymaster.interface.encodeFunctionData("relayEnroll", [address, commitment]);

    const honestBefore: bigint = await stack.paymaster.gasBalance(organizer.address);
    await (await relayer.sendTransaction({ to: await stack.paymaster.getAddress(), data: encode(a.commitment) })).wait();
    const honestCharge: bigint = honestBefore - (await stack.paymaster.gasBalance(organizer.address));

    // Same call, plus 20 KB of trailing zero bytes the decoder never reads.
    const padded = encode(b.commitment) + "00".repeat(20_000);
    const paddedBefore: bigint = await stack.paymaster.gasBalance(organizer.address);
    await (await relayer.sendTransaction({ to: await stack.paymaster.getAddress(), data: padded })).wait();
    const paddedCharge: bigint = paddedBefore - (await stack.paymaster.gasBalance(organizer.address));

    // The padding must buy the attacker nothing. Allow only execution noise.
    expect(paddedCharge).to.be.lessThan((honestCharge * 110n) / 100n);
  });

  it("caps what a single relay can take from a tank", async () => {
    expect(await stack.paymaster.maxRelayGas()).to.be.greaterThan(0n);

    const { nullifier, commitment } = nextMember();
    await (await stack.registry.registerMember(nullifier, commitment)).wait();

    // Ceiling of 1 gas: the charge collapses to the price of a single unit.
    await (await stack.paymaster.connect(owner).setRelayParams(200_000_000_000n, 32_000n, 16n, 1n)).wait();
    const before: bigint = await stack.paymaster.gasBalance(organizer.address);
    const tx = await stack.paymaster.connect(relayer).relayEnroll(await election.getAddress(), commitment);
    const receipt = await tx.wait();

    const charged: bigint = before - (await stack.paymaster.gasBalance(organizer.address));
    expect(charged).to.equal(BigInt(receipt!.gasPrice));

    await (await stack.paymaster.connect(owner).setRelayParams(200_000_000_000n, 32_000n, 16n, 2_000_000n)).wait();
  });

  it("rejects relaying for an election it does not know", async () => {
    await expect(
      stack.paymaster.connect(relayer).relayEnroll(stranger.address, 1n),
    ).to.be.revertedWithCustomError(stack.paymaster, "UnknownElection");
  });

  it("pays nothing when the underlying call reverts", async () => {
    const { commitment } = nextMember(); // never registered on the platform
    const tankBefore: bigint = await stack.paymaster.gasBalance(organizer.address);

    await expect(
      stack.paymaster.connect(relayer).relayEnroll(await election.getAddress(), commitment),
    ).to.be.revertedWithCustomError(election, "NotPlatformVerified");

    expect(await stack.paymaster.gasBalance(organizer.address)).to.equal(tankBefore);
  });

  it("caps the reimbursed gas price so a relayer cannot drain a tank", async () => {
    const { nullifier, commitment } = nextMember();
    await (await stack.registry.registerMember(nullifier, commitment)).wait();

    // 1 gwei cap while submitting far above it.
    await (await stack.paymaster.connect(owner).setRelayParams(1_000_000_000n, 32_000n, 16n, 2_000_000n)).wait();

    const tankBefore: bigint = await stack.paymaster.gasBalance(organizer.address);
    const tx = await stack.paymaster
      .connect(relayer)
      .relayEnroll(await election.getAddress(), commitment, { gasPrice: 50_000_000_000n });
    const receipt = await tx.wait();

    const charged: bigint = tankBefore - (await stack.paymaster.gasBalance(organizer.address));
    const uncapped = BigInt(receipt!.gasUsed) * 50_000_000_000n;
    expect(charged).to.be.lessThan(uncapped / 10n);

    await (await stack.paymaster.connect(owner).setRelayParams(200_000_000_000n, 32_000n, 16n, 2_000_000n)).wait();
  });

  it("refuses to relay once the organizer's tank is empty", async () => {
    const { nullifier, commitment } = nextMember();
    await (await stack.registry.registerMember(nullifier, commitment)).wait();

    // Drain the tank this election was funded with.
    const balance = await stack.paymaster.gasBalance(organizer.address);
    await (await stack.paymaster.connect(organizer).withdraw(balance)).wait();

    await expect(
      stack.paymaster.connect(relayer).relayEnroll(await election.getAddress(), commitment),
    ).to.be.revertedWithCustomError(stack.paymaster, "InsufficientBalance");
  });
});
