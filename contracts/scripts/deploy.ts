import { network } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import poseidon from "poseidon-solidity";

const conn = await network.getOrCreate();
const { ethers } = conn;

/// Ensures PoseidonT3 (external library required by LeanIMT) exists on-chain.
/// On live networks it uses the package's deterministic CREATE2 deployment so the
/// library lands at the same canonical address on every chain. On local networks
/// it deploys directly.
async function ensurePoseidonT3(deployer: any): Promise<string> {
  const provider = ethers.provider;
  const { PoseidonT3, proxy } = poseidon;

  const chainId = (await provider.getNetwork()).chainId;
  const isLocal = chainId === 31337n;

  if (isLocal) {
    const tx = await deployer.sendTransaction({ data: PoseidonT3.bytecode });
    const receipt = await tx.wait();
    return receipt.contractAddress;
  }

  if ((await provider.getCode(PoseidonT3.address)) !== "0x") {
    console.log("PoseidonT3 already deployed at:", PoseidonT3.address);
    return PoseidonT3.address;
  }

  // Fund and publish the keyless CREATE2 proxy if this chain doesn't have it yet
  if ((await provider.getCode(proxy.address)) === "0x") {
    await (await deployer.sendTransaction({ to: proxy.from, value: BigInt(proxy.gas) })).wait();
    await provider.send("eth_sendRawTransaction", [proxy.tx]);
    console.log("CREATE2 proxy deployed at:", proxy.address);
  }

  await (await deployer.sendTransaction({ to: proxy.address, data: PoseidonT3.data })).wait();
  console.log("PoseidonT3 deployed at:", PoseidonT3.address);
  return PoseidonT3.address;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const isLocal = chainId === 31337n;
  const networkName = isLocal ? "local" : chainId === 80002n ? "amoy" : `chain-${chainId}`;

  console.log(`Deploying to ${networkName} (chainId ${chainId}) with account: ${deployer.address}`);

  const poseidonAddress = await ensurePoseidonT3(deployer);

  const Registry = await ethers.getContractFactory("PlatformRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  console.log("PlatformRegistry:", await registry.getAddress());

  // Self-service and owned by nobody: a domain claim proves nothing on its own,
  // since a reader resolves the TXT record and checks it names the organizer.
  const Domains = await ethers.getContractFactory("OrganizerDomains");
  const domains = await Domains.deploy();
  await domains.waitForDeployment();
  console.log("OrganizerDomains:", await domains.getAddress());

  // Also ownerless, and for a related reason: the wallet that owns an
  // organizer's elections is the right key for their sealed tally secret, so
  // there is nobody to ask permission from. Without it a second passkey means
  // a second tally key, and results that no longer decrypt.
  const Vault = await ethers.getContractFactory("OrganizerVault");
  const organizerVault = await Vault.deploy();
  await organizerVault.waitForDeployment();
  console.log("OrganizerVault:", await organizerVault.getAddress());

  const Paymaster = await ethers.getContractFactory("ElectionPaymaster");
  const paymaster = await Paymaster.deploy();
  await paymaster.waitForDeployment();
  console.log("ElectionPaymaster:", await paymaster.getAddress());

  // Official Semaphore V4 Groth16 verifier in production; mock only for local runs.
  const verifierName =
    isLocal && process.env.USE_REAL_VERIFIER !== "true" ? "MockVerifier" : "SemaphoreVerifierV4";
  const Verifier = await ethers.getContractFactory(verifierName);
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  console.log(`${verifierName}:`, await verifier.getAddress());

  // ERC-2771 forwarder. Voter calls arrive via ElectionPaymaster and neither
  // enroll nor castVote reads msg.sender, so a burn address is the right value;
  // see contracts/DEVELOPMENT.md.
  const forwarder = process.env.TRUSTED_FORWARDER ?? deployer.address;
  if (!process.env.TRUSTED_FORWARDER) {
    console.warn("WARN: TRUSTED_FORWARDER not set, falling back to deployer address");
  }

  const Factory = await ethers.getContractFactory("ElectionFactory", {
    libraries: { PoseidonT3: poseidonAddress },
  });
  const factory = await Factory.deploy(
    await paymaster.getAddress(),
    forwarder,
    await verifier.getAddress(),
    await registry.getAddress(),
  );
  await factory.waitForDeployment();
  console.log("ElectionFactory:", await factory.getAddress());

  // Only the factory may bind an election to the tank that funds it.
  await (await paymaster.setFactory(await factory.getAddress())).wait();
  console.log("Paymaster factory configured:", await factory.getAddress());

  // Block the platform went live at. Every log query starts here instead of
  // block 0, which keeps eth_getLogs inside the range caps that most free RPC
  // endpoints enforce (10000 blocks on drpc and publicnode).
  const deployedAtBlock = await ethers.provider.getBlockNumber();

  // Persist addresses for the frontend client (src/lib/contracts.ts reads this).
  const deployment = {
    chainId: Number(chainId),
    network: networkName,
    deployedAt: new Date().toISOString(),
    deployedAtBlock,
    deployer: deployer.address,
    contracts: {
      PlatformRegistry: await registry.getAddress(),
      OrganizerDomains: await domains.getAddress(),
      OrganizerVault: await organizerVault.getAddress(),
      ElectionPaymaster: await paymaster.getAddress(),
      [verifierName]: await verifier.getAddress(),
      ElectionFactory: await factory.getAddress(),
      PoseidonT3: poseidonAddress,
    },
    config: { trustedForwarder: forwarder },
  };

  const manifest = JSON.stringify(deployment, null, 2) + "\n";
  const contractsRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

  // contracts/deployments/<network>.json (source of truth)
  const outDir = join(contractsRoot, "deployments");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${networkName}.json`);
  writeFileSync(outFile, manifest);
  console.log("Deployment manifest written to:", outFile);

  // Mirror into the frontend so its client picks up the addresses (glob import).
  const frontendDir = join(contractsRoot, "..", "frontend", "src", "lib", "deployments");
  try {
    mkdirSync(frontendDir, { recursive: true });
    writeFileSync(join(frontendDir, `${networkName}.json`), manifest);
    console.log("Frontend manifest mirrored to:", join(frontendDir, `${networkName}.json`));
  } catch (e) {
    console.warn("Could not mirror manifest to frontend:", e);
  }
}

await main();
