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

import { Contract, type Signer } from "ethers";
import { addresses } from "./deployments";
import { getReadProvider } from "./contracts";

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
/**
 * The domains this organizer claims, each re-checked live.
 *
 * The claim list comes from `OrganizerDomains` on chain, and the verdict from
 * DNS through the backend, because a browser cannot resolve a TXT record. Two
 * sources on purpose: the chain says what to ask about, DNS says what is true.
 * Nothing in between is trusted, and neither answer is stored anywhere.
 */
export async function fetchOrganizerDomains(address: string): Promise<DomainCheck[]> {
  const claimed = await fetchClaimedDomains(address);
  return Promise.all(
    claimed.map(async domain => ({ ...(await checkOneDomain(address, domain)), domain })),
  );
}

/** Just the claims, straight from the contract. */
export async function fetchClaimedDomains(address: string): Promise<string[]> {
  if (!addresses.organizerDomains) return [];
  const { Contract } = await import("ethers");
  const contract = new Contract(
    addresses.organizerDomains,
    ["function domainsOf(address organizer) view returns (string[])"],
    getReadProvider(),
  );
  return (await contract.domainsOf(address)) as string[];
}

/** The live DNS verdict for one pair. */
async function checkOneDomain(address: string, domain: string): Promise<DomainCheck> {
  const url = new URL(`${requireBackend()}/api/organizer/domain-status`);
  url.searchParams.set("address", address);
  url.searchParams.set("domain", domain);
  const res = await fetch(url);
  if (!res.ok) return { domain, status: "lookup_failed" };
  return (await res.json()) as DomainCheck;
}

/**
 * Verifies a domain, then records the claim from the organizer's own wallet.
 *
 * Two steps, and only the first needs this project's server: it resolves the
 * TXT record, which a browser cannot. The claim itself is a transaction the
 * organizer signs, so nobody has to be online for them to state where they
 * publish, and an auditor reads it from the chain rather than from us.
 *
 * Resolves with the outcome rather than throwing on a failed check: "not
 * published yet" is the expected first answer while DNS propagates, not an
 * error to report as a broken request.
 */
export async function addOrganizerDomain(
  signer: Signer,
  address: string,
  domain: string,
): Promise<DomainCheck> {
  const res = await fetch(`${requireBackend()}/api/organizer/domains`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, domain }),
  });
  if (res.status === 400) throw new Error("That does not look like a domain name");
  if (!res.ok && res.status !== 409) throw new Error(`Verification failed: ${res.status}`);

  const outcome = (await res.json()) as DomainCheck;
  if (outcome.status !== "verified") return outcome;

  await (await domainsContract(signer).claim(outcome.domain)).wait();
  return outcome;
}

/** Drops a claim. The transaction is the authorisation; nothing else signs. */
export async function removeOrganizerDomain(signer: Signer, domain: string): Promise<void> {
  await (await domainsContract(signer).release(domain)).wait();
}

function domainsContract(signer: Signer): Contract {
  if (!addresses.organizerDomains) {
    throw new Error("OrganizerDomains address not configured");
  }
  return new Contract(
    addresses.organizerDomains,
    ["function claim(string domain)", "function release(string domain)"],
    signer,
  );
}

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
