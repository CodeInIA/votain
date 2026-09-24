// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {ElectionV4} from "../ElectionV4.sol";

/// @notice TEST ONLY. Lets the outcome tests publish tallies of any size
/// without casting that many ballots first: `publishResults` requires the
/// counters to account for `distinctVoters`, and the arithmetic of outcomes is
/// what those tests are about, not the voting that precedes it.
contract ElectionV4Harness is ElectionV4 {
    constructor(
        address _verifier,
        address _registry,
        address _platformAttester,
        address _organizer,
        Config memory cfg
    ) ElectionV4(_verifier, _registry, _platformAttester, _organizer, cfg) {}

    function forceDistinctVoters(uint256 n) external {
        distinctVoters = n;
    }
}
