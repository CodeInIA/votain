// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

contract ElectionPaymaster {
    address public owner;
    
    // Virtual gas tank: organizer => balance
    mapping(address => uint256) public gasBalance;

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {
        gasBalance[msg.sender] += msg.value;
    }

    function depositFor(address organizer) external payable {
        gasBalance[organizer] += msg.value;
    }

    // Deducts organizer's balance. Only callable by ElectionFactory or the Forwarder.
    function sponsorVote(address organizer, uint256 cost) external {
        // In a real scenario, we would validate `msg.sender` to be only the EntryPoint or Biconomy Forwarder.
        require(gasBalance[organizer] >= cost, "Insufficient gas balance");
        gasBalance[organizer] -= cost;
    }
}
