// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title OrganizerVault
 * @notice The organizer's tally master secret, sealed once per passkey.
 *
 * WHY THIS EXISTS. An organizer's Paillier tally key is re-derived from their
 * passkey's PRF output and stored nowhere, which is what keeps it off every
 * disk. The cost was that the PRF output of a DIFFERENT passkey is a different
 * key: an organizer who signed in on a second browser, or replaced a lost
 * authenticator, silently became unable to decrypt the results of every election
 * they had already created. Passkey sync hid it for some people and not others.
 *
 * So the secret the keys are derived from is now sealed under each passkey the
 * organizer registers, exactly as the voter's identity vault does, and the
 * sealed copies live here. The first copy seals the PRF output of the passkey
 * already in use, so every election created before this contract existed still
 * derives the same key it always did.
 *
 * WHAT IS PUBLIC. The ciphertext and the credential ids, to anyone. The blob
 * opens only with the PRF output of the passkey that sealed it, which never
 * leaves the authenticator, so publishing it costs confidentiality nothing and
 * buys an organizer the ability to lose a laptop.
 *
 * SELF-SERVICE AND OWNERLESS, like `OrganizerDomains`. The wallet IS the
 * organizer's on-chain identity: it owns their elections, so it is the right
 * key here and needs no operator to vouch for it. `msg.sender` writes only its
 * own subtree.
 */
contract OrganizerVault {
    struct Entry {
        bytes credentialId; // WebAuthn credential id, raw bytes
        bytes blob;         // AES-GCM ciphertext of the tally master secret
        uint64 addedAt;     // block timestamp, for showing a device list
    }

    /// @dev Organizer wallet => one sealed copy per passkey.
    mapping(address => Entry[]) private entries;

    event EntryAdded(address indexed organizer, bytes credentialId);
    event EntryRemoved(address indexed organizer, bytes credentialId);

    error EmptyCredentialId();
    error EmptyBlob();
    error EntryAlreadyExists();
    error EntryNotFound();
    error TooManyEntries();
    error BlobTooLarge();
    error CredentialIdTooLarge();
    error LastEntry();

    /**
     * @dev A ceiling so one address cannot grow an array that `entriesOf` then
     * has to return in one call. Nobody organizes from more than a handful of
     * devices, and the voter vault is capped for the same reason.
     */
    uint256 public constant MAX_ENTRIES = 8;
    /// @dev A sealed 32-byte secret is ~60 bytes with nonce and tag. Bounded well above.
    uint256 public constant MAX_BLOB_BYTES = 512;
    uint256 public constant MAX_CREDENTIAL_ID_BYTES = 256;

    /// @notice Seals another passkey into the caller's vault.
    function addEntry(bytes calldata credentialId, bytes calldata blob) external {
        if (credentialId.length == 0) revert EmptyCredentialId();
        if (credentialId.length > MAX_CREDENTIAL_ID_BYTES) revert CredentialIdTooLarge();
        if (blob.length == 0) revert EmptyBlob();
        if (blob.length > MAX_BLOB_BYTES) revert BlobTooLarge();

        Entry[] storage owned = entries[msg.sender];
        if (owned.length >= MAX_ENTRIES) revert TooManyEntries();
        if (_indexOf(owned, credentialId) != type(uint256).max) revert EntryAlreadyExists();

        owned.push(Entry({credentialId: credentialId, blob: blob, addedAt: uint64(block.timestamp)}));
        emit EntryAdded(msg.sender, credentialId);
    }

    /**
     * @notice Drops one passkey from the caller's vault.
     *
     * The last one cannot be dropped. Removing it would leave the organizer
     * with elections whose tally key nothing can re-derive, which is a loss no
     * later action can undo, so the contract refuses rather than trusting the
     * interface to ask twice.
     */
    function removeEntry(bytes calldata credentialId) external {
        Entry[] storage owned = entries[msg.sender];
        if (owned.length <= 1) revert LastEntry();

        uint256 i = _indexOf(owned, credentialId);
        if (i == type(uint256).max) revert EntryNotFound();

        owned[i] = owned[owned.length - 1];
        owned.pop();
        emit EntryRemoved(msg.sender, credentialId);
    }

    /// @notice Every sealed copy this organizer holds. Bounded by `MAX_ENTRIES`.
    function entriesOf(address organizer) external view returns (Entry[] memory) {
        return entries[organizer];
    }

    /// @notice How many passkeys can open this organizer's vault.
    function entryCount(address organizer) external view returns (uint256) {
        return entries[organizer].length;
    }

    /// @dev `type(uint256).max` when absent, so callers need no second lookup.
    function _indexOf(Entry[] storage owned, bytes calldata credentialId)
        private
        view
        returns (uint256)
    {
        bytes32 target = keccak256(credentialId);
        for (uint256 i = 0; i < owned.length; i++) {
            if (keccak256(owned[i].credentialId) == target) return i;
        }
        return type(uint256).max;
    }
}
