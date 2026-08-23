// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.36;

import {ElectionV4} from "./ElectionV4.sol";
import {ElectionPaymaster} from "./ElectionPaymaster.sol";

/// @title ElectionFactory
/// @notice Deploys ElectionV4 instances and forwards the organizer's MATIC deposit
/// to the gas paymaster. Keeps an enumerable list of every election created.
contract ElectionFactory {
    ElectionPaymaster public immutable paymaster;
    address public immutable forwarder;
    address public immutable verifier;
    address public immutable registry;

    address[] public elections;

    event ElectionCreated(
        address indexed electionAddress,
        address indexed organizer,
        string name,
        ElectionV4.VotingType votingType,
        uint256 scope
    );

    error ZeroAddress();

    constructor(address _paymaster, address _forwarder, address _verifier, address _registry) {
        if (
            _paymaster == address(0) ||
            _forwarder == address(0) ||
            _verifier == address(0) ||
            _registry == address(0)
        ) revert ZeroAddress();

        paymaster = ElectionPaymaster(payable(_paymaster));
        forwarder = _forwarder;
        verifier = _verifier;
        registry = _registry;
    }

    /// @notice Deploy a new election. Any attached MATIC funds the organizer's gas tank.
    function createElection(ElectionV4.Config calldata cfg) external payable returns (address) {
        if (msg.value > 0) {
            paymaster.depositFor{value: msg.value}(msg.sender);
        }

        ElectionV4 newElection = new ElectionV4(forwarder, verifier, registry, msg.sender, cfg);
        elections.push(address(newElection));

        // Binds the election to the tank that pays for its voters' gas. Without
        // this the paymaster cannot relay for it (see ElectionPaymaster).
        paymaster.registerElection(address(newElection), msg.sender);

        emit ElectionCreated(address(newElection), msg.sender, cfg.name, cfg.votingType, cfg.scope);
        return address(newElection);
    }

    function electionsCount() external view returns (uint256) {
        return elections.length;
    }

    /// @notice Paginated accessor so the frontend can list elections without events.
    function getElections(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 total = elections.length;
        if (offset >= total) return new address[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;

        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = elections[i];
        }
    }
}
