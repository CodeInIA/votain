// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {ElectionV4} from "./ElectionV4.sol";

/// @title ElectionPaymaster
/// @notice Gas tank and relay hub. Organizers deposit POL for their own
/// elections; anyone may relay a voter's enrollment or ballot through here and
/// is reimbursed, in the same transaction, out of that election's organizer's
/// balance.
///
/// Why relay instead of ERC-4337:
///
///  1. **Anonymity.** With account abstraction each voter gets their own smart
///     account, and that address is the public `sender` of both their `enroll`
///     and their `castVote`. Anyone could link commitment to nullifier and,
///     through PlatformRegistry, back to the human, which defeats the Semaphore
///     proof entirely. Routing every voter through this one contract makes the
///     caller identical for all of them, so the transport layer leaks nothing.
///  2. **Multi-tenant sponsorship.** Hosted paymasters fund gas per project,
///     billed to the project owner. There is no path for a third party to fund
///     a per-organizer bucket, which is exactly what an election platform needs.
///
/// Neither `ElectionV4.enroll` nor `ElectionV4.castVote` reads `msg.sender`:
/// enrollment is gated on the registry and voting on a zero-knowledge proof.
/// That is what makes relaying safe.
contract ElectionPaymaster {
    /// @dev Fixed gas outside the metered region: the 21000 transaction base plus
    /// the reimbursement transfer and event. Calldata is charged separately per
    /// byte, because `relayVote` carries a Paillier ciphertext and a Groth16
    /// proof while `relayEnroll` carries 52 bytes: one flat constant for both
    /// would badly overcharge the cheap call and undercharge the expensive one.
    uint256 public constant DEFAULT_BASE_OVERHEAD = 32_000;
    /// @dev Price charged per byte of the ABI-encoded arguments.
    uint256 public constant DEFAULT_CALLDATA_GAS = 16;

    /// @dev Exact ABI-encoded sizes, used INSTEAD of `msg.data.length`.
    /// Solidity's decoder ignores calldata past the encoded arguments while
    /// `msg.data.length` still counts it, so billing from `msg.data.length` would
    /// let a caller append megabytes of zero bytes: which cost them 4 gas each
    /// and would be reimbursed at 16: and walk off with the difference out of
    /// the organizer's tank. Billing a size derived from the arguments themselves
    /// makes padding free to send and worth nothing.
    /// relayEnroll: selector + address + uint256.
    uint256 private constant ENROLL_CALLDATA = 4 + 32 + 32;
    /// relayEnrollAttested head: selector + address + 3 uint256 + bytes offset +
    /// length word, then the padded signature added at call time.
    uint256 private constant ATTESTED_ENROLL_CALLDATA_HEAD = 4 + 32 + (32 * 3) + 32 + 32;
    /// relayVote head: selector + address + bytes offset + 3 uint256 + pA + pB + pC,
    /// then the bytes tail (length word + padded contents) added at call time.
    uint256 private constant VOTE_CALLDATA_HEAD = 4 + 32 + 32 + (32 * 3) + 64 + 128 + 64 + 32;

    address public owner;
    address public pendingOwner;
    /// @dev Allowed to bind an election to its organizer (set to ElectionFactory).
    address public factory;

    /// @dev Upper bound on the gas price a relayer may be reimbursed at, so a
    /// relayer cannot drain a tank by submitting at an inflated price.
    uint256 public maxGasPrice;
    uint256 public baseOverheadGas;
    uint256 public calldataGasPerByte;
    /// @dev Hard ceiling on the gas any single relay may charge a tank. Defence
    /// in depth: even if the accounting above were wrong again, one call can
    /// never move more than a bounded slice of an organizer's balance.
    uint256 public maxRelayGas;

    /// @dev organizer => sponsored gas that is free to move (wei)
    mapping(address => uint256) public gasBalance;
    /**
     * @dev election => gas committed to THAT election and nothing else.
     *
     * The tank used to be one pot per organizer, which made two promises
     * impossible to keep at once. First, an organizer could call `withdraw`
     * mid-election and empty it: the relayer can no longer be reimbursed, and
     * since voters hold no wallet by design, voting simply stops. Turnout is
     * public while an election runs, so that is a shutdown switch available to
     * whoever dislikes how it is going. Second, a balance shared between
     * elections cannot be reported honestly to a voter, because two of them
     * would each claim the same money and "enough for 300 votes" would be a
     * false statement made twice.
     *
     * Reserved gas cannot be withdrawn. It is spent by this election's own
     * relays and returns to the organizer once the election can no longer take
     * a vote.
     */
    mapping(address => uint256) public reservedFor;
    /// @dev election => the organizer whose tank pays for it
    mapping(address => address) public organizerOf;

    uint256 private _entered;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    /// @dev No `from`: a tank is only ever filled by its owner, so the two were
    /// always the same address and one of them was decoration.
    event Deposited(address indexed organizer, uint256 amount);
    event ElectionFunded(address indexed election, address indexed from, uint256 amount);
    event ReserveReleased(address indexed election, address indexed organizer, uint256 amount);
    event Withdrawn(address indexed organizer, uint256 amount);
    event VoteSponsored(address indexed organizer, uint256 cost, address indexed chargedBy);
    event ElectionRegistered(address indexed election, address indexed organizer);
    event FactoryChanged(address indexed factory);
    event RelayParamsChanged(
        uint256 maxGasPrice,
        uint256 baseOverheadGas,
        uint256 calldataGasPerByte,
        uint256 maxRelayGas
    );

    error NotOwner();
    error NotPendingOwner();
    error NotFactory();
    error InsufficientBalance();
    error WithdrawFailed();
    error ReimbursementFailed();
    error UnknownElection();
    error AlreadyRegistered();
    error ElectionStillOpen();
    error NothingReserved();
    /// @dev Only the organizer an election was registered to may spend their balance on it.
    error NotElectionOrganizer();
    error ZeroAddress();
    error Reentrancy();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor() {
        owner = msg.sender;
        // Polygon's enforced floor sits at 25 to 30 gwei. This leaves headroom for
        // congestion without letting a careless relayer burn a tank several times
        // faster than necessary.
        maxGasPrice = 50 gwei;
        baseOverheadGas = DEFAULT_BASE_OVERHEAD;
        calldataGasPerByte = DEFAULT_CALLDATA_GAS;
        maxRelayGas = 2_000_000; // a ballot costs ~400k; leaves ample headroom
    }

    // ────────────────────────────────────────────────
    // Configuration
    // ────────────────────────────────────────────────

    function setFactory(address _factory) external onlyOwner {
        if (_factory == address(0)) revert ZeroAddress();
        factory = _factory;
        emit FactoryChanged(_factory);
    }

    function setRelayParams(
        uint256 _maxGasPrice,
        uint256 _baseOverheadGas,
        uint256 _calldataGasPerByte,
        uint256 _maxRelayGas
    ) external onlyOwner {
        maxGasPrice = _maxGasPrice;
        baseOverheadGas = _baseOverheadGas;
        calldataGasPerByte = _calldataGasPerByte;
        maxRelayGas = _maxRelayGas;
        emit RelayParamsChanged(_maxGasPrice, _baseOverheadGas, _calldataGasPerByte, _maxRelayGas);
    }

    /// @notice Binds a new election to the organizer whose tank funds it.
    function registerElection(address election, address organizer) external {
        if (msg.sender != factory) revert NotFactory();
        if (election == address(0) || organizer == address(0)) revert ZeroAddress();
        if (organizerOf[election] != address(0)) revert AlreadyRegistered();

        organizerOf[election] = organizer;
        emit ElectionRegistered(election, organizer);
    }

    // ────────────────────────────────────────────────
    // Gas tank
    // ────────────────────────────────────────────────

    receive() external payable {
        gasBalance[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @notice Put POL into your own gas tank.
     *
     * YOUR OWN, where this used to take an address and credit anyone. Nothing
     * ever called it with somebody else's: the interface never offered it, and
     * the one entry point that might have wanted it, the factory, funds an
     * election rather than a balance. What it did offer was money appearing in
     * a tank its owner never chose to hold, and a `Deposited` row they could not
     * account for.
     *
     * Wanting to give an organizer gas is not a reason for it either. A plain
     * transfer from one wallet to another does that, and leaves them to decide
     * whether it goes into a contract at all.
     */
    function deposit() external payable {
        gasBalance[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @notice Commit POL to one election, where it cannot be withdrawn.
     *
     * THE ORGANIZER'S ONLY, though it was open to anyone at first, on the
     * reasoning that a third party might want an election to go ahead. That was
     * wrong, and what shows it is where the money goes afterwards:
     * `releaseReserve` returns the unspent part to the ORGANIZER. So a stranger
     * funding an election was making the organizer a gift of everything the
     * voters did not use, with no way to ask for it back and nothing on screen
     * warning them.
     *
     * Paying for an election is not a donation to the election. It is taking on
     * the organizer's obligation, and the refund is what proves it.
     *
     * Someone who genuinely wants to help still can, through `depositFor`, which
     * is open to anyone: there the money lands in the organizer's balance, where
     * it is plainly a gift and is never mistaken for a reserve.
     *
     * The factory is allowed because it forwards value on behalf of the very
     * account creating the election, which is that election's organizer.
     */
    function depositForElection(address election) external payable {
        address organizer = organizerOf[election];
        if (organizer == address(0)) revert UnknownElection();
        if (msg.sender != organizer && msg.sender != factory) revert NotElectionOrganizer();

        reservedFor[election] += msg.value;
        emit ElectionFunded(election, msg.sender, msg.value);
    }

    /**
     * @notice Move gas you already hold into one of your elections.
     *
     * THE MISSING HALF. `releaseReserve` brings an ended election's leftovers
     * back to the free balance, but nothing could send them the other way:
     * funding an election meant sending new value from the wallet, so an
     * organizer holding five and wanting to commit two had to send two more and
     * withdraw two afterwards. Money came back through one door and could only
     * leave through another.
     *
     * With this the wallet is touched in exactly two places, `deposit` and
     * `withdraw`, and everything else is the balance moving between two columns
     * of the same tank.
     *
     * ONLY THE ORGANIZER OF THAT ELECTION, unlike `depositForElection`, and the
     * difference is the point: there you are committing your own money and
     * anyone may want an election to go ahead, here you are spending someone's
     * balance and only they may decide that.
     */
    function reserveFromBalance(address election, uint256 amount) external {
        if (organizerOf[election] != msg.sender) revert NotElectionOrganizer();
        if (gasBalance[msg.sender] < amount) revert InsufficientBalance();

        gasBalance[msg.sender] -= amount;
        reservedFor[election] += amount;
        emit ElectionFunded(election, msg.sender, amount);
    }

    /**
     * @notice The same move, made by the factory while an election is created.
     *
     * So that funding a new election is ONE signature even when it draws on
     * both sources: the factory forwards whatever came with the transaction and
     * asks for the rest from the balance. Without it the organizer would create,
     * then reserve, and a wizard that leaves money uncommitted between two
     * transactions is a wizard that leaves elections unfunded when the second
     * one is rejected.
     *
     * Factory-only, and it spends the balance of whoever the factory says is
     * creating. That is safe for the same reason `registerElection` is: the
     * factory is the only contract this one trusts, and it passes its own
     * caller.
     */
    function reserveFromBalanceFor(address election, address organizer, uint256 amount) external {
        if (msg.sender != factory) revert NotFactory();
        if (gasBalance[organizer] < amount) revert InsufficientBalance();

        gasBalance[organizer] -= amount;
        reservedFor[election] += amount;
        emit ElectionFunded(election, organizer, amount);
    }

    /**
     * @notice Return what an election did not spend to its organizer.
     *
     * Only once it can no longer take a vote, which is the whole point of the
     * reserve. Cancelled and voided elections release at once, because neither
     * will ever relay anything again and holding the money would punish
     * stopping an election that ought to be stopped.
     *
     * Deliberately callable by anyone. It moves money in exactly one direction,
     * to the organizer the factory recorded, so there is nobody to protect it
     * from, and leaving it open means a stuck organizer can be helped along
     * instead of stranded.
     */
    function releaseReserve(address election) external nonReentrant {
        address organizer = organizerOf[election];
        if (organizer == address(0)) revert UnknownElection();

        ElectionV4 e = ElectionV4(election);
        // `voteEnd` moves when voting is closed early, so this follows it.
        bool over = e.cancelled() || e.voided() || block.timestamp > e.voteEnd();
        if (!over) revert ElectionStillOpen();

        uint256 amount = reservedFor[election];
        if (amount == 0) revert NothingReserved();

        reservedFor[election] = 0;
        gasBalance[organizer] += amount;
        emit ReserveReleased(election, organizer, amount);
    }

    /**
     * @notice Withdraw unused gas funds back to the organizer.
     *
     * Reaches the free balance only. Gas reserved for a running election is not
     * the organizer's to take back while voters are still relying on it.
     */
    function withdraw(uint256 amount) external nonReentrant {
        if (gasBalance[msg.sender] < amount) revert InsufficientBalance();
        gasBalance[msg.sender] -= amount;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert WithdrawFailed();

        emit Withdrawn(msg.sender, amount);
    }

    // ────────────────────────────────────────────────
    // Relaying
    // ────────────────────────────────────────────────

    /// @notice Relay a voter's enrollment, reimbursed from the organizer's tank.
    function relayEnroll(address election, uint256 identityCommitment) external nonReentrant {
        uint256 startGas = gasleft();
        address organizer = _organizerOrRevert(election);

        // Reverts on an ineligible or duplicate commitment, which takes the whole
        // transaction with it: a relayer is never paid for work that failed.
        ElectionV4(election).enroll(identityCommitment);

        _reimburse(election, organizer, startGas, ENROLL_CALLDATA);
    }

    /// @notice Relay an enrollment into an election that declares an attribute
    /// policy, reimbursed from the organizer's tank.
    /// @dev Separate entry point rather than an optional argument on relayEnroll,
    /// because the two bill different calldata sizes and folding them together
    /// would make the cheap call pay for the signature it never sent.
    function relayEnrollAttested(
        address election,
        uint256 identityCommitment,
        uint256 personhoodNullifier,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        uint256 startGas = gasleft();
        address organizer = _organizerOrRevert(election);

        ElectionV4(election).enrollAttested(
            identityCommitment,
            personhoodNullifier,
            deadline,
            signature
        );

        uint256 billable =
            ATTESTED_ENROLL_CALLDATA_HEAD + ((signature.length + 31) / 32) * 32;
        _reimburse(election, organizer, startGas, billable);
    }

    /// @notice Relay a voter's ballot, reimbursed from the organizer's tank.
    /// @dev Deliberately permissionless. The zero-knowledge proof is the
    /// authorisation, so requiring a whitelisted relayer would only add a
    /// censorship point without adding safety. Spam is bounded because an
    /// invalid proof reverts and the sender eats their own gas.
    function relayVote(
        address election,
        bytes calldata voteCiphertext,
        uint256 nullifier,
        uint256 merkleRoot,
        uint256 merkleDepth,
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC
    ) external nonReentrant {
        uint256 startGas = gasleft();
        address organizer = _organizerOrRevert(election);

        ElectionV4(election).castVote(
            voteCiphertext,
            nullifier,
            merkleRoot,
            merkleDepth,
            pA,
            pB,
            pC
        );

        // Derived from the ciphertext length, never from msg.data.length.
        uint256 billable = VOTE_CALLDATA_HEAD + ((voteCiphertext.length + 31) / 32) * 32;
        _reimburse(election, organizer, startGas, billable);
    }

    function _organizerOrRevert(address election) private view returns (address organizer) {
        organizer = organizerOf[election];
        if (organizer == address(0)) revert UnknownElection();
    }

    /// @dev Charges the measured cost to the organizer and pays the relayer.
    /// Execution gas is measured directly; the transaction base and calldata come
    /// from `billableCalldata`, an exact size derived from the arguments. See
    /// VOTE_CALLDATA_HEAD for why `msg.data.length` must never be used here.
    function _reimburse(
        address election,
        address organizer,
        uint256 startGas,
        uint256 billableCalldata
    ) private {
        uint256 price = tx.gasprice < maxGasPrice ? tx.gasprice : maxGasPrice;
        uint256 used = startGas - gasleft() + baseOverheadGas + billableCalldata * calldataGasPerByte;
        if (used > maxRelayGas) used = maxRelayGas;
        uint256 cost = used * price;

        /**
         * THE RESERVE PAYS FIRST, then whatever the organizer has free.
         *
         * That order, and not the other way round, because the reserve exists
         * to be spent on this election: spending the free balance while a
         * reserve sits untouched would leave money committed to an election
         * that is already over and drain the funds every other election of
         * theirs depends on.
         *
         * Falling back to the free balance costs nothing and buys liveness. An
         * organizer who under-reserved but has funds keeps their election
         * running, and no promise is broken, since the free balance was never
         * promised to anyone.
         */
        uint256 reserve = reservedFor[election];
        if (reserve >= cost) {
            reservedFor[election] = reserve - cost;
        } else {
            uint256 short = cost - reserve;
            uint256 free = gasBalance[organizer];
            if (free < short) revert InsufficientBalance();
            if (reserve > 0) reservedFor[election] = 0;
            gasBalance[organizer] = free - short;
        }

        emit VoteSponsored(organizer, cost, msg.sender);

        (bool ok, ) = payable(msg.sender).call{value: cost}("");
        if (!ok) revert ReimbursementFailed();
    }

    /**
     * @notice What is behind one election's sponsored gas, in both senses.
     *
     * Two numbers rather than a total, because they are different promises.
     * `reserved` cannot be taken away while the election can still take a vote.
     * `organizerFree` will be spent if the reserve runs out, and can also be
     * withdrawn at any moment. A screen that added them together would be
     * telling a voter that the second kind is as good as the first.
     */
    function electionFunding(address election)
        external
        view
        returns (uint256 reserved, uint256 organizerFree)
    {
        address organizer = organizerOf[election];
        if (organizer == address(0)) revert UnknownElection();
        return (reservedFor[election], gasBalance[organizer]);
    }

    /// @notice Hand control to another address.
    /// @dev Lets the deployer key stay offline while a separate hot wallet does
    /// the day-to-day work. Without it the deployer key has to live wherever the
    /// operational calls are made, which for a registry means the issuer server.
    /// Two-step on purpose: a typo here would brick the contract permanently.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Called by the incoming owner to prove the address is usable.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previous = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, owner);
    }
}
