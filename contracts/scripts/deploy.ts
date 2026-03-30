import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // 1. Deploy PlatformRegistry
  const PlatformRegistry = await ethers.getContractFactory("PlatformRegistry");
  const registry = await PlatformRegistry.deploy();
  await registry.waitForDeployment();
  console.log("PlatformRegistry deployed to:", await registry.getAddress());

  // 2. Deploy ElectionPaymaster
  const ElectionPaymaster = await ethers.getContractFactory("ElectionPaymaster");
  const paymaster = await ElectionPaymaster.deploy();
  await paymaster.waitForDeployment();
  console.log("ElectionPaymaster deployed to:", await paymaster.getAddress());

  // In a real Biconomy environment, we would use the Amoy Testnet Trusted Forwarder address.
  // For local test / setup, we use the deployer account or a dummy account.
  const biconomyForwarderMock = deployer.address;

  // 3. Deploy MockVerifier first (Factory needs it)
  const MockVerifier = await ethers.getContractFactory("MockVerifier");
  const verifier = await MockVerifier.deploy();
  await verifier.waitForDeployment();
  console.log("MockVerifier deployed to:", await verifier.getAddress());

  // 4. Deploy ElectionFactory
  const ElectionFactory = await ethers.getContractFactory("ElectionFactory");
  const factory = await ElectionFactory.deploy(await paymaster.getAddress(), biconomyForwarderMock, await verifier.getAddress());
  await factory.waitForDeployment();
  console.log("ElectionFactory deployed to:", await factory.getAddress());

  console.log("--- Base Setup (Phase 1) Completed ---");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
