import poseidon from "poseidon-solidity";

/// Library name used for linking (HH3 resolves the bare name when unambiguous).
export const POSEIDON_FQN = "PoseidonT3";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_HASH = "0x" + "00".repeat(32);

/// EIP-712 payload an eligibility attester signs to authorise one enrollment.
/// Mirrors ENROLL_TYPEHASH and the domain built in ElectionV4.
export function enrollAttestationTypedData(
  electionAddress: string,
  chainId: bigint,
  identityCommitment: bigint,
  deadline: number | bigint,
) {
  return {
    domain: {
      name: "VotainElection",
      version: "1",
      chainId,
      verifyingContract: electionAddress,
    },
    types: {
      EnrollAttestation: [
        { name: "identityCommitment", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    value: { identityCommitment, deadline },
  };
}

/// Signs an enrollment attestation the way the relay does in production.
export async function signEnrollAttestation(
  attester: any,
  electionAddress: string,
  chainId: bigint,
  identityCommitment: bigint,
  deadline: number | bigint,
): Promise<string> {
  const { domain, types, value } = enrollAttestationTypedData(
    electionAddress,
    chainId,
    identityCommitment,
    deadline,
  );
  return attester.signTypedData(domain, types, value);
}

/// Deploys the PoseidonT3 external library (required by LeanIMT) on the local
/// test network and returns its address.
export async function deployPoseidonT3(ethers: any): Promise<string> {
  const [deployer] = await ethers.getSigners();
  const tx = await deployer.sendTransaction({ data: poseidon.PoseidonT3.bytecode });
  const receipt = await tx.wait();
  if (!receipt?.contractAddress) throw new Error("PoseidonT3 deployment failed");
  return receipt.contractAddress;
}

export interface Stack {
  registry: any;
  paymaster: any;
  verifier: any;
  factory: any;
  poseidonAddress: string;
}

/// Deploys the full contract stack with the MockVerifier (unit tests only).
export async function deployStack(ethers: any, forwarder: string): Promise<Stack> {
  const poseidonAddress = await deployPoseidonT3(ethers);

  const Registry = await ethers.getContractFactory("PlatformRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const Paymaster = await ethers.getContractFactory("ElectionPaymaster");
  const paymaster = await Paymaster.deploy();
  await paymaster.waitForDeployment();

  const Verifier = await ethers.getContractFactory("MockVerifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();

  const Factory = await ethers.getContractFactory("ElectionFactory", {
    libraries: { [POSEIDON_FQN]: poseidonAddress },
  });
  const factory = await Factory.deploy(
    await paymaster.getAddress(),
    forwarder,
    await verifier.getAddress(),
    await registry.getAddress(),
  );
  await factory.waitForDeployment();

  // Only the factory may bind an election to the tank that funds its gas.
  await (await paymaster.setFactory(await factory.getAddress())).wait();

  return { registry, paymaster, verifier, factory, poseidonAddress };
}

export interface ElectionConfig {
  name: string;
  votingType: number;
  thresholdValue: bigint;
  numOptions: bigint;
  enrollStart: number;
  enrollEnd: number;
  voteStart: number;
  voteEnd: number;
  scope: bigint;
  paillierPublicKey: string;
  metadataJson: string;
  eligibilityAttester: string;
  eligibilityPolicyHash: string;
}

export const VotingType = {
  SIMPLE_PLURALITY: 0,
  ABSOLUTE_MAJORITY: 1,
  SUPERMAJORITY_TWO_THIRDS: 2,
  WITNESS_THRESHOLD: 3,
} as const;

export const Phase = {
  UPCOMING: 0n,
  ENROLLING: 1n,
  PENDING_VOTE: 2n,
  ACTIVE: 3n,
  TALLYING: 4n,
  CLOSED: 5n,
  VOIDED: 6n,
  CANCELLED: 7n,
} as const;

export const Outcome = {
  NONE: 0n,
  WINNER: 1n,
  TIE: 2n,
  APPROVED: 3n,
  REJECTED: 4n,
  THRESHOLD_NOT_MET: 5n,
} as const;

/// Base election config: enrollment open now, voting starts in 1000s, ends in 2000s.
export function baseConfig(now: number, overrides: Partial<ElectionConfig> = {}): ElectionConfig {
  return {
    name: "Test Election",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    numOptions: 3n,
    enrollStart: now - 10,
    enrollEnd: now + 1000,
    voteStart: now + 1000,
    voteEnd: now + 2000,
    scope: 42n,
    paillierPublicKey: '{"n":"0x1234","g":"0x1235"}',
    metadataJson: "{}",
    eligibilityAttester: ZERO_ADDRESS,
    eligibilityPolicyHash: ZERO_HASH,
    ...overrides,
  };
}

/// Deploys a standalone ElectionV4 (bypassing the factory) for focused unit tests.
export async function deployElection(
  ethers: any,
  stack: Stack,
  forwarder: string,
  organizer: any,
  cfg: ElectionConfig,
): Promise<any> {
  const Election = await ethers.getContractFactory("ElectionV4", {
    libraries: { [POSEIDON_FQN]: stack.poseidonAddress },
  });
  const election = await Election.deploy(
    forwarder,
    await stack.verifier.getAddress(),
    await stack.registry.getAddress(),
    organizer.address,
    cfg,
  );
  await election.waitForDeployment();
  return election;
}

/// Dummy Groth16 proof accepted by the MockVerifier.
export const DUMMY_PROOF = {
  pA: [0n, 0n] as [bigint, bigint],
  pB: [
    [0n, 0n],
    [0n, 0n],
  ] as [[bigint, bigint], [bigint, bigint]],
  pC: [0n, 0n] as [bigint, bigint],
};
