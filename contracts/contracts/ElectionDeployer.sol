// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {ElectionV4} from "./ElectionV4.sol";

/// @title ElectionDeployer
/// @notice Holds ElectionV4's creation code so ElectionFactory does not have to.
///
/// WHY IT EXISTS. A contract that says `new ElectionV4(...)` carries the whole
/// creation code of ElectionV4 inside its own, and once ballots were verified
/// and aggregated on chain that no longer fit under the 24576-byte limit next to
/// the factory's own logic. Splitting it off is the one change that leaves both
/// contracts exactly as they were.
///
/// Permissionless and stateless on purpose. Deploying an ElectionV4 was never
/// privileged, anyone can do it from a wallet, and it confers nothing: an
/// election exists for the platform only once the paymaster has registered it,
/// which only ElectionFactory can do.
contract ElectionDeployer {
    function deploy(
        address ballotVerifier,
        address tallyVerifier,
        address registry,
        address platformAttester,
        address organizer,
        ElectionV4.Config calldata cfg
    ) external returns (address) {
        return address(new ElectionV4(ballotVerifier, tallyVerifier, registry, platformAttester, organizer, cfg));
    }
}
