// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

contract PlatformRegistry {
    address public owner;
    
    mapping(uint256 => bool) public registeredNullifiers; // World ID nullifier
    mapping(uint256 => bool) public verifiedMembers;      // Semaphore Identity Commitment

    event MemberVerified(uint256 indexed nullifier, uint256 indexed identityCommitment);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function registerMember(uint256 nullifier, uint256 identityCommitment) external onlyOwner {
        require(!registeredNullifiers[nullifier], "Nullifier already registered");
        require(!verifiedMembers[identityCommitment], "Identity already verified");
        
        registeredNullifiers[nullifier] = true;
        verifiedMembers[identityCommitment] = true;
        
        emit MemberVerified(nullifier, identityCommitment);
    }
}
