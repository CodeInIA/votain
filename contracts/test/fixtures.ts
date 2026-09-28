import poseidon from "poseidon-solidity";

import {
  BASE,
  encryptCancellation,
  encryptVote,
  flattenPoints,
  IDENTITY,
  multiply,
  padPoints,
  randomScalar,
  unflattenPoints,
  type Point,
} from "../../frontend/src/lib/ballotCrypto.js";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_HASH = "0x" + "00".repeat(32);

/// EIP-712 payload an eligibility attester signs to authorise one enrollment.
/// Mirrors ENROLL_TYPEHASH and the domain built in ElectionV4.
export function enrollAttestationTypedData(
  electionAddress: string,
  chainId: bigint,
  identityCommitment: bigint,
  personhoodNullifier: bigint,
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
        { name: "personhoodNullifier", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    value: { identityCommitment, personhoodNullifier, deadline },
  };
}

/// Signs an enrollment attestation the way the relay does in production.
export async function signEnrollAttestation(
  attester: any,
  electionAddress: string,
  chainId: bigint,
  identityCommitment: bigint,
  personhoodNullifier: bigint,
  deadline: number | bigint,
): Promise<string> {
  const { domain, types, value } = enrollAttestationTypedData(
    electionAddress,
    chainId,
    identityCommitment,
    personhoodNullifier,
    deadline,
  );
  return attester.signTypedData(domain, types, value);
}

/// Deploys the Poseidon libraries ElectionV4 links against (T3 for its
/// trees, T4 for its keys hash) and returns them keyed for linking.
export async function deployPoseidon(ethers: any): Promise<Record<string, string>> {
  const [deployer] = await ethers.getSigners();
  const libraries: Record<string, string> = {};
  for (const name of ["PoseidonT3", "PoseidonT4"] as const) {
    const tx = await deployer.sendTransaction({ data: poseidon[name].bytecode });
    const receipt = await tx.wait();
    if (!receipt?.contractAddress) throw new Error(`${name} deployment failed`);
    libraries[name] = receipt.contractAddress;
  }
  return libraries;
}

/// Circuit sizes the mock verifiers stand in for: the two built by default and
/// the largest, so every option count the contract allows can be deployed.
export const MOCK_SIZES = [5, 9, 51];

export interface Stack {
  registry: any;
  paymaster: any;
  factory: any;
  ballotVerifiers: any[];
  tallyVerifiers: any[];
  libraries: Record<string, string>;
}

