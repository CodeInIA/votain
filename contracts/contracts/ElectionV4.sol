// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@semaphore-protocol/contracts/interfaces/ISemaphoreVerifier.sol";

contract ElectionV4 is ERC2771Context {
    ISemaphoreVerifier public verifier;
    
    uint256 public groupId;
    uint256 public scope; // Semaphore V4 uses scope instead of externalNullifier
    uint256 public startTime;
    uint256 public endTime;
    
    // nullifier => current nonce (for coercion resistance)
    mapping(uint256 => uint256) public nullifierNonces;

    event VoteCast(uint256 indexed nullifier, uint256 voteCiphertext, uint256 nonce, uint256 timestamp);

    constructor(
        address trustedForwarder, 
        address _verifier,
        uint256 _groupId, 
        uint256 _scope, 
        uint256 _startTime, 
        uint256 _endTime
    ) ERC2771Context(trustedForwarder) {
        verifier = ISemaphoreVerifier(_verifier);
        groupId = _groupId;
        scope = _scope;
        startTime = _startTime;
        endTime = _endTime;
    }

    function castVote(
        uint256 voteCiphertext, 
        uint256 nullifier, 
        uint256 merkleRoot, 
        uint256 merkleDepth, 
        uint256[2] calldata _pA, 
        uint256[2][2] calldata _pB, 
        uint256[2] calldata _pC
    ) external {
        require(block.timestamp >= startTime && block.timestamp <= endTime, "Election not active");
        
        uint256 currentNonce = nullifierNonces[nullifier];
        
        // The signal in V4 is the message
        uint256 message = uint256(keccak256(abi.encodePacked(voteCiphertext, currentNonce)));
        
        // Validate ZK Proof in ISemaphoreVerifier 
        // pubSignals array order in Semaphore V4: [merkleTreeRoot, nullifier, message, scope]
        uint256[4] memory pubSignals = [merkleRoot, nullifier, message, scope];
        
        require(
            verifier.verifyProof(_pA, _pB, _pC, pubSignals, merkleDepth),
            "Invalid Zero-Knowledge Proof"
        );
        // Do NOT revert if the nullifier already exists to allow coercion resistance.

        emit VoteCast(nullifier, voteCiphertext, currentNonce, block.timestamp);
        
        nullifierNonces[nullifier] += 1;
    }
}
