// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.36;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ISemaphoreVerifier} from "@semaphore-protocol/contracts/interfaces/ISemaphoreVerifier.sol";
import {InternalLeanIMT, LeanIMTData} from "@zk-kit/lean-imt.sol/InternalLeanIMT.sol";

interface IPlatformRegistry {
    function verifiedMembers(uint256 identityCommitment) external view returns (bool);
    /// @dev The human (World ID nullifier) a commitment belongs to. Survives
    /// rotation, so a revoked commitment still resolves to its owner.
    function nullifierOf(uint256 identityCommitment) external view returns (uint256);
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
    // (enrollment closed, voting not yet open, only reachable when enrollEnd <
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
        address eligibilityAttester;   // address(0) = open election, no attribute policy
        bytes32 eligibilityPolicyHash; // keccak256 of the policy declared in metadataJson
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

    /**
     * Attribute eligibility (age, nationality) cannot be checked on chain. The
     * proof of a passport attribute is anchored in another network, and a
     * contract that went looking for it would break consensus for the same
     * reason it cannot resolve a DNS record. What a contract CAN check is a
     * signature, so the relay verifies the attribute proof off chain and signs
     * an attestation that this commitment may enroll.
     *
     * address(0) means the election has no attribute policy and enrollment stays
     * permissionless, exactly as it was before this existed.
     */
    address public immutable eligibilityAttester;

    /// @dev keccak256 of the canonical policy JSON published inside metadataJson.
    /// Enforcement lives off chain, so this is what makes the rules auditable:
    /// anyone can recompute it from the metadata and see which policy the
    /// organizer committed to before a single voter enrolled.
    bytes32 public immutable eligibilityPolicyHash;

    bytes32 private constant ENROLL_TYPEHASH =
        keccak256(
            "EnrollAttestation(uint256 identityCommitment,uint256 personhoodNullifier,uint256 deadline)"
        );

    /**
     * EIP-712 domain, built here rather than inherited from OpenZeppelin's
     * EIP712. That helper reaches ShortStrings and Bytes, which use `mcopy` and
     * therefore need a Cancun target, while this project compiles for paris.
     * Retargeting the whole codebase to get a domain separator would be a
     * deployment decision taken for a formatting convenience.
     */
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant DOMAIN_NAME = keccak256("VotainElection");
    bytes32 private constant DOMAIN_VERSION = keccak256("1");

    uint256 private immutable _cachedChainId;
    bytes32 private immutable _cachedDomainSeparator;

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

    /**
     * @dev Personhood nullifier => already used in THIS election.
     *
     * `enrolledHumans` deduplicates on the World ID nullifier, which means one
     * HUMAN only while sign-in demands an Orb. Where it does not, that nullifier
     * identifies an account, and somebody with two of them holds two.
     *
     * A gated election therefore carries a second nullifier, supplied by the
     * attester and derived from something a person has one of: a passport or
     * national ID read by the voter's own phone. It is scoped to this election,
     * so it says nothing about the same voter anywhere else, and it is stored
     * rather than merely checked because the relay has no durable memory and a
     * restart must not reopen a closed door.
     */
    mapping(uint256 => bool) public usedPersonhoodNullifiers;

    /// @dev World ID nullifier => already enrolled in THIS election.
    /// Keyed by human rather than by commitment so that rotating to a new
    /// identity cannot buy a second leaf, and therefore a second ballot.
    mapping(uint256 => bool) public enrolledHumans;

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

