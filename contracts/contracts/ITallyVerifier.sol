// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

/// @title ITallyVerifier
/// @notice The Groth16 verifier of the tally circuit for one number of slots.
/// Generated per size by circuits/scripts/build.mjs.
interface ITallyVerifier {
    /// @notice How many slots the circuit this verifier checks was compiled for.
    function slots() external view returns (uint256);

    /// @notice Verifies a tally proof against its public signals, in circuit order:
    /// counts[slots], voters, keysHash, slots, aggA, aggB, quorum, publish.
    function verifyTally(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata pub
    ) external view returns (bool);
}
