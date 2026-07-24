// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.36;

/// @title ElectionPaymaster
/// @notice Virtual gas tank: organizers deposit MATIC that sponsors their voters'
/// meta-transactions. Deduction is restricted to the authorized ERC-4337 EntryPoint
/// and the trusted ERC-2771 forwarder — nobody else can drain a tank.
contract ElectionPaymaster {
    address public owner;

    /// @dev ERC-4337 EntryPoint (v0.7) allowed to charge gas tanks.
    address public entryPoint;

    /// @dev ERC-2771 trusted forwarder allowed to charge gas tanks.
    address public trustedForwarder;

    /// @dev organizer => sponsored gas balance (wei)
    mapping(address => uint256) public gasBalance;

    event Deposited(address indexed organizer, address indexed from, uint256 amount);
    event Withdrawn(address indexed organizer, uint256 amount);
    event VoteSponsored(address indexed organizer, uint256 cost, address indexed chargedBy);
    event SponsorsConfigured(address entryPoint, address trustedForwarder);

    error NotOwner();
    error NotAuthorizedSponsor();
    error InsufficientBalance();
    error WithdrawFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {
        gasBalance[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.sender, msg.value);
    }

    /// @notice Configure which addresses may charge gas tanks. Deployment wiring.
    function setSponsors(address _entryPoint, address _trustedForwarder) external onlyOwner {
        entryPoint = _entryPoint;
        trustedForwarder = _trustedForwarder;
        emit SponsorsConfigured(_entryPoint, _trustedForwarder);
    }

    /// @notice Deposit MATIC into an organizer's gas tank on their behalf.
    function depositFor(address organizer) external payable {
        gasBalance[organizer] += msg.value;
        emit Deposited(organizer, msg.sender, msg.value);
    }

    /// @notice Withdraw unused gas funds back to the organizer.
    function withdraw(uint256 amount) external {
        if (gasBalance[msg.sender] < amount) revert InsufficientBalance();
        gasBalance[msg.sender] -= amount;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert WithdrawFailed();

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Deduct the cost of a sponsored vote from an organizer's tank.
    /// @dev Callable ONLY by the configured EntryPoint or trusted forwarder.
    function sponsorVote(address organizer, uint256 cost) external {
        if (msg.sender != entryPoint && msg.sender != trustedForwarder) {
            revert NotAuthorizedSponsor();
        }
        if (gasBalance[organizer] < cost) revert InsufficientBalance();

        gasBalance[organizer] -= cost;
        emit VoteSponsored(organizer, cost, msg.sender);
    }
}
