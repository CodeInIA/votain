// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.36;

/// @title PlatformRegistry
/// @notice Binds a World ID nullifier (one per human, per app+action) to the
/// Semaphore identity commitment that human votes with. Elections gate
/// enrollment on this registry, so it is the platform's Sybil boundary.
///
/// One human holds exactly ONE active commitment at a time. That is what makes
/// the anonymous ballot safe to count: at vote time the election only sees a
/// Semaphore nullifier derived from the identity secret, so two active
/// identities for the same human would produce two independently countable
/// votes that no contract could correlate.
///
/// Multi-device support therefore does NOT come from issuing a second identity.
/// The voter keeps one secret and unlocks it from each of their passkeys (see
/// the encrypted identity vault in the frontend/backend). `rotateMember` exists
/// only for recovery, when that secret is genuinely lost: it revokes the old
/// commitment in the same transaction that activates the new one, so the count
/// of active identities per human never exceeds one.
contract PlatformRegistry {
    address public owner;
    address public pendingOwner;

    /// @dev World ID nullifier => registered at all.
    mapping(uint256 => bool) public registeredNullifiers;
    /// @dev Semaphore identity commitment => currently active.
    mapping(uint256 => bool) public verifiedMembers;
    /// @dev Semaphore identity commitment => the human (World ID nullifier) behind it.
    /// Retained after rotation so elections can still resolve a revoked
    /// commitment back to its human and refuse a second enrollment.
    mapping(uint256 => uint256) public nullifierOf;
    /// @dev World ID nullifier => the commitment currently active for that human.
    mapping(uint256 => uint256) public commitmentOf;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MemberVerified(uint256 indexed nullifier, uint256 indexed identityCommitment);
    event MemberRotated(
        uint256 indexed nullifier,
        uint256 indexed oldCommitment,
        uint256 indexed newCommitment
    );

    error NotOwner();
    error NotPendingOwner();
    error NullifierAlreadyRegistered();
    error IdentityAlreadyVerified();
    error NullifierNotRegistered();
    error ZeroValue();
    error ZeroAddress();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice First registration of a human. Reverts if either side is taken.
    function registerMember(uint256 nullifier, uint256 identityCommitment) external onlyOwner {
        if (nullifier == 0 || identityCommitment == 0) revert ZeroValue();
        if (registeredNullifiers[nullifier]) revert NullifierAlreadyRegistered();
        if (nullifierOf[identityCommitment] != 0) revert IdentityAlreadyVerified();

        registeredNullifiers[nullifier] = true;
        verifiedMembers[identityCommitment] = true;
        nullifierOf[identityCommitment] = nullifier;
        commitmentOf[nullifier] = identityCommitment;

        emit MemberVerified(nullifier, identityCommitment);
    }

    /// @notice Recovery path: point an already-registered human at a new
    /// commitment, revoking the previous one atomically.
    /// @dev Elections the human already enrolled in keep the OLD commitment in
    /// their merkle tree, which is intentional: those ballots stay valid and
    /// `nullifierOf` still resolves that leaf to this human, so `enroll` will
    /// reject the new commitment there and no double vote becomes possible.
    function rotateMember(uint256 nullifier, uint256 newCommitment) external onlyOwner {
        if (nullifier == 0 || newCommitment == 0) revert ZeroValue();
        if (!registeredNullifiers[nullifier]) revert NullifierNotRegistered();
        if (nullifierOf[newCommitment] != 0) revert IdentityAlreadyVerified();

        // A no-op rotation is already rejected above: re-passing the active
        // commitment leaves `nullifierOf[newCommitment]` non-zero.
        uint256 oldCommitment = commitmentOf[nullifier];

        verifiedMembers[oldCommitment] = false;
        verifiedMembers[newCommitment] = true;
        nullifierOf[newCommitment] = nullifier;
        commitmentOf[nullifier] = newCommitment;

        emit MemberRotated(nullifier, oldCommitment, newCommitment);
    }

    /// @notice Hand control to another address.
    /// @dev Lets the deployer key stay offline while a separate hot wallet does
    /// the day-to-day work. Without it the deployer key has to live wherever the
    /// operational calls are made, which for a registry means the issuer server.
    /// Two-step on purpose: a typo here would brick the contract permanently.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Called by the incoming owner to prove the address is usable.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previous = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, owner);
    }
}
