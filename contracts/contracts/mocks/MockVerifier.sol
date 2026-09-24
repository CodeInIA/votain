// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {IBallotVerifier} from "../IBallotVerifier.sol";
import {ITallyVerifier} from "../ITallyVerifier.sol";

/// @notice TEST AND LOCAL ONLY. Stands in for the generated ballot verifier of
/// one size: it checks the number of public signals, as the real one does, and
/// accepts any proof unless told to refuse. Lets the contract tests exercise
/// everything around a proof without proving; the E2E suite proves for real.
contract MockBallotVerifier is IBallotVerifier {
    uint256 public immutable slots;
    bool public accept = true;

    constructor(uint256 slots_) {
        slots = slots_;
    }

    function setAccept(bool accept_) external {
        accept = accept_;
    }

    function verifyBallot(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[] calldata pub
    ) external view returns (bool) {
        return accept && pub.length == 13 + 4 * slots;
    }
}

/// @notice TEST AND LOCAL ONLY. The tally counterpart of MockBallotVerifier.
contract MockTallyVerifier is ITallyVerifier {
    uint256 public immutable slots;
    bool public accept = true;

    constructor(uint256 slots_) {
        slots = slots_;
    }

    function setAccept(bool accept_) external {
        accept = accept_;
    }

    function verifyTally(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[] calldata pub
    ) external view returns (bool) {
        return accept && pub.length == 3 * slots + 7;
    }
}
