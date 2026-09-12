// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

/**
 * @title OrganizerDomains
 * @notice The domains an organizer says they publish elections under.
 *
 * A CLAIM AND NOT A CREDENTIAL, which is what makes this contract so small.
 * Domain control is whatever DNS answers right now, so it cannot be read off a
 * chain and is never taken from here: a reader resolves
 * `_votain.<domain>` and checks that the TXT record names this address. The
 * claim only says which domains to go and ask about.
 *
 * That is why writes are self-service and need no owner. Claiming a domain you
 * do not control gets you nothing, because the DNS lookup that follows will not
 * back you up, and the organizer's own wallet is already the address the record
 * has to name. Requiring an operator to attest would add a trusted party to a
 * statement nobody has to trust.
 *
 * It replaces a JSON file on the issuer's disk. Not for confidentiality, since
 * a claim is public either way, but because an auditor looking at a past
 * election could otherwise only ask that server what had been claimed and when.
 */
contract OrganizerDomains {
    /// @dev Organizer address => the domains they claim, lowercase.
    mapping(address => string[]) private claims;

    event DomainClaimed(address indexed organizer, string domain);
    event DomainReleased(address indexed organizer, string domain);

    error EmptyDomain();
    error DomainAlreadyClaimed();
    error DomainNotClaimed();
    error TooManyDomains();

    /**
     * @dev A ceiling so one address cannot grow an unbounded array that
     * `domainsOf` then has to return in one call. Nobody legitimately publishes
     * elections under more than a handful.
     */
    uint256 public constant MAX_DOMAINS = 16;

    /// @notice Claims a domain for the caller. Lowercase it before sending:
    /// comparison here is byte for byte, and DNS is case insensitive.
    function claim(string calldata domain) external {
        if (bytes(domain).length == 0) revert EmptyDomain();

        string[] storage owned = claims[msg.sender];
        if (owned.length >= MAX_DOMAINS) revert TooManyDomains();

        bytes32 target = keccak256(bytes(domain));
        for (uint256 i = 0; i < owned.length; i++) {
            if (keccak256(bytes(owned[i])) == target) revert DomainAlreadyClaimed();
        }

        owned.push(domain);
        emit DomainClaimed(msg.sender, domain);
    }

    /// @notice Drops a claim. Says nothing about DNS, which the organizer
    /// changes separately and which is what a reader actually checks.
    function release(string calldata domain) external {
        string[] storage owned = claims[msg.sender];
        bytes32 target = keccak256(bytes(domain));

        for (uint256 i = 0; i < owned.length; i++) {
            if (keccak256(bytes(owned[i])) == target) {
                owned[i] = owned[owned.length - 1];
                owned.pop();
                emit DomainReleased(msg.sender, domain);
                return;
            }
        }
        revert DomainNotClaimed();
    }

    /// @notice Every domain this address claims. Bounded by `MAX_DOMAINS`.
    function domainsOf(address organizer) external view returns (string[] memory) {
        return claims[organizer];
    }

    /// @notice Whether this address claims this exact domain.
    function claimsDomain(address organizer, string calldata domain) external view returns (bool) {
        string[] storage owned = claims[organizer];
        bytes32 target = keccak256(bytes(domain));

        for (uint256 i = 0; i < owned.length; i++) {
            if (keccak256(bytes(owned[i])) == target) return true;
        }
        return false;
    }
}
