import { network } from "hardhat";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * The key every election deployed here will trust for private enrolment.
 *
 * It has to be the address the BACKEND signs with, because it is frozen into
 * each election: deploying with a different one produces elections that server
 * can never let anyone into. Read from the backend's own .env for that reason,
 * the same way the seed reads it, so the two cannot be made to disagree by
 * hand. `PLATFORM_ATTESTER_ADDRESS` wins when set, which is what a deployment
 * whose signer lives somewhere else (a TEE, a KMS) needs.
 */
function resolvePlatformAttester(): string {
  const configured = process.env.PLATFORM_ATTESTER_ADDRESS;
  if (configured) return ethers.getAddress(configured);

  const backendEnv = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "backend", ".env");
  try {
    const line = readFileSync(backendEnv, "utf-8").match(
      /^ELIGIBILITY_ATTESTER_PRIVATE_KEY=(.+)$/m,
    );
    const key = line?.[1].trim();
    return key ? new ethers.Wallet(key).address : ZERO_ADDRESS;
  } catch {
    return ZERO_ADDRESS;
  }
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

  const platformAttester = resolvePlatformAttester();
  if (platformAttester === ZERO_ADDRESS) {
    const complaint =
      "No platform attester: elections deployed here will enrol the OLD way, with the " +
      "voter's platform commitment in every tree, which publishes which elections each " +
      "person joined. Set PLATFORM_ATTESTER_ADDRESS, or put " +
      "ELIGIBILITY_ATTESTER_PRIVATE_KEY in backend/.env so this script can derive it.";

    /**
     * FATAL OFF THE LOCAL CHAIN, and only a warning on it.
     *
     * A real deployment that forgets this key still works: every screen looks
     * right, voters enrol, ballots count. The only thing that changes is that
     * the chain publishes who took part in what, which is precisely the thing
     * nobody notices until somebody reads the chain. A warning scrolls past in
     * a deploy log; this does not.
     *
     * The escape hatch is deliberate and has to be typed out: a chain deployed
     * with no platform behind it can only use the public paths.
     */
    if (!isLocal && process.env.ALLOW_PUBLIC_ENROLMENT !== "1") {
      throw new Error(complaint + " Set ALLOW_PUBLIC_ENROLMENT=1 if that is genuinely intended.");
    }
    console.warn(complaint);
  } else {
    console.log("Platform attester (private enrolment):", platformAttester);
  }

  const Factory = await ethers.getContractFactory("ElectionFactory", {
    libraries: { PoseidonT3: poseidonAddress },
  });
  const factory = await Factory.deploy(
    await paymaster.getAddress(),
    await verifier.getAddress(),
    await registry.getAddress(),
    platformAttester,
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
      ElectionPaymaster: await paymaster.getAddress(),
      [verifierName]: await verifier.getAddress(),
      ElectionFactory: await factory.getAddress(),
      PoseidonT3: poseidonAddress,
    },
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
