/// Estimates how much native currency (POL on Polygon Amoy) a full Votain
/// deployment costs, by replaying the exact `deploy.ts` sequence on the
/// in-process Hardhat network and measuring the gas each step consumes.
///
/// Usage:
///   npx hardhat run scripts/estimate-deploy-cost.ts
///   GAS_PRICE_GWEI=50 npx hardhat run scripts/estimate-deploy-cost.ts
///   ESTIMATE_RPC_URL=https://polygon-amoy.drpc.org npx hardhat run scripts/estimate-deploy-cost.ts
///
/// The live gas price and the PoseidonT3 / CREATE2-proxy presence are read from
/// `ESTIMATE_RPC_URL` (defaults to `AMOY_RPC_URL`) when that endpoint is
/// reachable. Otherwise it falls back to `GAS_PRICE_GWEI` (default 30, which is
/// Polygon's enforced minimum priority fee).
import { network } from "hardhat";
import poseidon from "poseidon-solidity";

const DEFAULT_RPC = "https://polygon-amoy-bor-rpc.publicnode.com";
const FALLBACK_GAS_PRICE_GWEI = 30n;

interface Step {
  label: string;
  gas: bigint;
  /// Steps paid later out of the same wallet, but not part of the deploy itself.
  organizerPays?: boolean;
  /// Steps paid out of the organizer's gas tank, not the deployer's balance.
  sponsored?: boolean;
  /// Steps that may be skipped when the target chain already has the contract.
  conditional?: string;
}

interface ChainInfo {
  rpc: string;
  gasPriceWei: bigint;
  poseidonDeployed: boolean;
  proxyDeployed: boolean;
  live: boolean;
  /// Live balance of the configured PRIVATE_KEY on the target chain, when set.
  deployer?: { address: string; balanceWei: bigint };
}

async function rpc(url: string, method: string, params: unknown[]): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: string; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  if (body.result === undefined) throw new Error(`${method}: empty result`);
  return body.result;
}

async function probeChain(): Promise<ChainInfo> {
  const url = process.env.ESTIMATE_RPC_URL ?? process.env.AMOY_RPC_URL ?? DEFAULT_RPC;
  const fallbackPrice = (process.env.GAS_PRICE_GWEI ? BigInt(process.env.GAS_PRICE_GWEI) : FALLBACK_GAS_PRICE_GWEI) * 10n ** 9n;

  try {
    const [price, poseidonCode, proxyCode] = await Promise.all([
      rpc(url, "eth_gasPrice", []),
      rpc(url, "eth_getCode", [poseidon.PoseidonT3.address, "latest"]),
      rpc(url, "eth_getCode", [poseidon.proxy.address, "latest"]),
    ]);
    const info: ChainInfo = {
      rpc: url,
      gasPriceWei: process.env.GAS_PRICE_GWEI ? fallbackPrice : BigInt(price),
      poseidonDeployed: poseidonCode !== "0x",
      proxyDeployed: proxyCode !== "0x",
      live: true,
    };

    // Report the real shortfall when a deployer key is configured.
    if (process.env.PRIVATE_KEY) {
      const { Wallet } = await import("ethers");
      const address = new Wallet(process.env.PRIVATE_KEY).address;
      const balance = await rpc(url, "eth_getBalance", [address, "latest"]);
      info.deployer = { address, balanceWei: BigInt(balance) };
    }

    return info;
  } catch (error: unknown) {
    console.warn(`Could not reach ${url} (${(error as Error).message}). Using offline assumptions.`);
    return { rpc: url, gasPriceWei: fallbackPrice, poseidonDeployed: false, proxyDeployed: true, live: false };
  }
}

function formatPol(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(6);
}

