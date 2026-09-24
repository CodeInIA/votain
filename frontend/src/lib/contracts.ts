/**
 * ethers v6 read/write clients for the Votain contracts.
 *
 * Reads go through a shared JsonRpcProvider. Writes are performed either by an
 * injected EOA signer (organizer via MetaMask) or relayed through
 * ElectionPaymaster (voters): see relay.ts.
 */
import { Contract, JsonRpcProvider, type Signer } from "ethers";
import { addresses, chainInfo } from "./deployments";

// ────────────────────────────────────────────────
// ABIs (human-readable fragments, kept in sync with contracts/)
// ────────────────────────────────────────────────

export const ELECTION_FACTORY_ABI = [
  "function createElection((string name, uint8 votingType, uint256 thresholdValue, uint256 numOptions, uint256 enrollStart, uint256 enrollEnd, uint256 voteStart, uint256 voteEnd, uint256[] tallyKeys, string metadataJson, address eligibilityAttester, bytes32 eligibilityPolicyHash, uint8 personhood, uint256 privacyQuorum, bool fixedSchedule, bool cancellable) cfg, uint256 fromBalance) payable returns (address)",
  "function electionsCount() view returns (uint256)",
  "function getElections(uint256 offset, uint256 limit) view returns (address[])",
  "event ElectionCreated(address indexed electionAddress, address indexed organizer, string name, uint8 votingType)",
] as const;

export const ELECTION_ABI = [
  // config
  "function name() view returns (string)",
  "function organizer() view returns (address)",
  "function votingType() view returns (uint8)",
  "function thresholdValue() view returns (uint256)",
  "function numOptions() view returns (uint256)",
  "function enrollStart() view returns (uint256)",
  "function enrollEnd() view returns (uint256)",
  "function voteStart() view returns (uint256)",
  "function voteEnd() view returns (uint256)",
  "function scope() view returns (uint256)",
  "function tallyKeys() view returns (uint256[])",
  "function keysHash() view returns (uint256)",
  "function circuitSlots() view returns (uint256)",
  "function metadataJson() view returns (string)",
  // state
  "function phase() view returns (uint8)",
  "function memberCount() view returns (uint256)",
  "function merkleTreeRoot() view returns (uint256)",
  "function merkleTreeDepth() view returns (uint256)",
  "function hasMember(uint256 identityCommitment) view returns (bool)",
  "function ballotsRoot() view returns (uint256)",
  "function currentEpoch() view returns (uint256)",
  "function EPOCH_LENGTH() view returns (uint256)",
  "function usedTags(uint256 tag) view returns (bool)",
  "function usedEpochTags(uint256 epochTag) view returns (bool)",
  "function aggregate() view returns (uint256[2] a, uint256[] b)",
  "function voteCount() view returns (uint256)",
  /// How many voters the result rests on: zero until it is published or voided
  /// below the quorum, because nothing before the tally can say.
  "function voters() view returns (uint256)",
  "function privacyQuorum() view returns (uint256)",
  "function fixedSchedule() view returns (bool)",
  "function cancellable() view returns (bool)",
  "function createdAt() view returns (uint256)",
  "function resultsPublished() view returns (bool)",
  "function resultsCid() view returns (string)",
  "function tally() view returns (uint256[])",
  "function outcome() view returns (uint8)",
  "function winnerIndex() view returns (uint256)",
  // actions
  "function enroll(uint256 identityCommitment)",
  /// Zero on elections deployed before private enrolment existed, which still
  /// take the public paths. Anything the current factory deploys answers with
  /// the platform's key and refuses those paths.
  "function platformAttester() view returns (address)",
  "function eligibilityAttester() view returns (address)",
  "function eligibilityPolicyHash() view returns (bytes32)",
  "function personhood() view returns (uint8)",
  "function cancelElection()",
  "function openEnrollmentEarly()",
  "function openVotingEarly()",
  "function closeEnrollmentEarly()",
  "function closeVotingEarly()",
  "function markVoided()",
  "function publishResults(string ipfsCid, uint256[] tallyResults, (uint256[2] a, uint256[2][2] b, uint256[2] c) proof)",
  "function voidBelowQuorum(uint256 votersBelow, (uint256[2] a, uint256[2][2] b, uint256[2] c) proof)",
  // events
  "event MemberEnrolled(uint256 indexed identityCommitment, uint256 index, uint256 merkleTreeRoot)",
  "event BallotCast(uint256 indexed tag, uint256 index, uint256 leaf, uint256[2] voteA, uint256[] voteB, uint256[2] cancelA, uint256[] cancelB, uint256 timestamp)",
  "event ResultsPublished(string ipfsCid, uint256[] tally, uint8 outcome, uint256 winnerIndex)",
  "event VoidedBelowQuorum(uint256 voters)",
] as const;

