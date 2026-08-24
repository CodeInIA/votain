/**
 * Organizer domain verification (client side).
 *
 * The badge a voter sees is a DOMAIN, not a checkmark, and that is the whole
 * point. A checkmark is an opaque claim that only means something if you trust
 * whoever granted it; a domain carries its own evidence, and anyone can repeat
 * the DNS lookup that backs it. `elecciones.gob.es` says what it is, while
 * `votacion-oficial-gob.com` looks exactly as suspicious as it deserves, where a
 * checkmark beside the same name would launder it.
 *
 * The lookup runs on our backend rather than in the voter's browser so that the
 * organization's own infrastructure never learns who is reading their election.
 */

const BACKEND = import.meta.env.VITE_BACKEND_URL as string | undefined;

function requireBackend(): string {
  if (!BACKEND) throw new Error("VITE_BACKEND_URL is not configured");
  return BACKEND;
}

export type DomainStatus =
  | "verified"
  /** Nothing published at `_votain.<domain>` yet, or DNS still propagating. */
  | "no_record"
  /** A record exists but names a different wallet. */
  | "address_mismatch"
  /** The lookup itself failed. Says nothing about the domain either way. */
  | "lookup_failed";

export interface DomainCheck {
  domain: string;
  status: DomainStatus;
  /** Addresses found in DNS, when they were not ours. */
  found?: string[];
  error?: string;
}

export interface DomainRecord {
  name: string;
  value: string;
}

/** The exact TXT record to publish, ready to copy. */
export async function fetchDomainRecord(address: string, domain: string): Promise<DomainRecord> {
  const url = new URL(`${requireBackend()}/api/organizer/domain-record`);
  url.searchParams.set("address", address);
  url.searchParams.set("domain", domain);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not build the record: ${res.status}`);
  return (await res.json()) as Promise<DomainRecord>;
}

/** Every domain this organizer has registered, each re-checked live. */
export async function fetchOrganizerDomains(address: string): Promise<DomainCheck[]> {
  const url = new URL(`${requireBackend()}/api/organizer/domains`);
  url.searchParams.set("address", address);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not read domains: ${res.status}`);
  const body = (await res.json()) as { domains: DomainCheck[] };
  return body.domains;
}

/**
 * Verifies and registers a domain. Resolves with the outcome rather than
 * throwing on a failed check: "not published yet" is the expected first answer
 * while DNS propagates, not an error to report as a broken request.
 */
export async function addOrganizerDomain(address: string, domain: string): Promise<DomainCheck> {
  const res = await fetch(`${requireBackend()}/api/organizer/domains`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, domain }),
  });
  if (res.status === 400) throw new Error("That does not look like a domain name");
  if (!res.ok && res.status !== 409) throw new Error(`Verification failed: ${res.status}`);
  return (await res.json()) as Promise<DomainCheck>;
}

/** The message the organizer signs to authorise a removal. */
export function removalMessage(domain: string): string {
  return `Votain: remove domain ${domain}`;
}

export async function removeOrganizerDomain(
  address: string,
  domain: string,
  signature: string,
): Promise<void> {
  const res = await fetch(`${requireBackend()}/api/organizer/domains`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, domain, signature }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Could not remove the domain: ${res.status}`);
  }
}

/**
 * Checks the domain recorded on an election.
 *
 * An election keeps the domain it was created under, so a verification that
 * lapses later does not rewrite the past: the badge is struck through and the
 * voter sees both what it was and what it is now. A `lookup_failed` must never
 * strike a badge, since it says nothing about the domain.
 */
export async function checkElectionDomain(
  organizerAddress: string,
  domain: string,
): Promise<DomainCheck> {
  const url = new URL(`${requireBackend()}/api/organizer/domain-status`);
  url.searchParams.set("address", organizerAddress);
  url.searchParams.set("domain", domain);
  const res = await fetch(url);
  if (!res.ok) return { domain, status: "lookup_failed" };
  return (await res.json()) as Promise<DomainCheck>;
}
