import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("ElectionV4 - Coercion Resistance & Ethers v6", function () {
  it("Should allow a user to vote multiple times by incrementing the nonce without reverting", async function () {
    const forwarder = hre.ethers.Wallet.createRandom().address;
    const groupId = 1n;
    const scope = 2n;
    
    const latestTime = await time.latest();
    const startTime = latestTime - 3600; // 1 hour in the past
    const endTime = latestTime + 3600;   // 1 hour in the future
    
    const MockVerifier = await hre.ethers.getContractFactory("MockVerifier");
    const verifier = await MockVerifier.deploy();
    await verifier.waitForDeployment();

    const Election = await hre.ethers.getContractFactory("ElectionV4");
    const election = await Election.deploy(forwarder, await verifier.getAddress(), groupId, scope, startTime, endTime);
    await election.waitForDeployment();

    const nullifier = 123456789n;
    const voteCiphertext1 = 987654321n;
    const voteCiphertext2 = 111111111n; // Vote change under coercion

    const merkleRoot = 0n;
    const merkleDepth = 20n;
    const pA: [bigint, bigint] = [0n, 0n];
    const pB: [[bigint, bigint], [bigint, bigint]] = [[0n, 0n], [0n, 0n]];
    const pC: [bigint, bigint] = [0n, 0n];

    // --- First Vote ---
    // Initial nonce is 0. After voting it will be 1.
    const tx1 = await election.castVote(voteCiphertext1, nullifier, merkleRoot, merkleDepth, pA, pB, pC);
    
    // Validate first vote event
    await expect(tx1)
      .to.emit(election, "VoteCast")
      .withArgs(nullifier, voteCiphertext1, 0n, (await hre.ethers.provider.getBlock("latest"))?.timestamp);

    expect(await election.nullifierNonces(nullifier)).to.equal(1n);

    // --- Second Vote (Coercion or Correction) ---
    // After voting it will be 2. Never reverts on duplicate nullifier
    const tx2 = await election.castVote(voteCiphertext2, nullifier, merkleRoot, merkleDepth, pA, pB, pC);
    
    // Validate second vote event
    await expect(tx2)
      .to.emit(election, "VoteCast")
      .withArgs(nullifier, voteCiphertext2, 1n, (await hre.ethers.provider.getBlock("latest"))?.timestamp);

    // --- Third Vote (Time Block) ---
    // Fast forward time to put the blockchain beyond the election's endTime
    await time.increaseTo(endTime + 100);
    
    // Attempting to cast a vote should revert with the exact error message
    await expect(
      election.castVote(voteCiphertext2, nullifier, merkleRoot, merkleDepth, pA, pB, pC)
    ).to.be.revertedWith("Election not active");
  });
});
