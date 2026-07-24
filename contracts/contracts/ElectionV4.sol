// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.36;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ISemaphoreVerifier} from "@semaphore-protocol/contracts/interfaces/ISemaphoreVerifier.sol";
import {InternalLeanIMT, LeanIMTData} from "@zk-kit/lean-imt.sol/InternalLeanIMT.sol";

interface IPlatformRegistry {
    function verifiedMembers(uint256 identityCommitment) external view returns (bool);
}

/// @title ElectionV4
/// @notice A single anonymous, coercion-resistant election. Members enroll their
/// Semaphore identity commitment into an on-chain Lean Incremental Merkle Tree and
/// later cast Paillier-encrypted votes proving group membership with a Semaphore V4
/// zero-knowledge proof. Re-voting is allowed: only the highest nonce per nullifier
/// counts at tally time (coercion resistance).
contract ElectionV4 is ERC2771Context {
    using InternalLeanIMT for LeanIMTData;

    // ────────────────────────────────────────────────
    // Types
    // ────────────────────────────────────────────────

    enum VotingType {
        SIMPLE_PLURALITY,          // most votes wins
        ABSOLUTE_MAJORITY,         // winner needs > 50% of votes cast
        SUPERMAJORITY_TWO_THIRDS,  // Yes/No, approved if yes >= 2/3 of votes cast
        WITNESS_THRESHOLD          // Yes/No, approved if yes >= thresholdValue
    }

    // Lifecycle order. UPCOMING (before enrollment opens) and PENDING_VOTE
    // (enrollment closed, voting not yet open — only reachable when enrollEnd <
    // voteStart) are distinct from ENROLLING so the UI never invites an action
    // the timing checks in enroll()/castVote() would revert.
    enum Phase { UPCOMING, ENROLLING, PENDING_VOTE, ACTIVE, TALLYING, CLOSED, VOIDED, CANCELLED }

    enum Outcome { NONE, WINNER, TIE, APPROVED, REJECTED, THRESHOLD_NOT_MET }

    struct Config {
        string name;
        VotingType votingType;
        uint256 thresholdValue; // WITNESS_THRESHOLD only: minimum yes votes
        uint256 numOptions;     // candidate/option count, blank vote excluded
        uint256 enrollStart;
        uint256 enrollEnd;
        uint256 voteStart;
        uint256 voteEnd;
        uint256 scope;          // Semaphore V4 scope (external nullifier)
        string paillierPublicKey; // JSON {"n": "0x…", "g": "0x…"} voters encrypt with
        string metadataJson;    // description, candidates, organizer name, tags (IPFS on mainnet)
    }

    // ────────────────────────────────────────────────
    // Constants / immutables
    // ────────────────────────────────────────────────

    /// @dev Old merkle roots stay valid this long after being superseded, so proofs
    /// generated just before another member enrolls do not become unusable.
    uint256 public constant MERKLE_ROOT_VALIDITY = 1 hours;

    uint256 public constant MIN_TREE_DEPTH = 1;
    uint256 public constant MAX_TREE_DEPTH = 32;

    address public immutable organizer;
    ISemaphoreVerifier public immutable verifier;
    IPlatformRegistry public immutable registry;

    // ────────────────────────────────────────────────
    // Election config
    // ────────────────────────────────────────────────

    string public name;
    VotingType public votingType;
    uint256 public thresholdValue;
    uint256 public numOptions;
    uint256 public enrollStart;
    uint256 public enrollEnd;
    uint256 public voteStart;
    uint256 public voteEnd;
    uint256 public scope;
    string public paillierPublicKey;
    string public metadataJson;

    // ────────────────────────────────────────────────
    // State
    // ────────────────────────────────────────────────

    bool public cancelled;
    bool public voided;
    bool public resultsPublished;

    LeanIMTData internal membersTree;

    /// @dev merkle root => timestamp of its creation (0 = never existed)
    mapping(uint256 => uint256) public rootTimestamps;

    /// @dev nullifier => next expected nonce (number of votes cast by that member)
    mapping(uint256 => uint256) public nullifierNonces;

    /// @dev Total VoteCast events emitted (re-votes included).
    uint256 public voteCount;

    string public resultsCid;
    uint256[] internal _tally;
    Outcome public outcome;
    uint256 public winnerIndex; // meaningful only when outcome == WINNER

    // ────────────────────────────────────────────────
    // Events / errors
    // ────────────────────────────────────────────────

    event MemberEnrolled(uint256 indexed identityCommitment, uint256 index, uint256 merkleTreeRoot);
    event VoteCast(uint256 indexed nullifier, bytes voteCiphertext, uint256 nonce, uint256 timestamp);
    event EnrollmentClosedEarly(uint256 newEnrollEnd, uint256 newVoteStart);
    event VotingClosedEarly(uint256 newVoteEnd);
    event ElectionCancelled(address indexed by);
    event ElectionVoided(address indexed by);
    event ResultsPublished(string ipfsCid, uint256[] tally, Outcome outcome, uint256 winnerIndex);

    error InvalidConfig();
    error NotOrganizer();
    error AlreadyCancelled();
    error AlreadyDecided();
    error EnrollmentNotOpen();
    error VotingNotOpen();
    error VotingNotEnded();
    error NotPlatformVerified();
    error AlreadyEnrolled();
    error UnknownOrExpiredRoot();
    error InvalidTreeDepth();
    error InvalidProof();
    error InvalidTally();
    error WrongPhase();

    // ────────────────────────────────────────────────
    // Modifiers
    // ────────────────────────────────────────────────

    modifier onlyOrganizer() {
        if (_msgSender() != organizer) revert NotOrganizer();
        _;
    }

    /// @dev Blocks any action once the election reached a terminal state.
    modifier notDecided() {
        if (cancelled) revert AlreadyCancelled();
        if (voided || resultsPublished) revert AlreadyDecided();
        _;
    }

    // ────────────────────────────────────────────────
    // Constructor
    // ────────────────────────────────────────────────

    constructor(
        address trustedForwarder,
        address _verifier,
        address _registry,
        address _organizer,
        Config memory cfg
    ) ERC2771Context(trustedForwarder) {
        if (
            _verifier == address(0) ||
            _registry == address(0) ||
            _organizer == address(0) ||
            cfg.numOptions == 0 ||
            cfg.enrollStart >= cfg.enrollEnd ||
            cfg.enrollEnd > cfg.voteStart ||
            cfg.voteStart >= cfg.voteEnd
        ) revert InvalidConfig();

        if (
            cfg.votingType == VotingType.SUPERMAJORITY_TWO_THIRDS ||
            cfg.votingType == VotingType.WITNESS_THRESHOLD
        ) {
            // Yes/No ballots only
            if (cfg.numOptions != 2) revert InvalidConfig();
        }
        if (cfg.votingType == VotingType.WITNESS_THRESHOLD && cfg.thresholdValue == 0) {
            revert InvalidConfig();
        }

        verifier = ISemaphoreVerifier(_verifier);
        registry = IPlatformRegistry(_registry);
        organizer = _organizer;

        name = cfg.name;
        votingType = cfg.votingType;
        thresholdValue = cfg.thresholdValue;
        numOptions = cfg.numOptions;
        enrollStart = cfg.enrollStart;
        enrollEnd = cfg.enrollEnd;
        voteStart = cfg.voteStart;
        voteEnd = cfg.voteEnd;
        scope = cfg.scope;
        paillierPublicKey = cfg.paillierPublicKey;
        metadataJson = cfg.metadataJson;
    }

    // ────────────────────────────────────────────────
    // Views
    // ────────────────────────────────────────────────

    function phase() public view returns (Phase) {
        if (cancelled) return Phase.CANCELLED;
        if (voided) return Phase.VOIDED;
        if (resultsPublished) return Phase.CLOSED;
        if (block.timestamp < enrollStart) return Phase.UPCOMING;
        if (block.timestamp < enrollEnd) return Phase.ENROLLING;
        // Only reachable when enrollEnd < voteStart (a separate window with a
        // gap); when enrollEnd == voteStart the previous branch already covered
        // everything up to voteStart, so this collapses away.
        if (block.timestamp < voteStart) return Phase.PENDING_VOTE;
        // Strict boundaries throughout: closeVotingEarly() sets
        // voteEnd = block.timestamp, so this must flip to TALLYING within the
        // same block/read — an inclusive `<=` here would leave the election
        // stuck showing ACTIVE until an unrelated later block happened to be
        // mined (invisible on a chain with continuous blocks, but permanent
        // on an idle local node).
        if (block.timestamp < voteEnd) return Phase.ACTIVE;
        return Phase.TALLYING;
    }

    function memberCount() external view returns (uint256) {
        return membersTree.size;
    }

    function merkleTreeRoot() external view returns (uint256) {
        return membersTree._root();
    }

    function merkleTreeDepth() external view returns (uint256) {
        return membersTree.depth;
    }

    function hasMember(uint256 identityCommitment) external view returns (bool) {
        return membersTree._has(identityCommitment);
    }

    function tally() external view returns (uint256[] memory) {
        return _tally;
    }

    // ────────────────────────────────────────────────
    // Enrollment
    // ────────────────────────────────────────────────

    /// @notice Enroll a platform-verified Semaphore identity commitment.
    function enroll(uint256 identityCommitment) external notDecided {
        if (block.timestamp < enrollStart || block.timestamp >= enrollEnd) {
            revert EnrollmentNotOpen();
        }
        if (!registry.verifiedMembers(identityCommitment)) revert NotPlatformVerified();
        if (membersTree._has(identityCommitment)) revert AlreadyEnrolled();

        uint256 index = membersTree.size;
        uint256 newRoot = membersTree._insert(identityCommitment);
        rootTimestamps[newRoot] = block.timestamp;

        emit MemberEnrolled(identityCommitment, index, newRoot);
    }

    // ────────────────────────────────────────────────
    // Voting
    // ────────────────────────────────────────────────

    /// @notice Cast (or re-cast) an encrypted vote with a Semaphore membership proof.
    /// @dev The ZK message binds the ciphertext to the voter's current nonce, so a
    /// coerced vote can always be silently replaced by a later one.
    /// @param voteCiphertext Paillier ciphertext of the encoded ballot (arbitrary length).
    function castVote(
        bytes calldata voteCiphertext,
        uint256 nullifier,
        uint256 merkleRoot,
        uint256 merkleDepth,
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC
    ) external notDecided {
        if (block.timestamp < voteStart || block.timestamp > voteEnd) revert VotingNotOpen();
        if (merkleDepth < MIN_TREE_DEPTH || merkleDepth > MAX_TREE_DEPTH) revert InvalidTreeDepth();

        // The proof must be built against the current tree root, or a recent root
        // still inside its validity window.
        if (merkleRoot != membersTree._root()) {
            uint256 createdAt = rootTimestamps[merkleRoot];
            if (createdAt == 0 || block.timestamp > createdAt + MERKLE_ROOT_VALIDITY) {
                revert UnknownOrExpiredRoot();
            }
        }

        uint256 currentNonce = nullifierNonces[nullifier];

        // The ZK message is the ciphertext+nonce digest. The prover passes the same
        // value as the Semaphore `message` input when generating the proof.
        uint256 message = uint256(keccak256(abi.encodePacked(voteCiphertext, currentNonce)));

        // Semaphore V4 public signals: [merkleTreeRoot, nullifier, hash(message), hash(scope)]
        // (hash-to-field exactly as Semaphore.sol does it).
        uint256[4] memory pubSignals = [merkleRoot, nullifier, _hashToField(message), _hashToField(scope)];
        if (!verifier.verifyProof(_pA, _pB, _pC, pubSignals, merkleDepth)) revert InvalidProof();

        emit VoteCast(nullifier, voteCiphertext, currentNonce, block.timestamp);

        nullifierNonces[nullifier] = currentNonce + 1;
        voteCount += 1;
    }

    /// @dev Semaphore's hash-to-field: keccak256 truncated to fit the SNARK scalar field.
    /// Mirrors `Semaphore.sol#_hash` so proofs generated with the official JS libraries verify.
    function _hashToField(uint256 value) private pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(value))) >> 8;
    }

    // ────────────────────────────────────────────────
    // Organizer lifecycle controls
    // ────────────────────────────────────────────────

    /// @notice Cancel the election before it ends. Terminal.
    function cancelElection() external onlyOrganizer notDecided {
        if (block.timestamp > voteEnd) revert WrongPhase();
        cancelled = true;
        emit ElectionCancelled(_msgSender());
    }

    /// @notice Close enrollment now and start the voting period immediately.
    function closeEnrollmentEarly() external onlyOrganizer notDecided {
        if (block.timestamp >= enrollEnd) revert WrongPhase();
        enrollEnd = block.timestamp;
        if (voteStart > block.timestamp) voteStart = block.timestamp;
        emit EnrollmentClosedEarly(enrollEnd, voteStart);
    }

    /// @notice End the voting period now, moving the election into tallying.
    function closeVotingEarly() external onlyOrganizer notDecided {
        if (block.timestamp < voteStart || block.timestamp > voteEnd) revert WrongPhase();
        voteEnd = block.timestamp;
        emit VotingClosedEarly(voteEnd);
    }

    /// @notice Void the election during tallying (e.g. privacy quorum not met). Terminal.
    function markVoided() external onlyOrganizer notDecided {
        if (block.timestamp <= voteEnd) revert VotingNotEnded();
        voided = true;
        emit ElectionVoided(_msgSender());
    }

    /// @notice Publish the decrypted tally and its IPFS audit trail. Terminal.
    /// @param ipfsCid CID of the auditable tally JSON pinned on IPFS.
    /// @param tallyResults Vote counts per option; the LAST entry is the blank vote.
    function publishResults(
        string calldata ipfsCid,
        uint256[] calldata tallyResults
    ) external onlyOrganizer notDecided {
        if (block.timestamp <= voteEnd) revert VotingNotEnded();
        if (tallyResults.length != numOptions + 1) revert InvalidTally();

        (Outcome computed, uint256 winIdx) = _computeOutcome(tallyResults);

        resultsCid = ipfsCid;
        _tally = tallyResults;
        outcome = computed;
        winnerIndex = winIdx;
        resultsPublished = true;

        emit ResultsPublished(ipfsCid, tallyResults, computed, winIdx);
    }

    // ────────────────────────────────────────────────
    // Internal
    // ────────────────────────────────────────────────

    /// @dev Determines the election outcome from the published tally, according to
    /// the configured voting type. Blank votes (last entry) count towards the total
    /// of votes cast but can never win.
    function _computeOutcome(
        uint256[] calldata tallyResults
    ) internal view returns (Outcome, uint256) {
        uint256 totalCast = 0;
        for (uint256 i = 0; i < tallyResults.length; i++) {
            totalCast += tallyResults[i];
        }

        if (votingType == VotingType.WITNESS_THRESHOLD) {
            // Option 0 is "Yes"
            return tallyResults[0] >= thresholdValue
                ? (Outcome.APPROVED, 0)
                : (Outcome.REJECTED, 0);
        }

        if (votingType == VotingType.SUPERMAJORITY_TWO_THIRDS) {
            if (totalCast == 0) return (Outcome.REJECTED, 0);
            return tallyResults[0] * 3 >= totalCast * 2
                ? (Outcome.APPROVED, 0)
                : (Outcome.REJECTED, 0);
        }

        // Plurality-style types: find the leading candidate (blank excluded).
        uint256 maxVotes = 0;
        uint256 maxIdx = 0;
        bool tie = false;
        for (uint256 i = 0; i < numOptions; i++) {
            if (tallyResults[i] > maxVotes) {
                maxVotes = tallyResults[i];
                maxIdx = i;
                tie = false;
            } else if (tallyResults[i] == maxVotes && maxVotes > 0) {
                tie = true;
            }
        }

        if (maxVotes == 0) return (Outcome.TIE, 0); // nobody voted for any candidate

        if (votingType == VotingType.ABSOLUTE_MAJORITY) {
            if (maxVotes * 2 <= totalCast) return (Outcome.THRESHOLD_NOT_MET, 0);
        }

        return tie ? (Outcome.TIE, 0) : (Outcome.WINNER, maxIdx);
    }
}
