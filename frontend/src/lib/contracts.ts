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
  "function createElection((string name, uint8 votingType, uint256 thresholdValue, uint256 numOptions, uint256 enrollStart, uint256 enrollEnd, uint256 voteStart, uint256 voteEnd, uint256 scope, string paillierPublicKey, string metadataJson, address eligibilityAttester, bytes32 eligibilityPolicyHash, uint8 personhood) cfg) payable returns (address)",
  "function electionsCount() view returns (uint256)",
  "function getElections(uint256 offset, uint256 limit) view returns (address[])",
  "event ElectionCreated(address indexed electionAddress, address indexed organizer, string name, uint8 votingType, uint256 scope)",
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
  "function paillierPublicKey() view returns (string)",
  "function metadataJson() view returns (string)",
  // state
  "function phase() view returns (uint8)",
  "function memberCount() view returns (uint256)",
  "function merkleTreeRoot() view returns (uint256)",
  "function merkleTreeDepth() view returns (uint256)",
  "function hasMember(uint256 identityCommitment) view returns (bool)",
  "function nullifierNonces(uint256 nullifier) view returns (uint256)",
  "function voteCount() view returns (uint256)",
  "function resultsPublished() view returns (bool)",
  "function resultsCid() view returns (string)",
  "function tally() view returns (uint256[])",
  "function outcome() view returns (uint8)",
  "function winnerIndex() view returns (uint256)",
  // actions
  "function enroll(uint256 identityCommitment)",
  "function enrollAttested(uint256 identityCommitment, uint256 deadline, bytes signature)",
  "function eligibilityAttester() view returns (address)",
  "function eligibilityPolicyHash() view returns (bytes32)",
  "function personhood() view returns (uint8)",
  "function castVote(bytes voteCiphertext, uint256 nullifier, uint256 merkleRoot, uint256 merkleDepth, uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC)",
  "function cancelElection()",
  "function closeEnrollmentEarly()",
  "function closeVotingEarly()",
  "function markVoided()",
  "function publishResults(string ipfsCid, uint256[] tallyResults)",
  // events
  "event MemberEnrolled(uint256 indexed identityCommitment, uint256 index, uint256 merkleTreeRoot)",
  "event VoteCast(uint256 indexed nullifier, bytes voteCiphertext, uint256 nonce, uint256 timestamp)",
  "event ResultsPublished(string ipfsCid, uint256[] tally, uint8 outcome, uint256 winnerIndex)",
] as const;

export const PAYMASTER_ABI = [
  "function gasBalance(address organizer) view returns (uint256)",
  "function depositFor(address organizer) payable",
  "function withdraw(uint256 amount)",
  "event Deposited(address indexed organizer, address indexed from, uint256 amount)",
  "event Withdrawn(address indexed organizer, uint256 amount)",
  "event VoteSponsored(address indexed organizer, uint256 cost, address indexed chargedBy)",
] as const;

export const REGISTRY_ABI = [
  "function verifiedMembers(uint256 identityCommitment) view returns (bool)",
  "function registeredNullifiers(uint256 nullifier) view returns (bool)",
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
