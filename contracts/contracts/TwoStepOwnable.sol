// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

/// @title TwoStepOwnable
/// @notice Ownership handed over in two steps, shared by the platform's
/// owner-administered contracts so the logic exists once.
/// @dev Lets the deployer key stay offline while a separate hot wallet does the
/// day-to-day work. Two-step on purpose: a typo in a one-step transfer would
/// brick the contract permanently. The errors and events keep the names these
/// contracts always exposed, so no reader of their ABI has to change.
abstract contract TwoStepOwnable {
    address public owner;
    address public pendingOwner;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Hand control to another address, pending their acceptance.
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