    /**
     * Name and metadata bounds, in BYTES rather than characters: Solidity cannot
     * count code points affordably. That makes this a coarse backstop against
     * the absurd (an empty or one-letter election, a metadata blob that would
     * cost a fortune to store), not the meaningful rule. The wizard applies the
     * character-aware minimum, where a three-byte floor is one CJK ideograph and
     * still passes here by design.
     */
    uint256 private constant MIN_NAME_BYTES = 3;
    uint256 private constant MAX_NAME_BYTES = 200;
    /// metadataJson holds the description, candidates and organizer name, and
    /// lives on chain in full. Unbounded, a pasted document would blow past the
    /// block gas limit after the organizer had filled in the entire wizard.
    uint256 private constant MAX_METADATA_BYTES = 16000;

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
    error AttestationRequired();
    error UnexpectedAttestation();
    error AttestationExpired();
    error BadAttestation();
    error MissingPersonhoodNullifier();
    error PersonhoodNullifierUsed();

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
            bytes(cfg.name).length < MIN_NAME_BYTES ||
            bytes(cfg.name).length > MAX_NAME_BYTES ||
            bytes(cfg.metadataJson).length > MAX_METADATA_BYTES ||
            cfg.enrollStart >= cfg.enrollEnd ||
            cfg.enrollEnd > cfg.voteStart ||
            cfg.voteStart >= cfg.voteEnd
        ) revert InvalidConfig();

        // A witness threshold counts confirmations of ONE proposition, so a
        // ballot with more than two options would have nothing to confirm.
        // A two-thirds supermajority is different: it is a threshold rule that
        // applies just as well to a field of candidates, so it is not capped.
        if (cfg.votingType == VotingType.WITNESS_THRESHOLD && cfg.numOptions != 2) {
            revert InvalidConfig();
        }
        if (cfg.votingType == VotingType.WITNESS_THRESHOLD && cfg.thresholdValue == 0) {
            revert InvalidConfig();
        }

        // An attester without a policy hash would gate enrollment on rules
        // nobody can read, and a policy hash without an attester would publish
        // rules nothing enforces. Both are misconfigurations that would only
        // surface once voters started failing to enroll.
        if ((cfg.eligibilityAttester == address(0)) != (cfg.eligibilityPolicyHash == bytes32(0))) {
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
        eligibilityAttester = cfg.eligibilityAttester;
        eligibilityPolicyHash = cfg.eligibilityPolicyHash;

        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
    }

    /// @dev Rebuilt when the chain id moved under us, so attestations signed for
    /// this election cannot be replayed on a fork of it.
    function _domainSeparator() internal view returns (bytes32) {
        return block.chainid == _cachedChainId
            ? _cachedDomainSeparator
            : _buildDomainSeparator();
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, DOMAIN_NAME, DOMAIN_VERSION, block.chainid, address(this))
        );
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
        // same block/read: an inclusive `<=` here would leave the election
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
    /// @dev Deduplication is per HUMAN, not per commitment. A voter who rotates
    /// to a new commitment after enrolling here would otherwise land a second
    /// leaf in the tree, and since each identity yields its own Semaphore
    /// nullifier the election would count both ballots without any way to link
    /// them. Resolving the commitment back to its World ID nullifier closes that.
    function enroll(uint256 identityCommitment) external notDecided {
        // Gated elections must come through enrollAttested. Without this branch
        // the attribute policy would be decorative: anyone refused by the relay
        // could call enroll() straight from their own wallet and land in the
        // tree anyway.
        if (eligibilityAttester != address(0)) revert AttestationRequired();
        _enroll(identityCommitment);
    }

    /// @notice Enroll into an election that declares an attribute policy, presenting
    /// the attester's signature over (identityCommitment, deadline).
    /// @dev Deliberately callable by anyone. The signature is the authorisation, so
    /// the voter can submit it themselves or hand it to the paymaster for a gasless
    /// enrollment, and neither path gives the relay a say in WHICH commitment enrolls.
    /// The deadline keeps a leaked attestation from being useful indefinitely; the
    /// per-human deduplication in _enroll is what stops it being replayed.
    function enrollAttested(
        uint256 identityCommitment,
        uint256 personhoodNullifier,
        uint256 deadline,
        bytes calldata signature
    ) external notDecided {
        if (eligibilityAttester == address(0)) revert UnexpectedAttestation();
        if (block.timestamp > deadline) revert AttestationExpired();

        // A gated election is one that decided its own membership rules, so it
        // must also know that each person passed them once. Refusing zero is
        // what stops a relay bug, or a relay under pressure, from quietly
        // enrolling everyone under "no nullifier available".
        if (personhoodNullifier == 0) revert MissingPersonhoodNullifier();
        if (usedPersonhoodNullifiers[personhoodNullifier]) revert PersonhoodNullifierUsed();

        bytes32 digest = enrollmentDigest(identityCommitment, personhoodNullifier, deadline);
        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || signer != eligibilityAttester) {
            revert BadAttestation();
        }

        // Recorded before enrolling, and recorded even though `_enroll` also
        // deduplicates: the two answer different questions. `enrolledHumans`
        // asks whether this ACCOUNT already joined; this asks whether this
        // PERSON did, and only the second survives a voter with two accounts.
        usedPersonhoodNullifiers[personhoodNullifier] = true;

        _enroll(identityCommitment);
    }

    /// @notice The EIP-712 digest an attester signs to authorise one enrollment.
    /// @dev Bound to this contract and this chain through the domain separator, so an
    /// attestation issued for one election cannot be replayed into another.
    function enrollmentDigest(
        uint256 identityCommitment,
        uint256 personhoodNullifier,
        uint256 deadline
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(ENROLL_TYPEHASH, identityCommitment, personhoodNullifier, deadline)
        );
        return keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
    }

    function _enroll(uint256 identityCommitment) internal {
        if (block.timestamp < enrollStart || block.timestamp >= enrollEnd) {
            revert EnrollmentNotOpen();
        }
        if (!registry.verifiedMembers(identityCommitment)) revert NotPlatformVerified();
        if (membersTree._has(identityCommitment)) revert AlreadyEnrolled();

        uint256 human = registry.nullifierOf(identityCommitment);
        if (human == 0) revert NotPlatformVerified();
        if (enrolledHumans[human]) revert AlreadyEnrolled();

        uint256 index = membersTree.size;
        uint256 newRoot = membersTree._insert(identityCommitment);
        rootTimestamps[newRoot] = block.timestamp;
        enrolledHumans[human] = true;

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
            if (totalCast == 0) {
                return numOptions == 2
                    ? (Outcome.REJECTED, 0)
                    : (Outcome.THRESHOLD_NOT_MET, 0);
            }

            // Two options is a proposition: index 0 IS the motion, so anything
            // short of two thirds for it is a rejection, whichever way the rest
            // of the ballots fell.
            if (numOptions == 2) {
                return tallyResults[0] * 3 >= totalCast * 2
                    ? (Outcome.APPROVED, 0)
                    : (Outcome.REJECTED, 0);
            }

            // More options is a qualified-majority election: whoever leads must
            // still clear two thirds, otherwise nobody is elected. No tie check
            // is needed above the threshold: two candidates each holding two
            // thirds would need four thirds of the ballots between them.
            uint256 leadVotes = 0;
            uint256 leadIdx = 0;
            for (uint256 i = 0; i < numOptions; i++) {
                if (tallyResults[i] > leadVotes) {
                    leadVotes = tallyResults[i];
                    leadIdx = i;
                }
            }
            return leadVotes * 3 >= totalCast * 2
                ? (Outcome.APPROVED, leadIdx)
                : (Outcome.THRESHOLD_NOT_MET, 0);
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
