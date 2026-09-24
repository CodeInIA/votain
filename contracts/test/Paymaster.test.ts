import { expect } from "chai";
import { network } from "hardhat";
import { deployStack, baseConfig, DUMMY_PROOF, makeBallot, type Stack } from "./fixtures.js";

const { ethers, networkHelpers } = await network.create();


let owner: any;
let organizer: any;
let relayer: any;
let stranger: any;
let stack: Stack;

before(async () => {
  [owner, organizer, relayer, stranger] = await ethers.getSigners();
  stack = await deployStack(ethers);
});

describe("ElectionPaymaster, gas tank", () => {
  it("accepts deposits via receive() and deposit()", async () => {
    const paymaster = stack.paymaster;

    await (
      await organizer.sendTransaction({
        to: await paymaster.getAddress(),
        value: ethers.parseEther("1.0"),
      })
    ).wait();
    expect(await paymaster.gasBalance(organizer.address)).to.equal(ethers.parseEther("1.0"));

    // Each deposit credits WHOEVER SENT IT. This used to take an address and
    // fill anyone's tank, which put money in a balance its owner never chose to
    // hold and a row in their history they could not account for.
    await (
      await paymaster.connect(stranger).deposit({ value: ethers.parseEther("0.5") })
    ).wait();
    expect(await paymaster.gasBalance(stranger.address)).to.equal(ethers.parseEther("0.5"));
    expect(await paymaster.gasBalance(organizer.address)).to.equal(ethers.parseEther("1.0"));
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

  /**
   * Everything behind this election, whichever pot it sits in.
   *
   * Relaying now spends the election's own reserve before the organizer's free
   * balance, so a test that watches only `gasBalance` sees a charge of zero and
   * concludes nothing was billed.
   */
  async function funding(): Promise<bigint> {
    const [reserved, free] = await stack.paymaster.electionFunding(await election.getAddress());
    return reserved + free;
  }

  beforeEach(async () => {
    const now = await networkHelpers.time.latest();
    const tx = await stack.factory
      .connect(organizer)
      .createElection(baseConfig(now), 0n, { value: ethers.parseEther("1") });
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

    const tankBefore: bigint = await funding();
    const relayerBefore = await ethers.provider.getBalance(relayer.address);

    const tx = await stack.paymaster
      .connect(relayer)
      .relayEnroll(await election.getAddress(), commitment);
    const receipt = await tx.wait();
    const spent = BigInt(receipt!.gasUsed) * BigInt(receipt!.gasPrice);

    expect(await election.hasMember(commitment)).to.equal(true);

    // The organizer paid, and the relayer is left roughly whole.
    const tankAfter: bigint = await funding();
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

    const honestBefore: bigint = await funding();
    await (await relayer.sendTransaction({ to: await stack.paymaster.getAddress(), data: encode(a.commitment) })).wait();
    const honestCharge: bigint = honestBefore - (await funding());

    // Same call, plus 20 KB of trailing zero bytes the decoder never reads.
    const padded = encode(b.commitment) + "00".repeat(20_000);
    const paddedBefore: bigint = await funding();
    await (await relayer.sendTransaction({ to: await stack.paymaster.getAddress(), data: padded })).wait();
    const paddedCharge: bigint = paddedBefore - (await funding());

    // The padding must buy the attacker nothing. Allow only execution noise.
    expect(paddedCharge).to.be.lessThan((honestCharge * 110n) / 100n);
  });

  it("caps what a single relay can take from a tank", async () => {
    expect(await stack.paymaster.maxRelayGas()).to.be.greaterThan(0n);

    const { nullifier, commitment } = nextMember();
    await (await stack.registry.registerMember(nullifier, commitment)).wait();

    // Ceiling of 1 gas: the charge collapses to the price of a single unit.
    await (await stack.paymaster.connect(owner).setRelayParams(200_000_000_000n, 32_000n, 16n, 1n)).wait();
    const before: bigint = await funding();
    const tx = await stack.paymaster.connect(relayer).relayEnroll(await election.getAddress(), commitment);
    const receipt = await tx.wait();

    const charged: bigint = before - (await funding());
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
    const tankBefore: bigint = await funding();

    await expect(
      stack.paymaster.connect(relayer).relayEnroll(await election.getAddress(), commitment),
    ).to.be.revertedWithCustomError(election, "NotPlatformVerified");

    expect(await funding()).to.equal(tankBefore);
  });

  it("caps the reimbursed gas price so a relayer cannot drain a tank", async () => {
    const { nullifier, commitment } = nextMember();
    await (await stack.registry.registerMember(nullifier, commitment)).wait();

    // 1 gwei cap while submitting far above it.
    await (await stack.paymaster.connect(owner).setRelayParams(1_000_000_000n, 32_000n, 16n, 2_000_000n)).wait();

    const tankBefore: bigint = await funding();
    const tx = await stack.paymaster
      .connect(relayer)
      .relayEnroll(await election.getAddress(), commitment, { gasPrice: 50_000_000_000n });
    const receipt = await tx.wait();

    const charged: bigint = tankBefore - (await funding());
    const uncapped = BigInt(receipt!.gasUsed) * 50_000_000_000n;
    expect(charged).to.be.lessThan(uncapped / 10n);

    await (await stack.paymaster.connect(owner).setRelayParams(200_000_000_000n, 32_000n, 16n, 2_000_000n)).wait();
  });

  it("refuses to relay when nothing is behind the election", async () => {
    const { nullifier, commitment } = nextMember();
    await (await stack.registry.registerMember(nullifier, commitment)).wait();

    // An election created with no reserve, so the free balance is all there is.
    const now = await networkHelpers.time.latest();
    await (await stack.factory.connect(organizer).createElection(baseConfig(now), 0n)).wait();
    const count = await stack.factory.electionsCount();
    const unfunded = await stack.factory.elections(count - 1n);

    const free = await stack.paymaster.gasBalance(organizer.address);
    if (free > 0n) await (await stack.paymaster.connect(organizer).withdraw(free)).wait();

    await expect(
      stack.paymaster.connect(relayer).relayEnroll(unfunded, commitment),
    ).to.be.revertedWithCustomError(stack.paymaster, "InsufficientBalance");
  });
});

/**
 * Gas committed to one election.
 *
 * The tank was one pot per organizer, and `withdraw` had no conditions, so an
 * organizer could empty it while their own election was open. Voters hold no
 * wallet by design, so the relayer going unpaid means voting stops: turnout is
 * public while an election runs, which makes that a shutdown switch for whoever
 * dislikes how it is going. A reserve is money the organizer cannot take back
 * until the election can no longer take a vote.
 */
describe("ElectionPaymaster, gas reserved for one election", () => {
  let election: any;
  let address: string;
  let commitmentSeq = 900_000n;

  function nextMember(): { nullifier: bigint; commitment: bigint } {
    commitmentSeq += 1n;
    return { nullifier: commitmentSeq * 13n, commitment: commitmentSeq };
  }

  async function enrolSomeone(target: string = address): Promise<void> {
    const { nullifier, commitment } = nextMember();
    await (await stack.registry.registerMember(nullifier, commitment)).wait();
    await (await stack.paymaster.connect(relayer).relayEnroll(target, commitment)).wait();
  }

  beforeEach(async () => {
    const now = await networkHelpers.time.latest();
    await (
      await stack.factory
        .connect(organizer)
        .createElection(baseConfig(now), 0n, { value: ethers.parseEther("1") })
    ).wait();
    const count = await stack.factory.electionsCount();
    address = await stack.factory.elections(count - 1n);
    election = await ethers.getContractAt("ElectionV4", address);
  });

  it("puts what was attached at creation behind that election, not in the shared pot", async () => {
    expect(await stack.paymaster.reservedFor(address)).to.equal(ethers.parseEther("1"));

    const [reserved, free] = await stack.paymaster.electionFunding(address);
    expect(reserved).to.equal(ethers.parseEther("1"));
    // Reported apart, never added up: only the first kind cannot be withdrawn.
    expect(free).to.equal(await stack.paymaster.gasBalance(organizer.address));
  });

  it("does not let the organizer stop their own election by withdrawing", async () => {
    // The whole reason this exists. Everything the organizer can move, moved.
    const free = await stack.paymaster.gasBalance(organizer.address);
    if (free > 0n) await (await stack.paymaster.connect(organizer).withdraw(free)).wait();
    expect(await stack.paymaster.gasBalance(organizer.address)).to.equal(0n);

    // The reserve is untouched and voters carry on.
    expect(await stack.paymaster.reservedFor(address)).to.equal(ethers.parseEther("1"));
    await enrolSomeone();
    expect(await election.memberCount()).to.equal(1n);
  });

  it("refuses to hand back a reserve while the election can still take a vote", async () => {
    await expect(
      stack.paymaster.releaseReserve(address),
    ).to.be.revertedWithCustomError(stack.paymaster, "ElectionStillOpen");
  });

  it("spends the reserve before the organizer's free balance", async () => {
    const reservedBefore: bigint = await stack.paymaster.reservedFor(address);
    const freeBefore: bigint = await stack.paymaster.gasBalance(organizer.address);

    await enrolSomeone();

    expect(await stack.paymaster.reservedFor(address)).to.be.lessThan(reservedBefore);
    // Untouched: spending the free balance while a reserve sits there would
    // drain what every other election of theirs depends on.
    expect(await stack.paymaster.gasBalance(organizer.address)).to.equal(freeBefore);
  });

  it("falls back to the free balance once the reserve runs out", async () => {
    // An election with nothing reserved, funded only by the shared pot.
    const now = await networkHelpers.time.latest();
    await (await stack.factory.connect(organizer).createElection(baseConfig(now), 0n)).wait();
    const count = await stack.factory.electionsCount();
    const bare = await stack.factory.elections(count - 1n);

    await (
      await stack.paymaster.connect(organizer).deposit({
        value: ethers.parseEther("1"),
      })
    ).wait();
    const freeBefore: bigint = await stack.paymaster.gasBalance(organizer.address);

    await enrolSomeone(bare);

    // Liveness, and no promise broken: the free balance was never promised.
    expect(await stack.paymaster.gasBalance(organizer.address)).to.be.lessThan(freeBefore);
  });

  it("gives back what is left once voting can no longer happen", async () => {
    await enrolSomeone();
    const left: bigint = await stack.paymaster.reservedFor(address);
    const freeBefore: bigint = await stack.paymaster.gasBalance(organizer.address);

    await networkHelpers.time.increaseTo(Number(await election.voteEnd()) + 1);

    await expect(stack.paymaster.releaseReserve(address))
      .to.emit(stack.paymaster, "ReserveReleased")
      .withArgs(address, organizer.address, left);

    expect(await stack.paymaster.reservedFor(address)).to.equal(0n);
    expect(await stack.paymaster.gasBalance(organizer.address)).to.equal(freeBefore + left);

    // And now it really is the organizer's to take.
    await (await stack.paymaster.connect(organizer).withdraw(left)).wait();
  });

  it("gives a cancelled election's reserve back at once", async () => {
    // Holding the money would punish stopping an election that should be
    // stopped, and a cancelled election will never relay anything again.
    await (await election.connect(organizer).cancelElection()).wait();

    await expect(stack.paymaster.releaseReserve(address)).to.emit(
      stack.paymaster,
      "ReserveReleased",
    );
    expect(await stack.paymaster.reservedFor(address)).to.equal(0n);
  });

  it("releases only once", async () => {
    await (await election.connect(organizer).cancelElection()).wait();
    await (await stack.paymaster.releaseReserve(address)).wait();

    await expect(
      stack.paymaster.releaseReserve(address),
    ).to.be.revertedWithCustomError(stack.paymaster, "NothingReserved");
  });

  it("lets the organizer add to it, and nobody take it out", async () => {
    await (
      await stack.paymaster
        .connect(organizer)
        .depositForElection(address, { value: ethers.parseEther("0.5") })
    ).wait();

    expect(await stack.paymaster.reservedFor(address)).to.equal(ethers.parseEther("1.5"));

    // Not even by the person who put it there: that is what the voter is shown.
    // The free balance is emptied first so the only thing left to reach for is
    // the reserve, which is the claim being made.
    const free = await stack.paymaster.gasBalance(organizer.address);
    if (free > 0n) await (await stack.paymaster.connect(organizer).withdraw(free)).wait();
    await expect(
      stack.paymaster.connect(organizer).withdraw(1n),
    ).to.be.revertedWithCustomError(stack.paymaster, "InsufficientBalance");
    expect(await stack.paymaster.reservedFor(address)).to.equal(ethers.parseEther("1.5"));
  });

  it("refuses a stranger's money, because the leftovers are not theirs", async () => {
    // This was open to anyone at first, and `releaseReserve` pays the unspent
    // part to the ORGANIZER: funding someone else's election was making them a
    // gift of whatever the voters did not use, with no way to ask for it back.
    await expect(
      stack.paymaster
        .connect(stranger)
        .depositForElection(address, { value: ethers.parseEther("0.5") }),
    ).to.be.revertedWithCustomError(stack.paymaster, "NotElectionOrganizer");
  });

  it("gives a stranger no way to put money in this organizer's tank either", async () => {
    // Nor should it. Giving an organizer gas is a transfer between two wallets,
    // and leaving it there lets them decide whether it enters a contract at all.
    const before = await stack.paymaster.gasBalance(organizer.address);
    await (
      await stack.paymaster.connect(stranger).deposit({ value: ethers.parseEther("0.5") })
    ).wait();

    expect(await stack.paymaster.gasBalance(organizer.address)).to.equal(before);
    expect(await stack.paymaster.gasBalance(stranger.address)).to.be.greaterThan(0n);
  });

  it("refuses money aimed at something that is not an election", async () => {
    await expect(
      stack.paymaster.depositForElection(stranger.address, { value: 1n }),
    ).to.be.revertedWithCustomError(stack.paymaster, "UnknownElection");
  });
});

/**
 * One door to the wallet.
 *
 * Money enters at `deposit` and leaves at `withdraw`. Everything else moves
 * between two columns of the same tank: into an election with
 * `reserveFromBalance`, back out with `releaseReserve`. Before this the second
 * of those existed and the first did not, so leftovers came back to the free
 * balance and could never be sent anywhere again without a round trip through
 * the organizer's wallet.
 */
describe("ElectionPaymaster, moving a balance into an election", () => {
  let election: string;

  beforeEach(async () => {
    const now = await networkHelpers.time.latest();
    await (await stack.factory.connect(organizer).createElection(baseConfig(now), 0n)).wait();
    const count = await stack.factory.electionsCount();
    election = await stack.factory.elections(count - 1n);
    // A clean slate, so the numbers below are only about this test.
    const free = await stack.paymaster.gasBalance(organizer.address);
    if (free > 0n) await (await stack.paymaster.connect(organizer).withdraw(free)).wait();
  });

  it("moves gas the organizer already holds, without touching their wallet", async () => {
    await (
      await stack.paymaster.connect(organizer).deposit({ value: ethers.parseEther("3") })
    ).wait();

    const walletBefore = await ethers.provider.getBalance(organizer.address);
    const tx = await stack.paymaster
      .connect(organizer)
      .reserveFromBalance(election, ethers.parseEther("2"));
    const receipt = await tx.wait();
    const fee = BigInt(receipt!.gasUsed) * BigInt(receipt!.gasPrice);

    expect(await stack.paymaster.reservedFor(election)).to.equal(ethers.parseEther("2"));
    expect(await stack.paymaster.gasBalance(organizer.address)).to.equal(ethers.parseEther("1"));
    // The only thing that left the wallet is the fee for the transaction: no
    // value crossed, which is the whole point of the two columns.
    expect(await ethers.provider.getBalance(organizer.address)).to.equal(walletBefore - fee);
  });

  it("refuses to spend a balance on somebody else's election", async () => {
    await (
      await stack.paymaster.connect(stranger).deposit({ value: ethers.parseEther("1") })
    ).wait();

    // Committing your OWN money to an election is open to anyone, because a
    // third party may want it to go ahead. Spending a balance is not the same
    // act and only its holder may decide it.
    await expect(
      stack.paymaster.connect(stranger).reserveFromBalance(election, ethers.parseEther("1")),
    ).to.be.revertedWithCustomError(stack.paymaster, "NotElectionOrganizer");
  });

  it("refuses to move more than is there", async () => {
    await (
      await stack.paymaster.connect(organizer).deposit({ value: ethers.parseEther("1") })
    ).wait();

    await expect(
      stack.paymaster.connect(organizer).reserveFromBalance(election, ethers.parseEther("2")),
    ).to.be.revertedWithCustomError(stack.paymaster, "InsufficientBalance");
  });

  it("comes back to the balance it came from, and can go round again", async () => {
    await (
      await stack.paymaster.connect(organizer).deposit({ value: ethers.parseEther("2") })
    ).wait();
    await (
      await stack.paymaster.connect(organizer).reserveFromBalance(election, ethers.parseEther("2"))
    ).wait();

    const e = await ethers.getContractAt("ElectionV4", election);
    await (await e.connect(organizer).cancelElection()).wait();
    await (await stack.paymaster.releaseReserve(election)).wait();

    expect(await stack.paymaster.gasBalance(organizer.address)).to.equal(ethers.parseEther("2"));
    // And out through the one door it came in by.
    await (await stack.paymaster.connect(organizer).withdraw(ethers.parseEther("2"))).wait();
    expect(await stack.paymaster.gasBalance(organizer.address)).to.equal(0n);
  });
});

describe("ElectionFactory, funding a new election from both sources", () => {
  it("takes what it can from the balance and the rest from the transaction", async () => {
    await (
      await stack.paymaster.connect(organizer).deposit({ value: ethers.parseEther("1.5") })
    ).wait();
    const freeBefore = await stack.paymaster.gasBalance(organizer.address);

    const now = await networkHelpers.time.latest();
    await (
      await stack.factory.connect(organizer).createElection(baseConfig(now), ethers.parseEther("1"), {
        value: ethers.parseEther("0.5"),
      })
    ).wait();
    const count = await stack.factory.electionsCount();
    const created = await stack.factory.elections(count - 1n);

    // One signature, both sources: a wizard that had to create and then reserve
    // would leave the election unfunded whenever the second call was rejected.
    expect(await stack.paymaster.reservedFor(created)).to.equal(ethers.parseEther("1.5"));
    expect(await stack.paymaster.gasBalance(organizer.address)).to.equal(
      freeBefore - ethers.parseEther("1"),
    );
  });

  it("creates nothing when the balance it was told to use is not there", async () => {
    const free = await stack.paymaster.gasBalance(organizer.address);
    if (free > 0n) await (await stack.paymaster.connect(organizer).withdraw(free)).wait();
    const before = await stack.factory.electionsCount();

    const now = await networkHelpers.time.latest();
    await expect(
      stack.factory.connect(organizer).createElection(baseConfig(now), ethers.parseEther("1")),
    ).to.be.revertedWithCustomError(stack.paymaster, "InsufficientBalance");

    // An election created with less behind it than was asked for is worse than
    // one that was never created, so the whole transaction goes.
    expect(await stack.factory.electionsCount()).to.equal(before);
  });
});

describe("ElectionPaymaster, what its owner cannot do", () => {
  it("names the factory once, so no later factory can claim anybody's balance", async () => {
    const Paymaster = await ethers.getContractFactory("ElectionPaymaster");
    const paymaster = await Paymaster.connect(owner).deploy();
    await paymaster.waitForDeployment();

    await (await paymaster.connect(owner).setFactory(stranger.address)).wait();
    await expect(
      paymaster.connect(owner).setFactory(owner.address),
    ).to.be.revertedWithCustomError(paymaster, "FactoryAlreadySet");
  });

  it("lets even the factory spend a balance only on that organizer's own election", async () => {
    const Paymaster = await ethers.getContractFactory("ElectionPaymaster");
    const paymaster = await Paymaster.connect(owner).deploy();
    await paymaster.waitForDeployment();
    // An account standing in for the factory, to drive the factory-only paths.
    await (await paymaster.connect(owner).setFactory(relayer.address)).wait();

    const election = ethers.Wallet.createRandom().address;
    await (await paymaster.connect(relayer).registerElection(election, stranger.address)).wait();
    await (await paymaster.connect(organizer).deposit({ value: ethers.parseEther("1") })).wait();

    // The organizer's money, pointed at somebody else's election.
    await expect(
      paymaster.connect(relayer).reserveFromBalanceFor(election, organizer.address, 1n),
    ).to.be.revertedWithCustomError(paymaster, "NotElectionOrganizer");
  });

  it("keeps the relay parameters inside fixed bounds", async () => {
    const p = stack.paymaster.connect(owner);
    const gwei = 1_000_000_000n;
    await expect(p.setRelayParams(501n * gwei, 32_000n, 16n, 2_000_000n)).to.be.revertedWithCustomError(
      stack.paymaster,
      "RelayParamsOutOfBounds",
    );
    await expect(p.setRelayParams(50n * gwei, 100_001n, 16n, 2_000_000n)).to.be.revertedWithCustomError(
      stack.paymaster,
      "RelayParamsOutOfBounds",
    );
    await expect(p.setRelayParams(50n * gwei, 32_000n, 17n, 2_000_000n)).to.be.revertedWithCustomError(
      stack.paymaster,
      "RelayParamsOutOfBounds",
    );
    await expect(p.setRelayParams(50n * gwei, 32_000n, 16n, 6_000_001n)).to.be.revertedWithCustomError(
      stack.paymaster,
      "RelayParamsOutOfBounds",
    );
    await expect(p.setRelayParams(0n, 32_000n, 16n, 2_000_000n)).to.be.revertedWithCustomError(
      stack.paymaster,
      "RelayParamsOutOfBounds",
    );
    await expect(p.setRelayParams(500n * gwei, 100_000n, 16n, 6_000_000n)).to.emit(
      stack.paymaster,
      "RelayParamsChanged",
    );
    // Back to the defaults for the tests that follow.
    await (await p.setRelayParams(50n * gwei, 32_000n, 16n, 2_000_000n)).wait();
  });
});

describe("ElectionPaymaster, sponsored ballots", () => {
  /**
   * The paymaster no longer keeps a per-voter cooldown: it keyed on the
   * Semaphore nullifier, which made every voter's ballots publicly linkable.
   * The election's epoch tags bound the same rate, so a relayed voter gets one
   * sponsored ballot per epoch and the relay learns nothing about whose.
   */
  it("relays and reimburses a ballot, and one voter gets one per epoch", async () => {
    const now = await networkHelpers.time.latest();
    await (
      await stack.factory
        .connect(organizer)
        .createElection(baseConfig(now, { voteEnd: now + 3 * 3600 }), 0n, {
          value: ethers.parseEther("1"),
        })
    ).wait();
    const address = await stack.factory.elections((await stack.factory.electionsCount()) - 1n);
    const election = await ethers.getContractAt("ElectionV4", address);

    const nullifier = 88_001n;
    const commitment = 88_002n;
    await (await stack.registry.registerMember(nullifier, commitment)).wait();
    await (await stack.paymaster.connect(relayer).relayEnroll(address, commitment)).wait();
    await networkHelpers.time.increaseTo(await election.voteStart());

    const reserved = await stack.paymaster.reservedFor(address);
    const first = await makeBallot(election, 0, { epochTag: 5_001n });
    await expect(stack.paymaster.connect(relayer).relayVote(address, first.ballot, DUMMY_PROOF))
      .to.emit(election, "BallotCast")
      .and.to.emit(stack.paymaster, "VoteSponsored");
    expect(await stack.paymaster.reservedFor(address)).to.be.lessThan(reserved);

    const again = await makeBallot(election, 1, { previous: first.vote, epochTag: 5_001n });
    await expect(
      stack.paymaster.connect(relayer).relayVote(address, again.ballot, DUMMY_PROOF),
    ).to.be.revertedWithCustomError(election, "EpochAlreadyCast");

    // The override is delayed, never refused: next epoch, it lands.
    await networkHelpers.time.increase(Number(await election.EPOCH_LENGTH()));
    const later = await makeBallot(election, 1, { previous: first.vote, epochTag: 5_002n });
    await expect(stack.paymaster.connect(relayer).relayVote(address, later.ballot, DUMMY_PROOF)).to.emit(
      election,
      "BallotCast",
    );
    expect(await election.voteCount()).to.equal(2n);
  });
});
