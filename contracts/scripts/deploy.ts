import { network } from "hardhat";

const { ethers } = await network.create();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const PlatformRegistry = await ethers.getContractFactory("PlatformRegistry");
  const registry = await PlatformRegistry.deploy();
  await registry.waitForDeployment();
  console.log("PlatformRegistry deployed to:", await registry.getAddress());

  const ElectionPaymaster = await ethers.getContractFactory("ElectionPaymaster");
  const paymaster = await ElectionPaymaster.deploy();
  await paymaster.waitForDeployment();
  console.log("ElectionPaymaster deployed to:", await paymaster.getAddress());

  const MockVerifier = await ethers.getContractFactory("MockVerifier");
  const verifier = await MockVerifier.deploy();
  await verifier.waitForDeployment();
  console.log("MockVerifier deployed to:", await verifier.getAddress());

  const ElectionFactory = await ethers.getContractFactory("ElectionFactory");
  const factory = await ElectionFactory.deploy(
    await paymaster.getAddress(),
    deployer.address,
    await verifier.getAddress(),
  );
  await factory.waitForDeployment();
  console.log("ElectionFactory deployed to:", await factory.getAddress());

  console.log("--- Base Setup Completed ---");
}

await main();