/// EIP-712 payload the platform signs to authorise one PRIVATE enrollment.
/// Mirrors PRIVATE_ENROLL_TYPEHASH in ElectionV4.
export function privateEnrollmentTypedData(
  electionAddress: string,
  chainId: bigint,
  identityCommitment: bigint,
  humanTag: bigint,
  deadline: number | bigint,
  documentTag: bigint = 0n,
) {
  return {
    domain: {
      name: "VotainElection",
      version: "1",
      chainId,
      verifyingContract: electionAddress,
    },
    types: {
      PrivateEnrollment: [
        { name: "identityCommitment", type: "uint256" },
        { name: "humanTag", type: "uint256" },
        { name: "documentTag", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    value: { identityCommitment, humanTag, documentTag, deadline },
  };
}

/// Signs a private enrollment the way the platform does in production.
export async function signPrivateEnrollment(
  attester: any,
  electionAddress: string,
  chainId: bigint,
  identityCommitment: bigint,
  humanTag: bigint,
  deadline: number | bigint,
  documentTag: bigint = 0n,
): Promise<string> {
  const { domain, types, value } = privateEnrollmentTypedData(
    electionAddress,
    chainId,
    identityCommitment,
    humanTag,
    deadline,
    documentTag,
  );
  return attester.signTypedData(domain, types, value);
}

/// Deploys the full contract stack with mock verifiers (unit tests only).
/// `platformAttester` defaults to nobody, which deploys elections that enrol
/// the old public way: the tests for the private path pass a key explicitly.
export async function deployStack(
  ethers: any,
  platformAttester: string = ZERO_ADDRESS,
): Promise<Stack> {
  const libraries = await deployPoseidon(ethers);

  const Registry = await ethers.getContractFactory("PlatformRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const Paymaster = await ethers.getContractFactory("ElectionPaymaster");
  const paymaster = await Paymaster.deploy();
  await paymaster.waitForDeployment();

  const ballotVerifiers = [];
  const tallyVerifiers = [];
  for (const size of MOCK_SIZES) {
    ballotVerifiers.push(await (await ethers.getContractFactory("MockBallotVerifier")).deploy(size));
    tallyVerifiers.push(await (await ethers.getContractFactory("MockTallyVerifier")).deploy(size));
  }

  const Deployer = await ethers.getContractFactory("ElectionDeployer", { libraries });
  const deployer = await Deployer.deploy();
  await deployer.waitForDeployment();

  const Factory = await ethers.getContractFactory("ElectionFactory");
  const factory = await Factory.deploy(
    await paymaster.getAddress(),
    await deployer.getAddress(),
    await Promise.all(ballotVerifiers.map(v => v.getAddress())),
    await Promise.all(tallyVerifiers.map(v => v.getAddress())),
    await registry.getAddress(),
    platformAttester,
  );
  await factory.waitForDeployment();

  // Only the factory may bind an election to the tank that funds its gas.
  await (await paymaster.setFactory(await factory.getAddress())).wait();

  return { registry, paymaster, factory, ballotVerifiers, tallyVerifiers, libraries };
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
  /** Flattened affine tally keys, one per option plus the blank vote. */
  tallyKeys: bigint[];
  metadataJson: string;
  eligibilityAttester: string;
  eligibilityPolicyHash: string;
  personhood: number;
  privacyQuorum: bigint;
  /** The organizer gives up the power to move any deadline. */
  fixedSchedule: boolean;
  /** Whether the organizer may call the election off at all. */
  cancellable: boolean;
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

/**
 * The secrets behind `testTallyKeys`. Fixed and tiny ON PURPOSE: the unit tests
 * decrypt the contract's aggregate with them to show it holds what was voted,
 * and nothing about them needs to be secret.
 */
export const testTallySecrets = (numOptions: bigint): bigint[] =>
  Array.from({ length: Number(numOptions) + 1 }, (_, i) => BigInt(i + 2));

/** Valid tally keys for an election of `numOptions`: x·G for each test secret. */
export const testTallyKeys = (numOptions: bigint): Point[] =>
  testTallySecrets(numOptions).map(x => multiply(BASE, x));

/// Base election config: enrollment open now, voting starts in 1000s, ends in 2000s.
/// The tally keys follow `numOptions` unless an override supplies its own.
export function baseConfig(now: number, overrides: Partial<ElectionConfig> = {}): ElectionConfig {
  const numOptions = overrides.numOptions ?? 3n;
  return {
    tallyKeys: flattenPoints(testTallyKeys(numOptions)),
    name: "Test Election",
    votingType: VotingType.SIMPLE_PLURALITY,
    thresholdValue: 0n,
    numOptions: 3n,
    enrollStart: now - 10,
    enrollEnd: now + 1000,
    voteStart: now + 1000,
    voteEnd: now + 2000,
    metadataJson: "{}",
    eligibilityAttester: ZERO_ADDRESS,
    eligibilityPolicyHash: ZERO_HASH,
    personhood: 0,
    privacyQuorum: 0n,
    // Off by default, so the existing tests keep exercising the early-close
    // paths. The tests for the promise turn it on explicitly.
    fixedSchedule: false,
    // On by default, so the existing tests keep exercising the way out.
    cancellable: true,
    ...overrides,
  };
}

/// Deploys a standalone ElectionV4 (bypassing the factory) for focused unit
/// tests, on the smallest mock verifiers that fit its options.
export async function deployElection(
  ethers: any,
  stack: Stack,
  organizer: any,
  cfg: ElectionConfig,
  platformAttester: string = ZERO_ADDRESS,
): Promise<any> {
  const Election = await ethers.getContractFactory("ElectionV4", { libraries: stack.libraries });
  const [ballotVerifier, tallyVerifier] = await stack.factory.verifiersFor(cfg.numOptions);
  const election = await Election.deploy(
    ballotVerifier,
    tallyVerifier,
    await stack.registry.getAddress(),
    platformAttester,
    organizer.address,
    cfg,
  );
  await election.waitForDeployment();
  return election;
}

/// Dummy Groth16 proof, accepted by the mock verifiers.
export const DUMMY_PROOF = {
  a: [0n, 0n] as [bigint, bigint],
  b: [
    [0n, 0n],
    [0n, 0n],
  ] as [[bigint, bigint], [bigint, bigint]],
  c: [0n, 0n] as [bigint, bigint],
};

/** What a voter keeps of a ballot, to cancel it with the next one. */
export interface CastVote {
  a: Point;
  b: Point[];
}

let tagSeq = 1n;

/**
 * A ballot as the client builds it, minus the proof: a real encryption of
 * `choice` under the election's keys and a real cancellation of `previous`,
 * so the contract's aggregate can be decrypted and checked. Tags are fresh
 * unless given, and roots and epoch are the election's current ones.
 */
export async function makeBallot(
  election: any,
  choice: number,
  opts: { previous?: CastVote | null; tag?: bigint; epochTag?: bigint; epoch?: bigint } = {},
): Promise<{ ballot: any; vote: CastVote }> {
  const slots = Number(await election.circuitSlots());
  const keys = unflattenPoints(await election.tallyKeys());
  const vote = encryptVote(keys, choice, randomScalar());
  const cancel = encryptCancellation(keys, randomScalar(), opts.previous ?? null);
  const pad = (points: Point[]) => flattenPoints(padPoints(points, slots));
  const ballot = {
    votersRoot: await election.merkleTreeRoot(),
    ballotsRoot: await election.ballotsRoot(),
    epoch: opts.epoch ?? (await election.currentEpoch()),
    tag: opts.tag ?? tagSeq++,
    epochTag: opts.epochTag ?? tagSeq++,
    leaf: tagSeq++,
    voteA: [...vote.a],
    voteB: pad(vote.b),
    cancelA: [...cancel.a],
    cancelB: pad(cancel.b),
  };
  return { ballot, vote };
}

export { IDENTITY };
