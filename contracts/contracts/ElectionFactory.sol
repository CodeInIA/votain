// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {ElectionV4} from "./ElectionV4.sol";
import {ElectionDeployer} from "./ElectionDeployer.sol";
import {ElectionPaymaster} from "./ElectionPaymaster.sol";
import {IBallotVerifier} from "./IBallotVerifier.sol";
import {ITallyVerifier} from "./ITallyVerifier.sol";

/// @title ElectionFactory
/// @notice Deploys ElectionV4 instances and forwards the organizer's MATIC deposit
/// to the gas paymaster. Keeps an enumerable list of every election created.
contract ElectionFactory {
    ElectionPaymaster public immutable paymaster;
    /// @notice Holds ElectionV4's creation code, which no longer fits in here.
    ElectionDeployer public immutable deployer;
    /**
     * @notice The circuits' verifiers, one pair per size. An election uses the
     * smallest size that holds its options and the blank vote.
     *
     * Fixed at deployment and ordered by size. An organizer never names a
     * verifier: one who could would choose what counts as a valid ballot.
     */
    address[] internal _ballotVerifiers;
    address[] internal _tallyVerifiers;
    address public immutable registry;
    /**
     * @notice The key every election deployed here trusts for private enrolment.
     *
     * IMPOSED, not chosen. An organizer who could name this key could sign
     * their own roll: private enrolment replaces the registry lookup with a
     * signature, so whoever holds the key decides who counts as a verified
     * human. That has to be the platform's key for every election, or it is
     * not a platform boundary at all.
     *
     * Zero deploys elections that enrol the old, publicly linkable way, which
     * is what a chain with no platform attester can still do.
     */
    address public immutable platformAttester;

    address[] public elections;

    event ElectionCreated(
        address indexed electionAddress,
        address indexed organizer,
        string name,
        ElectionV4.VotingType votingType
    );

    error ZeroAddress();
    /// @dev The verifier lists are empty, of different lengths, or not in size order.
    error BadVerifiers();
    /// @dev No circuit is large enough for this many options.
    error TooManyOptions();

    constructor(
        address _paymaster,
        address _deployer,
        address[] memory ballotVerifiers_,
        address[] memory tallyVerifiers_,
        address _registry,
        address _platformAttester
    ) {
        if (_paymaster == address(0) || _deployer == address(0) || _registry == address(0)) {
            revert ZeroAddress();
        }
        if (ballotVerifiers_.length == 0 || ballotVerifiers_.length != tallyVerifiers_.length) {
            revert BadVerifiers();
        }
        uint256 previous = 0;
        for (uint256 i = 0; i < ballotVerifiers_.length; i++) {
            uint256 size = IBallotVerifier(ballotVerifiers_[i]).slots();
            if (size <= previous || ITallyVerifier(tallyVerifiers_[i]).slots() != size) revert BadVerifiers();
            previous = size;
        }

        paymaster = ElectionPaymaster(payable(_paymaster));
        deployer = ElectionDeployer(_deployer);
        _ballotVerifiers = ballotVerifiers_;
        _tallyVerifiers = tallyVerifiers_;
        registry = _registry;
        platformAttester = _platformAttester;
    }

    /**
     * @notice Deploy a new election, reserving gas for its voters.
     *
     * Funded from two places at once, in one signature: `fromBalance` is taken
     * from what the organizer already holds in the paymaster, and anything
     * attached to the call covers the rest. A wizard that had to create first
     * and reserve second would leave the election unfunded whenever the second
     * transaction was rejected, which is the moment an organizer is most likely
     * to walk away.
     */
    function createElection(
        ElectionV4.Config calldata cfg,
        uint256 fromBalance
    ) external payable returns (address) {
        (address ballotVerifier, address tallyVerifier) = verifiersFor(cfg.numOptions);
        ElectionV4 newElection = ElectionV4(
            deployer.deploy(ballotVerifier, tallyVerifier, registry, platformAttester, msg.sender, cfg)
        );
        elections.push(address(newElection));

        // Binds the election to the tank that pays for its voters' gas. Without
        // this the paymaster cannot relay for it (see ElectionPaymaster).
        paymaster.registerElection(address(newElection), msg.sender);

        /**
         * RESERVED, NOT DEPOSITED, and it happens after the registration above
         * because the reserve is keyed on an address that does not exist until
         * the election is deployed.
         *
         * This used to land in the organizer's shared balance, which they could
         * withdraw at any moment, including while their own voters were in the
         * middle of voting. Money attached to the creation of an election is
         * plainly meant for that election, so that is where it goes, and it
         * stays there until the election can no longer take a vote.
         */
        if (msg.value > 0) {
            paymaster.depositForElection{value: msg.value}(address(newElection));
        }
        // Reverts if they do not hold it, which is the right answer: an
        // election created with less behind it than was asked for is worse than
        // one that was not created.
        if (fromBalance > 0) {
            paymaster.reserveFromBalanceFor(address(newElection), msg.sender, fromBalance);
        }

        emit ElectionCreated(address(newElection), msg.sender, cfg.name, cfg.votingType);
        return address(newElection);
    }

    /// @notice The smallest verifier pair that holds `numOptions` and the blank vote.
    function verifiersFor(uint256 numOptions) public view returns (address ballot, address tallyV) {
        for (uint256 i = 0; i < _ballotVerifiers.length; i++) {
            if (IBallotVerifier(_ballotVerifiers[i]).slots() > numOptions) {
                return (_ballotVerifiers[i], _tallyVerifiers[i]);
            }
        }
        revert TooManyOptions();
    }

    function ballotVerifiers() external view returns (address[] memory) {
        return _ballotVerifiers;
    }

    function tallyVerifiers() external view returns (address[] memory) {
        return _tallyVerifiers;
    }

    function electionsCount() external view returns (uint256) {
        return elections.length;
    }

    /// @notice Paginated accessor so the frontend can list elections without events.
    function getElections(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 total = elections.length;
        if (offset >= total) return new address[](0);

        // Clamped before adding, so a caller asking for "everything" with a
        // huge limit gets the rest of the list rather than an overflow revert.
        uint256 end = limit > total - offset ? total : offset + limit;

        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = elections[i];
        }
    }
}
