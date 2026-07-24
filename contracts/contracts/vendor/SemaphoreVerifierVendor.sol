// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.36;

import {SemaphoreVerifier} from "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol";

/// @title SemaphoreVerifierV4
/// @notice Thin wrapper over the official Semaphore V4 Groth16 verifier so Hardhat
/// produces a deployable artifact. This is the production verifier used on Amoy;
/// MockVerifier is for unit tests only.
contract SemaphoreVerifierV4 is SemaphoreVerifier {}
