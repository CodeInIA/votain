// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {TwoStepOwnable} from "./TwoStepOwnable.sol";

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
contract PlatformRegistry is TwoStepOwnable {
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
     * @dev World ID nullifier => this voter's encrypted preferences.
     *
     * WHAT IT IS FOR. A voter's own settings, today the elections they saved to
     * come back to. It has to survive a reinstall and follow them to a second
     * device, and a voter has no wallet and no account with a password: what
     * they have is one Semaphore secret, recoverable from a passkey or twelve
     * words. Anything derived from that secret is therefore reachable wherever
     * they are, and nowhere else.
     *
     * WHY IT IS A BLOB AND NOT A LIST OF ELECTIONS. In plaintext this mapping
     * would be a public, permanent record of which elections interest a named
     * human, readable by anyone with an RPC endpoint. That is the linkage
     * `enrollPrivate` and the per-election identities exist to remove, and it
     * would be worse than the one they removed, since saving costs nothing and
     * people save what they are curious about, not only what they join. So the
     * chain gets ciphertext: AES-GCM under a key derived from the voter's own
     * secret, which this contract, its owner and every observer cannot compute.
     *
     * WHY THE CHAIN. The same reason as the vault above, and no other: what is
     * needed is AVAILABILITY, and the issuer has no database. Substituting a
     * blob only breaks decryption, which the browser notices and reports; the
     * owner is a writer here and never a reader.
     *
     * WHAT IT COSTS, said plainly because it is permanent. That this human
     * saved SOMETHING is public, as is the rough size of it and when each
     * change was made. What was saved is not. Clearing the blob stops it being
     * served, it does not erase it from the chain's history.
     */
    mapping(uint256 => bytes) private preferences;

    /**
     * @dev Ceiling on one voter's blob, and it is GAS that sets it.
     *
     * A write replaces the whole value, so its cost grows with the length the
     * caller sends, and the caller here is the platform's own relayer paying
     * for somebody else. At 4 KiB a blob holds far more saved elections than a
     * person will ever have, and a bug or an abusive client cannot turn one
     * voter's settings into a transaction that empties the relayer.
     */
    uint256 public constant MAX_PREFERENCES_BYTES = 4096;

    /**
     * @dev Ceilings on the vault, for the same reason as the one above: every
     * write is paid for by the platform's relayer on the voter's behalf, so
     * nothing a client sends may grow without bound.
     *
     * Eight passkeys is more devices than anyone keeps. A WebAuthn credential
     * id is at most 1023 bytes by specification, and a sealed secret is an IV,
     * a recovery phrase and a tag, which fits comfortably in 512.
     */
    uint256 public constant MAX_VAULT_ENTRIES = 8;
    uint256 public constant MAX_CREDENTIAL_ID_BYTES = 1023;
    uint256 public constant MAX_VAULT_BLOB_BYTES = 512;

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

    event MemberVerified(uint256 indexed nullifier, uint256 indexed identityCommitment);
    event MemberRotated(
        uint256 indexed nullifier,
        uint256 indexed oldCommitment,
        uint256 indexed newCommitment
    );

    event VaultEntryAdded(uint256 indexed nullifier, bytes credentialId);
    event VaultEntryRemoved(uint256 indexed nullifier, bytes credentialId);
    event VaultReset(uint256 indexed nullifier, bytes credentialId);
    /// @dev The SIZE and not the blob: an event carrying the ciphertext would
    /// double what every change costs to store something already in storage.
    event PreferencesSet(uint256 indexed nullifier, uint256 size);
    event StatusRevoked(uint256 indexed statusIndex);
    event StatusRestored(uint256 indexed statusIndex);

    error NullifierAlreadyRegistered();
    error IdentityAlreadyVerified();
    error NullifierNotRegistered();
    error ZeroValue();
    error EmptyVaultEntry();
    error CredentialAlreadyPresent();
    error CredentialNotFound();
    error UnknownStatusIndex();
    error PreferencesTooLarge();
    error TooManyVaultEntries();
    error VaultEntryTooLarge();

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
        _checkVaultEntry(nullifier, credentialId, blob);

        VaultEntry[] storage entries = vaults[nullifier];
        if (entries.length >= MAX_VAULT_ENTRIES) revert TooManyVaultEntries();
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
        _checkVaultEntry(nullifier, credentialId, blob);

        delete vaults[nullifier];
        vaults[nullifier].push(
            VaultEntry({credentialId: credentialId, blob: blob, addedAt: uint64(block.timestamp)})
        );
        emit VaultReset(nullifier, credentialId);
    }

    /// @dev The checks both vault writes share.
    function _checkVaultEntry(
        uint256 nullifier,
        bytes calldata credentialId,
        bytes calldata blob
    ) private view {
        if (nullifier == 0) revert ZeroValue();
        if (credentialId.length == 0 || blob.length == 0) revert EmptyVaultEntry();
        if (credentialId.length > MAX_CREDENTIAL_ID_BYTES || blob.length > MAX_VAULT_BLOB_BYTES) {
            revert VaultEntryTooLarge();
        }
        if (!registeredNullifiers[nullifier]) revert NullifierNotRegistered();
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

    // ────────────────────────────────────────────────
    // Encrypted preferences
    // ────────────────────────────────────────────────

    /**
     * @notice Stores this human's sealed settings, replacing what was there.
     * @dev Owner-only for the reason the vault is: a voter has no wallet, by
     * design, because a per-voter sending address would publicly link their
     * enrollment to their ballot. Somebody has to submit on their behalf, and
     * the ciphertext means that somebody learns nothing by doing it.
     *
     * REPLACES RATHER THAN MERGES, because it cannot merge: it cannot read
     * what it holds. Two devices reconciling their settings is the browser's
     * problem, solved where the plaintext is, and an empty blob is how a voter
     * clears them.
     */
    function setPreferences(uint256 nullifier, bytes calldata blob) external onlyOwner {
        if (nullifier == 0) revert ZeroValue();
        if (!registeredNullifiers[nullifier]) revert NullifierNotRegistered();
        if (blob.length > MAX_PREFERENCES_BYTES) revert PreferencesTooLarge();

        preferences[nullifier] = blob;
        emit PreferencesSet(nullifier, blob.length);
    }

    /// @notice This human's sealed settings, empty when they have none.
    /// @dev Public, and nothing is lost by that: see the note on `preferences`.
    function preferencesOf(uint256 nullifier) external view returns (bytes memory) {
        return preferences[nullifier];
    }
}
