import { expect } from "chai";
import { network } from "hardhat";
import { describe, it } from "node:test";

const { ethers, networkHelpers } = await network.create();

describe("ElectionV4 - Coercion Resistance & Ethers v6", function () {
  it("Should allow a user to vote multiple times by incrementing the nonce without reverting", async function () {
    const forwarder = ethers.Wallet.createRandom().address;
    const groupId = 1n;
    const scope = 2n;

    const latestTime = await networkHelpers.time.latest();
    const startTime = latestTime - 3600;
    const endTime = latestTime + 3600;

    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    const verifier = await MockVerifier.deploy();
    await verifier.waitForDeployment();

    const Election = await ethers.getContractFactory("ElectionV4");
    const election = await Election.deploy(
      forwarder,
      await verifier.getAddress(),
      groupId,
      scope,
      startTime,
      endTime,
    );
    await election.waitForDeployment();

    const nullifier = 123456789n;
    const voteCiphertext1 = 987654321n;
    const voteCiphertext2 = 111111111n;

    const merkleRoot = 0n;
    const merkleDepth = 20n;
    const pA: [bigint, bigint] = [0n, 0n];
    const pB: [[bigint, bigint], [bigint, bigint]] = [[0n, 0n], [0n, 0n]];
    const pC: [bigint, bigint] = [0n, 0n];

    // First vote
    const tx1 = await election.castVote(voteCiphertext1, nullifier, merkleRoot, merkleDepth, pA, pB, pC);
    const receipt1 = await tx1.wait();
    const block1 = await ethers.provider.getBlock(receipt1!.blockNumber);

    await expect(tx1)
      .to.emit(election, "VoteCast")
      .withArgs(nullifier, voteCiphertext1, 0n, block1!.timestamp);

    expect(await election.nullifierNonces(nullifier)).to.equal(1n);

    // Second vote (coercion or correction)
    const tx2 = await election.castVote(voteCiphertext2, nullifier, merkleRoot, merkleDepth, pA, pB, pC);
    const receipt2 = await tx2.wait();
    const block2 = await ethers.provider.getBlock(receipt2!.blockNumber);

    await expect(tx2)
      .to.emit(election, "VoteCast")
      .withArgs(nullifier, voteCiphertext2, 1n, block2!.timestamp);

    // Third vote: advance past endTime, should revert
    await networkHelpers.time.increaseTo(endTime + 100);

    await expect(
      election.castVote(voteCiphertext2, nullifier, merkleRoot, merkleDepth, pA, pB, pC),
    ).to.be.revertedWith("Election not active");
  });
});