async function main(): Promise<void> {
  const chain = await probeChain();

  const conn = await network.getOrCreate();
  const { ethers } = conn;
  const [deployer, organizer] = await ethers.getSigners();

  const steps: Step[] = [];

  const gasOf = async (promise: Promise<unknown>): Promise<bigint> => {
    const tx = (await promise) as { wait: () => Promise<{ gasUsed: bigint }> };
    const receipt = await tx.wait();
    return receipt.gasUsed;
  };

  // 1. PoseidonT3 external library (LeanIMT dependency).
  const poseidonGas = await gasOf(deployer.sendTransaction({ data: poseidon.PoseidonT3.bytecode }));
  const poseidonAddress = (await ethers.provider.getTransactionReceipt(
    (await ethers.provider.getBlock("latest"))!.transactions.at(-1)!,
  ))!.contractAddress!;
  steps.push({
    label: "PoseidonT3 library",
    gas: poseidonGas,
    conditional: chain.poseidonDeployed ? "already on chain, SKIPPED" : undefined,
  });

  // 2. PlatformRegistry.
  const Registry = await ethers.getContractFactory("PlatformRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  steps.push({
    label: "PlatformRegistry",
    gas: (await ethers.provider.getTransactionReceipt(registry.deploymentTransaction()!.hash))!.gasUsed,
  });

  // 3. ElectionPaymaster.
  const Paymaster = await ethers.getContractFactory("ElectionPaymaster");
  const paymaster = await Paymaster.deploy();
  await paymaster.waitForDeployment();
  steps.push({
    label: "ElectionPaymaster",
    gas: (await ethers.provider.getTransactionReceipt(paymaster.deploymentTransaction()!.hash))!.gasUsed,
  });

  // 4. Official Semaphore Groth16 verifier (production path).
  const Verifier = await ethers.getContractFactory("SemaphoreVerifierV4");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  steps.push({
    label: "SemaphoreVerifierV4",
    gas: (await ethers.provider.getTransactionReceipt(verifier.deploymentTransaction()!.hash))!.gasUsed,
  });

  // 5. ElectionFactory (embeds the ElectionV4 creation bytecode).
  const Factory = await ethers.getContractFactory("ElectionFactory", {
    libraries: { PoseidonT3: poseidonAddress },
  });
  const factory = await Factory.deploy(
    await paymaster.getAddress(),
    deployer.address,
    await verifier.getAddress(),
    await registry.getAddress(),
  );
  await factory.waitForDeployment();
  steps.push({
    label: "ElectionFactory",
    gas: (await ethers.provider.getTransactionReceipt(factory.deploymentTransaction()!.hash))!.gasUsed,
  });

  // 6. Paymaster wiring: only the factory may bind an election to a gas tank.
  steps.push({
    label: "paymaster.setFactory",
    gas: await gasOf(paymaster.setFactory(await factory.getAddress())),
  });

  // 7. One election created through the factory (organizer pays this, not the deployer).
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const cfg = {
    name: "Gas estimation election",
    votingType: 0,
    thresholdValue: 0n,
    numOptions: 3n,
    enrollStart: now - 10,
    enrollEnd: now + 100000,
    voteStart: now + 100000,
    voteEnd: now + 200000,
    scope: 42n,
    paillierPublicKey: '{"n":"0x' + "ab".repeat(256) + '","g":"0x' + "cd".repeat(256) + '"}',
    metadataJson: JSON.stringify({ description: "x".repeat(400), candidates: ["A", "B", "C"] }),
    eligibilityAttester: "0x0000000000000000000000000000000000000000",
    eligibilityPolicyHash: "0x" + "00".repeat(32),
  };
  steps.push({
    label: "factory.createElection (per election)",
    gas: await gasOf(factory.connect(organizer).createElection(cfg)),
    organizerPays: true,
  });

  // 8. Voter enrollment (registry write by the issuer + on-chain tree insert).
  const electionAddress = await factory.elections(0);
  const election = await ethers.getContractAt("ElectionV4", electionAddress, deployer);
  steps.push({
    // Paid by REGISTRAR_PRIVATE_KEY, which must be the deployer key.
    label: "registry.registerMember (per voter, registrar pays)",
    gas: await gasOf(registry.registerMember(1234n, 5678n)),
    organizerPays: true,
  });
  steps.push({
    // Relayed through ElectionPaymaster and reimbursed from the organizer's
    // tank, so it comes out of their deposit rather than the deployer's balance.
    label: "election.enroll (per voter)",
    gas: await gasOf(election.enroll(5678n)),
    sponsored: true,
  });

  // ── Report ──
  const gwei = Number(chain.gasPriceWei) / 1e9;
  console.log("");
  console.log("═".repeat(78));
  console.log("  VOTAIN, Polygon Amoy deployment cost estimate");
  console.log("═".repeat(78));
  console.log(`  Gas price source : ${chain.live ? chain.rpc : "offline fallback"}`);
  console.log(`  Gas price        : ${gwei.toFixed(2)} gwei`);
  console.log(`  PoseidonT3       : ${chain.poseidonDeployed ? "already deployed on target chain" : "must be deployed"}`);
  console.log(`  CREATE2 proxy    : ${chain.proxyDeployed ? "already deployed" : "MISSING, deploy.ts funds it with 0.01 POL"}`);
  console.log("─".repeat(78));

  let deployerGas = 0n;
  let organizerGas = 0n;

  for (const step of steps) {
    const cost = step.gas * chain.gasPriceWei;
    const skipped = step.conditional !== undefined;
    if (!skipped && !step.sponsored) {
      if (step.organizerPays) organizerGas += step.gas;
      else deployerGas += step.gas;
    }
    const note =
      step.conditional ?? (step.sponsored ? "from gas tank" : step.organizerPays ? "post-deploy" : "");
    console.log(
      `  ${step.label.padEnd(46)} ${step.gas.toString().padStart(9)} gas  ${formatPol(cost).padStart(10)} POL  ${note}`,
    );
  }

  console.log("─".repeat(78));

  // The CREATE2 proxy needs 0.01 POL of keyless-deployer funding when absent.
  const proxyFunding = chain.proxyDeployed || chain.poseidonDeployed ? 0n : BigInt(poseidon.proxy.gas);
  const deployerCost = deployerGas * chain.gasPriceWei + proxyFunding;

  console.log(`  ONE-TIME DEPLOY (deployer key)   ${deployerGas.toString().padStart(9)} gas  ${formatPol(deployerCost).padStart(10)} POL`);
  if (proxyFunding > 0n) {
    console.log(`    (includes ${formatPol(proxyFunding)} POL to fund the keyless CREATE2 proxy)`);
  }
  console.log(`  POST-DEPLOY, SAME WALLET         ${organizerGas.toString().padStart(9)} gas  ${formatPol(organizerGas * chain.gasPriceWei).padStart(10)} POL`);
  console.log(`    (1 election created + 1 voter registered on the registry)`);
  console.log("─".repeat(78));

  for (const multiplier of [1.5, 2, 3]) {
    const safe = (deployerCost * BigInt(Math.round(multiplier * 100))) / 100n;
    console.log(`  Recommended balance (${multiplier}x margin on deploy):  ${formatPol(safe).padStart(10)} POL`);
  }

  if (chain.deployer) {
    const target = deployerCost * 2n + organizerGas * chain.gasPriceWei;
    const { address, balanceWei } = chain.deployer;
    console.log("─".repeat(78));
    console.log(`  Deployer ${address}`);
    console.log(`  Current balance                                       ${formatPol(balanceWei).padStart(10)} POL`);
    console.log(`  Target (2x deploy + 1 election + 1 enroll)            ${formatPol(target).padStart(10)} POL`);
    if (balanceWei >= target) {
      console.log(`  ✅ Funded. Run \`npm run deploy:amoy\`.`);
    } else if (balanceWei >= deployerCost) {
      console.log(`  ⚠️  Enough for the deploy but no margin. Top up ${formatPol(target - balanceWei)} POL.`);
    } else {
      console.log(`  ❌ NOT enough: short by ${formatPol(deployerCost - balanceWei)} POL for the deploy alone.`);
      console.log(`     Top up ${formatPol(target - balanceWei)} POL to hit the target.`);
    }
  }

  console.log("═".repeat(78));
  console.log("");
  const optimized = process.argv.includes("production");
  console.log("  Notes:");
  if (optimized) {
    console.log("  - Compiled with the `production` profile (optimizer on), same as `deploy:amoy`.");
  } else {
    console.log("  - Compiled with the `default` profile (no optimizer). Add");
    console.log("    `--build-profile production` to match what `npm run deploy:amoy` does;");
    console.log("    it cuts the deploy by ~17% and each election by ~29%.");
  }
  console.log("  - Polygon enforces a 30 gwei minimum priority fee; the base fee is ~0 on Amoy,");
  console.log("    so 30 gwei is effectively the floor and the price rarely moves.");
  console.log("  - castVote is not measured here: it needs a real Groth16 proof. Budget roughly");
  console.log("    350k-450k gas per vote, paid by the paymaster gas tank.");
  console.log("");
}

await main();
