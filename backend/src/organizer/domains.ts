/**
 * Organizer domain verification through DNS.
 *
 * An organizer proves control of a domain by publishing a TXT record naming
 * their wallet address. Anyone can repeat that lookup, which is the point: the
 * badge a voter sees is not "Votain vouched for this", it is "this address is
 * published in the DNS of gob.es", and they can check it themselves without
 * trusting this server.
 *
 * DNS is the source of truth, and this module stores nothing. Every check is
 * live, so REMOVING THE TXT RECORD IS THE REVOCATION and it takes effect
 * immediately. There is no credential to revoke and no expiry to manage.
 *
 * The list of domains worth looking up for an address used to be a JSON file
 * here. It never carried the trust, only the question, and it lives in the
 * `OrganizerDomains` contract now: written by the organizer's own wallet, so
 * an auditor can read what was claimed and when without asking this server,
 * and nobody has to be online for an organizer to state where they publish.
 * What stays here is the one thing a browser cannot do for itself.
 *
 * The record lives under an underscore-prefixed subdomain (RFC 8552) rather
 * than the apex, which is crowded with SPF, DMARC and assorted vendor
 * verification tokens.
 *
 *   _votain.example.org.  IN TXT  "v=votain1; address=0xabc..."
 */
import { promises as dns } from 'node:dns';

export const RECORD_PREFIX = '_votain';
export const RECORD_VERSION = 'votain1';

/**
 * Rejects anything that is not plausibly a hostname before it reaches a
 * resolver: no schemes, no paths, no ports, no wildcards.
 */
export function normalizeDomain(raw: string): string | null {
  const domain = raw.trim().toLowerCase().replace(/\.$/, '');
  if (domain.length === 0 || domain.length > 253) return null;
  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(domain)) return null;
  return domain;
}

export function isAddress(raw: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(raw);
}

/** The exact record the organizer has to publish, ready to copy. */
export function expectedRecord(address: string, domain: string): { name: string; value: string } {
  return {
    name: `${RECORD_PREFIX}.${domain}`,
    value: `v=${RECORD_VERSION}; address=${address.toLowerCase()}`,
  };
}

export type CheckOutcome =
  /** The TXT record names this address. */
  | { status: 'verified' }
  /** No _votain record at all: not published yet, or still propagating. */
  | { status: 'no_record' }
  /** A record exists but names other addresses. */
  | { status: 'address_mismatch'; found: string[] }
  /** The lookup itself failed (network, SERVFAIL). Says nothing either way. */
  | { status: 'lookup_failed'; error: string };

/** Addresses named by every `v=votain1` record found at `_votain.<domain>`. */
function parseAddresses(records: string[][]): string[] {
  return (
    records
      // A TXT string over 255 bytes arrives split into chunks, one array per
      // record. Join before parsing or long values silently fail to match.
      .map(chunks => chunks.join(''))
      .map(value => {
        const fields = new Map(
          value
            .split(';')
            .map(part => part.trim().split('='))
            .filter((kv): kv is [string, string] => kv.length === 2)
            .map(([k, v]) => [k.trim().toLowerCase(), v.trim()]),
        );
        return fields.get('v') === RECORD_VERSION ? fields.get('address') : undefined;
      })
      .filter((a): a is string => a !== undefined && isAddress(a))
      .map(a => a.toLowerCase())
  );
}

/**
 * Live DNS check of one address/domain pair.
 *
 * Every record at the name is considered, not just the first: one domain can
 * carry several `_votain` records when an organization runs more than one
 * wallet. Comparison is lowercased, since EIP-55 checksum casing is copied
 * wrong more often than it is copied right.
 */
export async function checkDomain(address: string, domain: string): Promise<CheckOutcome> {
  let records: string[][];
  try {
    records = await dns.resolveTxt(`${RECORD_PREFIX}.${domain}`);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    // NXDOMAIN and an empty answer are the same thing to the organizer: the
    // record is not visible yet. Anything else is a real lookup failure and
    // must NOT be reported as "not published".
    if (code === 'ENOTFOUND' || code === 'ENODATA') return { status: 'no_record' };
    return { status: 'lookup_failed', error: code ?? String(error) };
  }

  const found = parseAddresses(records);
  if (found.length === 0) return { status: 'no_record' };
  if (found.includes(address.toLowerCase())) return { status: 'verified' };
  return { status: 'address_mismatch', found };
}

