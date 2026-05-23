// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./ElectionV4.sol";
import "./ElectionPaymaster.sol";

contract ElectionFactory {
    ElectionPaymaster public paymaster;
    address public forwarder;
    address public verifier;

    event ElectionCreated(address indexed electionAddress, string name, uint256 groupId, uint256 scope);

    constructor(address _paymaster, address _forwarder, address _verifier) {
        paymaster = ElectionPaymaster(payable(_paymaster));
        forwarder = _forwarder;
        verifier = _verifier;
    }

    function createElection(
        string memory name, 
        uint256 groupId, 
        uint256 scope, 
        uint256 startTime, 
        uint256 endTime
    ) external payable returns (address) {
        // Sends msg.value to ElectionPaymaster on behalf of msg.sender
        if (msg.value > 0) {
            paymaster.depositFor{value: msg.value}(msg.sender);
        }

        ElectionV4 newElection = new ElectionV4(forwarder, verifier, groupId, scope, startTime, endTime);
        
        emit ElectionCreated(address(newElection), name, groupId, scope);
        return address(newElection);
    }
}
