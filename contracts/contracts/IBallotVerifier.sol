// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

/// @title IBallotVerifier
/// @notice The Groth16 verifier of the ballot circuit for one number of slots
/// (options plus the blank vote). Generated per size by circuits/scripts/build.mjs.
interface IBallotVerifier {
    /// @notice How many slots the circuit this verifier checks was compiled for.
    function slots() external view returns (uint256);

    /// @notice Verifies one ballot proof against its public signals, in circuit order:
    /// tag, epochTag, leaf, votersRoot, ballotsRoot, scope, keysHash, slots, epoch,
    /// voteA, voteB, cancelA, cancelB.
    function verifyBallot(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata pub
    ) external view returns (bool);
}
