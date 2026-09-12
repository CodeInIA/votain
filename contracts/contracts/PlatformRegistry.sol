// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

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
    /// @notice One passkey's copy of the voter's sealed Semaphore secret.
    struct VaultEntry {
        /// @dev WebAuthn credential id. Public by nature, and the key a voter's
        /// browser matches against to pick the blob its authenticator can open.
        bytes credentialId;
        /// @dev AES-GCM `iv ‖ ciphertext`. Opaque here and to everyone but the
        /// holder of the passkey it was sealed for.
        bytes blob;
        uint64 addedAt;
    }

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

    /**
     * @dev World ID nullifier => the voter's encrypted identity vault.
     *
     * The Semaphore secret, sealed under a key derived from one passkey's
     * WebAuthn PRF output, once per passkey the voter has enrolled. It lives
     * here rather than on the issuer's disk because the only property the store
     * has to provide is AVAILABILITY: the ciphertext cannot be read without the
     * authenticator, and it cannot be swapped for another, since a substituted
     * blob would decrypt to an identity whose commitment does not match
     * `commitmentOf` and every enrollment would fail. A server holding it could
     * therefore never read or forge a vote, only refuse to hand it back, and
     * that last power is the one this removes.
     *
     * WHAT IT COSTS, said plainly because it is permanent. The ciphertext is
     * public and stays public: whatever breaks AES-GCM in twenty years gets to
     * try. So is the shape of the voter's setup, meaning how many passkeys they
     * hold and when each was added. Removing an entry stops it being offered,
     * it does not erase it from the chain's history.
     */
    mapping(uint256 => VaultEntry[]) private vaults;

    /**
     * @dev World ID nullifier => this human's slot in the credential status
     * list, 1 based so that zero still means "not registered".
     *
     * Assigned during registration rather than per credential, and that is the
     * whole point: the issuer used to allocate a fresh index every time it
     * signed a session credential, which on chain would have meant a
     * transaction per sign-in. A human needs one slot, not one per login, and
     * they already have exactly one registration to hang it off.
     */
    mapping(uint256 => uint256) public statusIndexOf;

    /// @dev How many humans have been registered, and therefore the highest
    /// slot handed out.
    uint256 public memberCount;

    /**
     * @dev Status slot => the credentials for that human are revoked.
     *
     * Published here so a verifier can check a credential without asking the
     * issuer that signed it. The issuer is still the only party that can revoke,
     * which is inherent: they are the authority on their own credentials. What
     * moves is where the answer is readable from, not who decides it.
     */
    mapping(uint256 => bool) public revokedStatus;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MemberVerified(uint256 indexed nullifier, uint256 indexed identityCommitment);
    event MemberRotated(
        uint256 indexed nullifier,
        uint256 indexed oldCommitment,
        uint256 indexed newCommitment
    );

    event VaultEntryAdded(uint256 indexed nullifier, bytes credentialId);
    event VaultEntryRemoved(uint256 indexed nullifier, bytes credentialId);
    event VaultReset(uint256 indexed nullifier, bytes credentialId);
    event StatusRevoked(uint256 indexed statusIndex);
    event StatusRestored(uint256 indexed statusIndex);

    error NotOwner();
    error NotPendingOwner();
    error NullifierAlreadyRegistered();
    error IdentityAlreadyVerified();
    error NullifierNotRegistered();
    error ZeroValue();
    error EmptyVaultEntry();
    error CredentialAlreadyPresent();
    error CredentialNotFound();
    error UnknownStatusIndex();
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

        memberCount += 1;
        statusIndexOf[nullifier] = memberCount;

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

    // ────────────────────────────────────────────────
    // Credential status
    // ────────────────────────────────────────────────

    /// @notice Marks one human's issued credentials as revoked.
    /// @dev Owner-only because the issuer signs those credentials and is the
    /// only party that can meaningfully withdraw them.
    function revokeStatus(uint256 statusIndex) external onlyOwner {
        if (statusIndex == 0 || statusIndex > memberCount) revert UnknownStatusIndex();
        revokedStatus[statusIndex] = true;
        emit StatusRevoked(statusIndex);
    }

    /// @notice Undoes a revocation, for one entered by mistake.
    function restoreStatus(uint256 statusIndex) external onlyOwner {
        if (statusIndex == 0 || statusIndex > memberCount) revert UnknownStatusIndex();
        revokedStatus[statusIndex] = false;
        emit StatusRestored(statusIndex);
    }

    // ────────────────────────────────────────────────
    // Identity vault
    // ────────────────────────────────────────────────

    /**
     * @notice Adds one passkey's sealed copy of a registered human's secret.
     * @dev Owner-only for the same reason registration is: a voter has no
     * wallet, by design, because a per-voter sending address would publicly
     * link their enrollment to their ballot. The owner is therefore a WRITER
     * and never a reader, and it is the chain, not the owner, that anyone
     * afterwards reads the vault from.
     */
    function addVaultEntry(
        uint256 nullifier,
        bytes calldata credentialId,
        bytes calldata blob
    ) external onlyOwner {
        if (nullifier == 0) revert ZeroValue();
        if (credentialId.length == 0 || blob.length == 0) revert EmptyVaultEntry();
        if (!registeredNullifiers[nullifier]) revert NullifierNotRegistered();

        VaultEntry[] storage entries = vaults[nullifier];
        for (uint256 i = 0; i < entries.length; i++) {
            // Same passkey twice would leave the browser two blobs to choose
            // between with nothing to choose on, since both open equally well.
            if (keccak256(entries[i].credentialId) == keccak256(credentialId)) {
                revert CredentialAlreadyPresent();
            }
        }

        entries.push(
            VaultEntry({credentialId: credentialId, blob: blob, addedAt: uint64(block.timestamp)})
        );
        emit VaultEntryAdded(nullifier, credentialId);
    }

    /// @notice Stops offering one passkey's copy, for a device the voter no
    /// longer has.
    /// @dev The blob stays in the chain's history, as everything written to a
    /// chain does. This is about which copies a browser is handed, not about
    /// erasure, and the documentation says so rather than implying otherwise.
    function removeVaultEntry(uint256 nullifier, bytes calldata credentialId) external onlyOwner {
        VaultEntry[] storage entries = vaults[nullifier];
        bytes32 target = keccak256(credentialId);

        for (uint256 i = 0; i < entries.length; i++) {
            if (keccak256(entries[i].credentialId) == target) {
                entries[i] = entries[entries.length - 1];
                entries.pop();
                emit VaultEntryRemoved(nullifier, credentialId);
                return;
            }
        }
        revert CredentialNotFound();
    }

    /**
     * @notice Recovery: drop every copy and store one for the passkey at hand.
     * @dev Pairs with `rotateMember`, which mints the new commitment the blob
     * must decrypt to. Old blobs seal a secret that no longer has an active
     * commitment, so leaving them offered would hand a browser a key to a door
     * that has been walled up.
     */
    function resetVault(
        uint256 nullifier,
        bytes calldata credentialId,
        bytes calldata blob
    ) external onlyOwner {
        if (nullifier == 0) revert ZeroValue();
        if (credentialId.length == 0 || blob.length == 0) revert EmptyVaultEntry();
        if (!registeredNullifiers[nullifier]) revert NullifierNotRegistered();

        delete vaults[nullifier];
        vaults[nullifier].push(
            VaultEntry({credentialId: credentialId, blob: blob, addedAt: uint64(block.timestamp)})
        );
        emit VaultReset(nullifier, credentialId);
    }

    /// @notice Every sealed copy this human has, for the browser to try.
    /// @dev Public, and nothing is lost by that: see the note on `vaults`.
    function getVault(uint256 nullifier) external view returns (VaultEntry[] memory) {
        return vaults[nullifier];
    }

    /// @notice How many passkeys can open this human's identity.
    function vaultEntryCount(uint256 nullifier) external view returns (uint256) {
        return vaults[nullifier].length;
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
