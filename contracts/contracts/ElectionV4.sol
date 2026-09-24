// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
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
///
/// No meta-transaction forwarder, and deliberately: voters reach this contract
/// through ElectionPaymaster and nothing they call reads the sender, while the
/// organizer signs their own transactions. A trusted forwarder would only add
/// a party able to speak as the organizer.
contract ElectionV4 {
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
    /**
     * @notice How distinct a human the election insists each voter is.
     *
     * DEVICE is a World ID account and nothing more: one account, one vote, and
     * accounts are not people. DOCUMENT requires a passport or national ID
     * proved on the voter's own phone, whose per-election nullifier this
     * contract records so one document cannot enroll twice. ORB requires both.
     *
     * On chain and not only inside the hashed policy, because the constructor
     * enforces a rule with it that the policy alone could never express here:
     * this contract cannot parse JSON, but it can refuse a configuration whose
     * level and attester disagree.
     */
    enum PersonhoodLevel { DEVICE, DOCUMENT, ORB }

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
        PersonhoodLevel personhood;    // how distinct a human each voter must prove to be
        uint256 privacyQuorum;         // fewest distinct voters a publishable result may rest on
        bool fixedSchedule;            // organizer gives up the power to move any deadline
        bool cancellable;              // whether the organizer may call it off at all
    }

    // ────────────────────────────────────────────────
    // Constants / immutables
    // ────────────────────────────────────────────────

    /// @dev Old merkle roots stay valid this long after being superseded, so proofs
    /// generated just before another member enrolls do not become unusable.
    uint256 public constant MERKLE_ROOT_VALIDITY = 1 hours;

    uint256 public constant MIN_TREE_DEPTH = 1;
    uint256 public constant MAX_TREE_DEPTH = 32;

    /**
     * @dev Ceiling on ballot options, and it is the ENCODING that sets it.
     *
     * A ballot for option i is the Paillier plaintext B^i with B = 10^12, so a
     * tally packs one counter per option into a single plaintext, base B. That
     * plaintext must stay below the 2048-bit modulus, which is about 616
     * decimal digits: 12 digits per counter leaves room for 51 of them, and the
     * blank vote takes one. Above that the top counter wraps and the decrypted
     * tally is silently wrong, so the bound belongs here, where an election is
     * refused before anyone votes in it, rather than in the client that happens
     * to do the arithmetic.
     */
    uint256 public constant MAX_OPTIONS = 50;

    /**
     * @dev Ceiling on one ballot's size in bytes.
     *
     * A Paillier ciphertext lives modulo n², so under the platform's 2048-bit
     * keys it is at most 4096 bits: 512 bytes. Anything longer cannot be a
     * ballot, and accepting it would let one voter make every relayed ballot
     * as expensive as the gas cap allows, paid from the organizer's tank.
     */
    uint256 public constant MAX_BALLOT_BYTES = 512;

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

    /**
     * @notice The platform's key, which authorises PRIVATE enrolment.
     *
     * WHAT IT IS FOR. Enrolling used to put the voter's one platform-wide
     * identity commitment into this election's tree, and the registry names
     * publicly which human each commitment belongs to. Anyone could therefore
     * read every election a given person had joined, straight off the chain.
     * The ballot was anonymous; the participation was not.
     *
     * With this set, a voter enrols a commitment DERIVED FOR THIS ELECTION,
     * which appears nowhere else, and the platform signs an attestation that
     * the commitment belongs to a verified human who has not already enrolled
     * here. The "has not already" is carried by `humanTag`, a value the
     * platform derives from the human and this election's address, so it is
     * stable here and unrecognisable anywhere else.
     *
     * WHAT IT COSTS. This key can enrol commitments that no registry entry
     * vouches for, which the registry check used to prevent. That is not new
     * power: the platform owns the registry, so it could always register a
     * commitment of its own making and enrol that. What changes is that the
     * roll no longer proves to a third party which humans are on it, and the
     * platform is the party that knows.
     *
     * address(0) is an election deployed before this existed, which keeps the
     * old public paths. The two are mutually exclusive on purpose: a human
     * able to use both would hold two leaves and two votes.
     */
    address public immutable platformAttester;

    /// @dev keccak256 of the canonical policy JSON published inside metadataJson.
    /// Enforcement lives off chain, so this is what makes the rules auditable:
    /// anyone can recompute it from the metadata and see which policy the
    /// organizer committed to before a single voter enrolled.
    bytes32 public immutable eligibilityPolicyHash;

    /// @notice The personhood bar this election sets, readable without parsing
    /// the metadata or trusting anything that did.
    PersonhoodLevel public immutable personhood;

    /**
     * @notice Fewest distinct voters a result may be published on.
     *
     * A tally over three ballots that comes out 3-0 tells everyone how all
     * three voted, whoever holds the key. This is the floor below which the
     * organizer's only remaining move is to void the election.
     *
     * It bounds PUBLICATION, not knowledge. The organizer holds the decryption
     * key and the ciphertexts are public, so they can always compute the result
     * privately; no contract can prevent that. Only threshold decryption, where
     * no single party can decrypt alone, would.
     */
    uint256 public immutable privacyQuorum;

    bytes32 private constant ENROLL_TYPEHASH =
        keccak256(
            "EnrollAttestation(uint256 identityCommitment,uint256 personhoodNullifier,uint256 deadline)"
        );

    /// @dev The private path's attestation. `humanTag` takes the place the
    /// personhood nullifier held, and the difference is the whole point: the
    /// nullifier is the same number in every election, the tag is not.
    bytes32 private constant PRIVATE_ENROLL_TYPEHASH =
        keccak256(
            "PrivateEnrollment(uint256 identityCommitment,uint256 humanTag,uint256 documentTag,uint256 deadline)"
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
    /**
     * @notice The organizer gave up the power to move any deadline. Immutable.
     *
     * WHAT IT IS FOR. `closeEnrollmentEarly` and `closeVotingEarly` are ordinary
     * conveniences until you notice what the organizer can see while using
     * them: `memberCount` and `distinctVoters` are public and rise in real time.
     * So an organizer can watch the electorate assemble and cut enrolment off at
     * the moment the roll suits them, or watch turnout and end the vote at the
     * moment the result does. Neither leaves a trace that says what it was for,
     * and neither is visible to a voter deciding whether to take part.
     *
     * Setting this at deployment turns that into a promise the contract keeps
     * instead of a promise the organizer makes: the deadlines published when the
     * election was created are the deadlines it will run to.
     *
     * CANCELLING IS STILL ALLOWED, and deliberately. Cancelling produces no
     * result, so it cannot shape one; it is terminal, public, and the one honest
     * way out of an election that should not go ahead. An organizer who could
     * neither adjust nor stop would be forced to carry a broken vote to its end,
     * which serves nobody.
     */
    bool public immutable fixedSchedule;
    /**
     * @notice Whether the organizer may call this election off. Immutable.
     *
     * A SEPARATE PROMISE FROM THE SCHEDULE, and separate on purpose. "The dates
     * will not move" and "this will not be called off" are two different things
     * to tell a voter, and an election can reasonably make either without the
     * other.
     *
     * Cancelling is a weaker lever than closing early, since it publishes no
     * result and so cannot shape one, but it is still a veto: an organizer
     * watching the turnout rise against them can deny the outcome by ending the
     * election instead of losing it.
     *
     * Kept apart from `fixedSchedule` rather than folded into it, because
     * coupling them would price the cheaper promise out of reach. An organizer
     * who wants fixed dates would have to surrender their only way out of an
     * election that should not go ahead, and most would then fix nothing at all:
     * the more valuable promise lost in order to protect the lesser one.
     *
     * With both given up, an election with a mistake in its dates runs to the
     * end regardless. That is the point, and the wizard says so before it is
     * signed.
     */
    bool public immutable cancellable;
    /**
     * @notice When this election was deployed, as a block timestamp. Immutable.
     *
     * NOT THE SAME AS ANY DATE IN THE SCHEDULE, which is why it is worth its own
     * slot. An election announced today for next March and one deployed last
     * March that opens tomorrow are a year apart in age and adjacent in every
     * date the interface shows, and only this tells them apart.
     *
     * It is also the one date the organizer did not choose. Every other
     * timestamp here came out of the wizard and can be set to anything the
     * validation allows, including dates in the past; this one is written by
     * the chain at deployment and no one can offer a different answer later.
     * That makes it the honest reference for "how long has this been around",
     * which is what someone deciding whether an election is a hastily made
     * imitation of another actually wants to know.
     *
     * An immutable and not a storage slot: it is written once at construction
     * and read many times, so it lives in the code rather than costing a SLOAD
     * on every read.
     */
    uint256 public immutable createdAt;
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

    /**
     * @dev How many distinct nullifiers have voted at least once.
     *
     * Not the same number as `voteCount`: re-voting is the coercion defence, so
     * one person can appear in that total many times while the tally counts
     * them once. This is the figure a published result has to agree with, and
     * the figure the privacy quorum is measured against.
     */
    uint256 public distinctVoters;

    string public resultsCid;
    uint256[] internal _tally;
    Outcome public outcome;
    uint256 public winnerIndex; // meaningful only when outcome == WINNER

    // ────────────────────────────────────────────────
    // Events / errors
    // ────────────────────────────────────────────────

    event MemberEnrolled(uint256 indexed identityCommitment, uint256 index, uint256 merkleTreeRoot);
    event VoteCast(uint256 indexed nullifier, bytes voteCiphertext, uint256 nonce, uint256 timestamp);
    event EnrollmentOpenedEarly(uint256 newEnrollStart);
    event VotingOpenedEarly(uint256 newVoteStart);
    event EnrollmentClosedEarly(uint256 newEnrollEnd, uint256 newVoteStart);
    event VotingClosedEarly(uint256 newVoteEnd);
    event ElectionCancelled(address indexed by);
    event ElectionVoided(address indexed by);
    event ResultsPublished(string ipfsCid, uint256[] tally, Outcome outcome, uint256 winnerIndex);
    /**
     * @notice The evidence that the published counts are what the ballots hold.
     *
     * UTF-8 JSON, produced and checked by `tallyProof.ts`: the randomness that
     * opens the product of every valid final ballot to exactly the published
     * counts, and an opening of each ballot excluded as invalid. Anyone can
     * check it against the ciphertexts in `VoteCast` without any key. Emitted
     * rather than stored, because it is read by auditors and never by this
     * contract.
     */
    event TallyProofPublished(uint256 invalidBallots, bytes proof);

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
    /// @dev The organizer gave up the power to move deadlines when this was deployed.
    error ScheduleIsFixed();
    /// @dev The organizer gave up the power to call this election off.
    error NotCancellable();
    error AttestationRequired();
    error UnexpectedAttestation();
    error AttestationExpired();
    error BadAttestation();
    error MissingPersonhoodNullifier();
    /// @dev The public enrolment paths on an election that enrols privately.
    error PrivateEnrollmentRequired();
    /// @dev The private path on an election deployed before it existed.
    error PrivateEnrollmentUnavailable();
    /// @dev A tag of zero would let one attestation stand for every human.
    error MissingHumanTag();
    error PersonhoodNullifierUsed();
    error TooManyOptions();
    error PrivacyQuorumNotMet();
    /// @dev An empty ballot, or one longer than any Paillier ciphertext can be.
    error InvalidBallot();
    /// @dev A non-cancellable election whose result can be published cannot be voided.
    error ResultPublishable();
    /// @dev A gated private enrolment arrived without the document tag.
    error MissingDocumentTag();
    /// @dev A document tag on an election with no document requirement.
    error UnexpectedDocumentTag();
    /// @dev A result was published without the proof that makes it checkable.
    error MissingTallyProof();

    // ────────────────────────────────────────────────
    // Modifiers
    // ────────────────────────────────────────────────

    modifier onlyOrganizer() {
        if (msg.sender != organizer) revert NotOrganizer();
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
        address _verifier,
        address _registry,
        address _platformAttester,
        address _organizer,
        Config memory cfg
    ) {
        if (
            _verifier == address(0) ||
            _registry == address(0) ||
            _organizer == address(0) ||
            cfg.numOptions == 0 ||
            cfg.numOptions > MAX_OPTIONS ||
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

        // The level and the attester have to agree, and this is the one place
        // that can say so.
        //
        // Anything above DEVICE is proved by a document, and a document proof
        // reaches this contract only as an attestation, so it needs an attester.
        // DEVICE is the reverse: there is no document, therefore no attribute
        // about the holder of one can be checked, therefore an attester would be
        // gating enrollment on rules that can never be satisfied. Age and
        // nationality restrictions are exactly those rules, which is why a
        // DEVICE election cannot carry them: not by convention in the wizard,
        // but because this constructor refuses to deploy it.
        if ((cfg.personhood == PersonhoodLevel.DEVICE) != (cfg.eligibilityAttester == address(0))) {
            revert InvalidConfig();
        }

        verifier = ISemaphoreVerifier(_verifier);
        registry = IPlatformRegistry(_registry);
        platformAttester = _platformAttester;
        organizer = _organizer;

        name = cfg.name;
        votingType = cfg.votingType;
        thresholdValue = cfg.thresholdValue;
        numOptions = cfg.numOptions;
        privacyQuorum = cfg.privacyQuorum;
        fixedSchedule = cfg.fixedSchedule;
        cancellable = cfg.cancellable;
        enrollStart = cfg.enrollStart;
        enrollEnd = cfg.enrollEnd;
        voteStart = cfg.voteStart;
        voteEnd = cfg.voteEnd;
        scope = cfg.scope;
        paillierPublicKey = cfg.paillierPublicKey;
        metadataJson = cfg.metadataJson;
        eligibilityAttester = cfg.eligibilityAttester;
        eligibilityPolicyHash = cfg.eligibilityPolicyHash;
        personhood = cfg.personhood;

        // The chain's own answer, never the caller's. A `createdAt` taken from
        // the config would be one more field an organizer could set to whatever
        // made their election look established.
        createdAt = block.timestamp;

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
        // An election that enrols privately has exactly one door. Leaving this
        // one open would let the same human hold two leaves, one under their
        // platform commitment and one under the commitment derived for here,
        // and nothing on chain could tell that those two are one person.
        if (platformAttester != address(0)) revert PrivateEnrollmentRequired();
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
        if (platformAttester != address(0)) revert PrivateEnrollmentRequired();
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

    /**
     * @notice Enrol a commitment that exists only for this election.
     *
     * WHAT THE CALLER BRINGS. A commitment derived from their own secret and
     * this election's address, so it is theirs, it is reproducible from their
     * recovery phrase, and it matches nothing they use elsewhere. A `humanTag`
     * and the platform's signature over both. When the organizer named an
     * attribute attester as well, that attester signs the same digest, so a
     * third-party gatekeeper keeps exactly the say it had before.
     *
     * WHAT THE CHAIN LEARNS. That some verified human enrolled here, and that
     * they had not already. Not which human, and not what else they joined.
     *
     * @dev Callable by anyone, like the attested path: the signature is the
     * authorisation, so a voter can pay their own gas or hand it to the relay.
     * There is no registry lookup, because a per-election commitment is by
     * definition not in the registry; the signature carries what the lookup
     * used to establish.
     */
    function enrollPrivate(
        uint256 identityCommitment,
        uint256 humanTag,
        uint256 documentTag,
        uint256 deadline,
        bytes calldata platformSignature,
        bytes calldata eligibilitySignature
    ) external notDecided {
        if (platformAttester == address(0)) revert PrivateEnrollmentUnavailable();
        if (block.timestamp > deadline) revert AttestationExpired();
        if (humanTag == 0) revert MissingHumanTag();

        /**
         * ONE DOCUMENT, ONE LEAF, which `humanTag` alone cannot promise. The
         * tag is derived from the World ID account, and below Orb an account
         * is not a person: somebody holding several could pass the same
         * passport check once per account and enrol once per account. A gated
         * election therefore carries a second tag derived from the document
         * the voter proved, and refuses it the second time, exactly as the
         * public path refuses a reused personhood nullifier.
         */
        if (eligibilityAttester != address(0)) {
            if (documentTag == 0) revert MissingDocumentTag();
            if (usedPersonhoodNullifiers[documentTag]) revert PersonhoodNullifierUsed();
        } else if (documentTag != 0) {
            revert UnexpectedDocumentTag();
        }

        bytes32 digest = privateEnrollmentDigest(identityCommitment, humanTag, documentTag, deadline);
        _requireSignature(digest, platformSignature, platformAttester);

        // The organizer's own gatekeeper, where they named one. It signs the
        // same digest rather than one of its own: two questions are being
        // answered about one enrolment, and making them two structures would
        // only add a second thing to keep in step.
        if (eligibilityAttester != address(0)) {
            _requireSignature(digest, eligibilitySignature, eligibilityAttester);
            usedPersonhoodNullifiers[documentTag] = true;
        }

        _insertMember(identityCommitment, humanTag);
    }

    /// @notice The EIP-712 digest the platform signs to authorise one private enrolment.
    function privateEnrollmentDigest(
        uint256 identityCommitment,
        uint256 humanTag,
        uint256 documentTag,
        uint256 deadline
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(PRIVATE_ENROLL_TYPEHASH, identityCommitment, humanTag, documentTag, deadline)
        );
        return keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
    }

    function _requireSignature(bytes32 digest, bytes calldata signature, address expected) private pure {
        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || signer != expected) revert BadAttestation();
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
        _requireEnrollmentOpen();
        if (!registry.verifiedMembers(identityCommitment)) revert NotPlatformVerified();

        uint256 human = registry.nullifierOf(identityCommitment);
        if (human == 0) revert NotPlatformVerified();

        _insertMember(identityCommitment, human);
    }

    /// @dev Checked before anything else either path looks at, so a voter who
    /// arrived early is told that rather than being told they are not a member.
    function _requireEnrollmentOpen() private view {
        if (block.timestamp < enrollStart || block.timestamp >= enrollEnd) {
            revert EnrollmentNotOpen();
        }
    }

    /**
     * @dev Puts one leaf in the tree, once per human.
     *
     * `humanKey` is whatever identifies the person for THIS election, and the
     * two paths mean different things by it. The public one passes the World ID
     * nullifier, which is the same number everywhere and is why that path is
     * linkable. The private one passes a tag the platform derived from the
     * human and this address, which answers "again?" here and says nothing
     * anywhere else. Either way this is the only place a leaf is added, so the
     * window check and the two duplicate checks cannot drift apart.
     */
    function _insertMember(uint256 identityCommitment, uint256 humanKey) private {
        _requireEnrollmentOpen();
        if (membersTree._has(identityCommitment)) revert AlreadyEnrolled();
        if (enrolledHumans[humanKey]) revert AlreadyEnrolled();

        uint256 index = membersTree.size;
        uint256 newRoot = membersTree._insert(identityCommitment);
        rootTimestamps[newRoot] = block.timestamp;
        enrolledHumans[humanKey] = true;

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
        // `voteEnd` is exclusive, matching `phase()`: the second it reads
        // TALLYING, no ballot lands.
        if (block.timestamp < voteStart || block.timestamp >= voteEnd) revert VotingNotOpen();
        if (voteCiphertext.length == 0 || voteCiphertext.length > MAX_BALLOT_BYTES) {
            revert InvalidBallot();
        }
        if (merkleDepth < MIN_TREE_DEPTH || merkleDepth > MAX_TREE_DEPTH) revert InvalidTreeDepth();

        // The proof must be built against the current tree root, or a recent root
        // still inside its validity window.
        if (merkleRoot != membersTree._root()) {
            uint256 rootCreatedAt = rootTimestamps[merkleRoot];
            if (rootCreatedAt == 0 || block.timestamp > rootCreatedAt + MERKLE_ROOT_VALIDITY) {
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

        // Nonce zero is this nullifier's first ballot, so this is where a
        // PERSON joins the count. Every later ballot from them replaces it.
        if (currentNonce == 0) distinctVoters += 1;

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
        if (!cancellable) revert NotCancellable();
        if (block.timestamp >= voteEnd) revert WrongPhase();
        cancelled = true;
        emit ElectionCancelled(msg.sender);
    }

    /**
     * @notice Open enrollment now, ahead of the date it was announced for.
     *
     * The counterpart of closing early, and the safer of the two: closing takes
     * away a chance to take part, while opening only adds one. Nobody is
     * enrolled yet, the closing date does not move, and a voter who was told
     * enrollment opens on Friday is not harmed by finding it open on Thursday.
     *
     * Without it an organizer who mistyped a date, or who is simply ready, had
     * to wait it out or cancel and deploy again.
     */
    function openEnrollmentEarly() external onlyOrganizer notDecided {
        if (fixedSchedule) revert ScheduleIsFixed();
        if (block.timestamp >= enrollStart) revert WrongPhase();
        enrollStart = block.timestamp;
        emit EnrollmentOpenedEarly(enrollStart);
    }

    /**
     * @notice Close enrollment now and start the voting period immediately.
     *
     * REFUSED BEFORE ENROLLMENT HAS OPENED, which it used to allow. From
     * UPCOMING this set `enrollEnd` to now while `enrollStart` stayed in the
     * future, leaving `enrollStart > enrollEnd`: `phase()` reads the start
     * first, so the election was pinned in UPCOMING for good, with an enrollment
     * window that had closed before it opened and no way to reach a vote. An
     * organizer who wants to stop an election that has not started has
     * `cancelElection`, which says so and is terminal on purpose.
     */
    function closeEnrollmentEarly() external onlyOrganizer notDecided {
        if (fixedSchedule) revert ScheduleIsFixed();
        if (block.timestamp < enrollStart) revert WrongPhase();
        if (block.timestamp >= enrollEnd) revert WrongPhase();
        enrollEnd = block.timestamp;
        if (voteStart > block.timestamp) voteStart = block.timestamp;
        emit EnrollmentClosedEarly(enrollEnd, voteStart);
    }

    /**
     * @notice Open voting now, from the gap between the two windows.
     *
     * THE ONE BOUNDARY NOTHING COULD MOVE. `closeEnrollmentEarly` pulls
     * `voteStart` forward with it, but only while enrolment is still open: once
     * an election is sitting in PENDING_VOTE, with enrolment closed and voting
     * not yet due, every early function refused it and the organizer could only
     * wait. An election offering "dates the organizer can shorten" could not
     * shorten that one, which made the label a promise the contract did not
     * keep.
     *
     * The safe direction, like opening enrolment: voting starts sooner, the
     * close does not move, and nobody loses a chance to take part.
     */
    function openVotingEarly() external onlyOrganizer notDecided {
        if (fixedSchedule) revert ScheduleIsFixed();
        if (block.timestamp < enrollEnd) revert WrongPhase();
        if (block.timestamp >= voteStart) revert WrongPhase();
        voteStart = block.timestamp;
        emit VotingOpenedEarly(voteStart);
    }

    /// @notice End the voting period now, moving the election into tallying.
    function closeVotingEarly() external onlyOrganizer notDecided {
        if (fixedSchedule) revert ScheduleIsFixed();
        if (block.timestamp < voteStart || block.timestamp >= voteEnd) revert WrongPhase();
        voteEnd = block.timestamp;
        emit VotingClosedEarly(voteEnd);
    }

    /**
     * @notice Void the election during tallying. Terminal.
     *
     * Always open below the privacy quorum, where no result may be published.
     * Above it, only on an election that kept the power to be called off: the
     * organizer holds the key and can read the result before deciding, so
     * voiding a publishable result is a veto, and an election that promised no
     * veto (`cancellable == false`) must not keep this one.
     */
    function markVoided() external onlyOrganizer notDecided {
        if (block.timestamp < voteEnd) revert VotingNotEnded();
        if (!cancellable && distinctVoters >= privacyQuorum) revert ResultPublishable();
        voided = true;
        emit ElectionVoided(msg.sender);
    }

    /**
     * @notice Publish the decrypted tally with the proof that it is correct. Terminal.
     * @param ipfsCid CID of the auditable tally JSON pinned on IPFS, or empty.
     * @param tallyResults Vote counts per option; the LAST entry is the blank vote.
     * @param invalidBallots Final ballots excluded because they encrypt no valid
     * choice. Each one is opened in `tallyProof`, so excluding an honest ballot
     * is detectable by anyone.
     * @param tallyProof The decryption proof, see `TallyProofPublished`.
     *
     * THE COUNTERS MUST ACCOUNT FOR EVERY VOTER. Each person's surviving ballot
     * either adds exactly one to exactly one counter or is excluded as
     * invalid, so the two together equal `distinctVoters`. That used to be
     * left unchecked, because a single malformed ballot made any honest tally
     * miss the total and the rule would have let one voter block publication.
     * Excluding such ballots openly removes that power, so the check is now
     * safe and turns an invented or dropped ballot into a revert.
     *
     * What this contract cannot afford to check is the proof itself: it needs
     * every ciphertext and 4096-bit arithmetic. It requires one to be present
     * and publishes it, and every reader of the result verifies it.
     */
    function publishResults(
        string calldata ipfsCid,
        uint256[] calldata tallyResults,
        uint256 invalidBallots,
        bytes calldata tallyProof
    ) external onlyOrganizer notDecided {
        if (block.timestamp < voteEnd) revert VotingNotEnded();
        if (tallyResults.length != numOptions + 1) revert InvalidTally();
        if (tallyProof.length == 0) revert MissingTallyProof();

        // Below the quorum there is no publishable result, only `markVoided`.
        // Enforced here rather than in the client that draws the button,
        // because a rule a wallet can step around is not a rule.
        if (distinctVoters < privacyQuorum) revert PrivacyQuorumNotMet();

        uint256 counted = invalidBallots;
        for (uint256 i = 0; i < tallyResults.length; i++) {
            counted += tallyResults[i];
        }
        if (counted != distinctVoters) revert InvalidTally();

        (Outcome computed, uint256 winIdx) = _computeOutcome(tallyResults);

        resultsCid = ipfsCid;
        _tally = tallyResults;
        outcome = computed;
        winnerIndex = winIdx;
        resultsPublished = true;

        emit ResultsPublished(ipfsCid, tallyResults, computed, winIdx);
        emit TallyProofPublished(invalidBallots, tallyProof);
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