export const PAYMASTER_ABI = [
  "function gasBalance(address organizer) view returns (uint256)",
  "function reservedFor(address election) view returns (uint256)",
  "function electionFunding(address election) view returns (uint256 reserved, uint256 organizerFree)",
  "function deposit() payable",
  "function depositForElection(address election) payable",
  "function reserveFromBalance(address election, uint256 amount)",
  "function releaseReserve(address election)",
  "function withdraw(uint256 amount)",
  // Read by the ballot-cost estimate: the two ceilings the contract applies
  // when it pays, so an estimate cannot promise more than a relay would get.
  "function maxGasPrice() view returns (uint256)",
  "function maxRelayGas() view returns (uint256)",
  "function relayVote(address election, (uint256 votersRoot, uint256 ballotsRoot, uint256 epoch, uint256 tag, uint256 epochTag, uint256 leaf, uint256[2] voteA, uint256[] voteB, uint256[2] cancelA, uint256[] cancelB) ballot, (uint256[2] a, uint256[2][2] b, uint256[2] c) proof)",
  "event Deposited(address indexed organizer, uint256 amount)",
  "event ElectionFunded(address indexed election, address indexed from, uint256 amount)",
  "event ReserveReleased(address indexed election, address indexed organizer, uint256 amount)",
  "event Withdrawn(address indexed organizer, uint256 amount)",
  "event VoteSponsored(address indexed organizer, uint256 cost, address indexed chargedBy)",
] as const;

export const REGISTRY_ABI = [
  "function verifiedMembers(uint256 identityCommitment) view returns (bool)",
  "function registeredNullifiers(uint256 nullifier) view returns (bool)",
  /// The identity currently active for a human. A rotation moves it, so a
  /// browser holding the old one is signed in as somebody who cannot enrol.
  "function commitmentOf(uint256 nullifier) view returns (uint256)",
] as const;

// ────────────────────────────────────────────────
// Providers & contract getters
// ────────────────────────────────────────────────

let readProvider: JsonRpcProvider | undefined;

export function getReadProvider(): JsonRpcProvider {
  readProvider ??= new JsonRpcProvider(chainInfo.rpcUrl, chainInfo.chainId, {
    staticNetwork: true,
  });
  return readProvider;
}

function requireAddress(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} address not configured, deploy contracts first`);
  return value;
}

export function getFactory(runner: Signer | JsonRpcProvider = getReadProvider()): Contract {
  return new Contract(requireAddress(addresses.electionFactory, "ElectionFactory"), ELECTION_FACTORY_ABI, runner);
}

export function getElection(address: string, runner: Signer | JsonRpcProvider = getReadProvider()): Contract {
  return new Contract(address, ELECTION_ABI, runner);
}

export function getPaymaster(runner: Signer | JsonRpcProvider = getReadProvider()): Contract {
  return new Contract(requireAddress(addresses.paymaster, "ElectionPaymaster"), PAYMASTER_ABI, runner);
}

export function getRegistry(runner: Signer | JsonRpcProvider = getReadProvider()): Contract {
  return new Contract(requireAddress(addresses.platformRegistry, "PlatformRegistry"), REGISTRY_ABI, runner);
}
