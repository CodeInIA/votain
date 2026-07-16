// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@semaphore-protocol/contracts/interfaces/ISemaphoreVerifier.sol";

contract MockVerifier is ISemaphoreVerifier {
    /// @dev Simulates the verification of a ZK Groth16 proof as in Semaphore V4
    function verifyProof(
        uint256[2] calldata /* _pA */,
        uint256[2][2] calldata /* _pB */,
        uint256[2] calldata /* _pC */,
        uint256[4] calldata /* _pubSignals */,
        uint256 /* merkleTreeDepth */
    ) external pure override returns (bool) {
        // In production, real cryptographic math on the elliptic curve would be done here.
        // As a mock, we simply assume any well-formed proof is valid.
        return true;
    }
}
