/**
 * Organizer domain verification endpoints.
 *
 * Adding a domain needs no signature: the DNS record authorises it. You can
 * only register a domain whose `_votain` TXT record already names your address,
 * so claiming someone else's domain fails the check before anything is stored.
 * Removal DOES need one, otherwise anyone could drop a competitor's domain from
 * the lookup list out of spite.
 *
 * `GET /organizer/domain-status` is public and unauthenticated on purpose: it is
 * what a voter's browser calls to confirm the domain shown on an election. The
 * lookup happens here rather than in their browser so the organization's own
 * servers never learn that someone is reading their election.
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyMessage } from 'ethers';
import {
  checkDomain,
  expectedRecord,
  isAddress,
  normalizeDomain,
  type CheckOutcome,
} from '../organizer/domains.js';

const router = Router();

/** Each miss costs a DNS lookup, so cap what one caller can trigger. */
const checkLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Short-lived cache so a page full of elections does not hammer the resolver.
 * Deliberately brief: removing the TXT record is the revocation, and a
 * revocation nobody sees for an hour is not much of a revocation.
 */
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; outcome: CheckOutcome }>();

async function cachedCheck(address: string, domain: string): Promise<CheckOutcome> {
  const key = `${address.toLowerCase()}|${domain}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.outcome;

  const outcome = await checkDomain(address, domain);
  // A failed lookup says nothing about the domain, so caching it would turn a
  // transient resolver blip into five minutes of wrong answers.
  if (outcome.status !== 'lookup_failed') cache.set(key, { at: Date.now(), outcome });
  return outcome;
}

function readPair(source: Record<string, unknown>): { address: string; domain: string } | null {
  const address = typeof source.address === 'string' ? source.address : '';
  const rawDomain = typeof source.domain === 'string' ? source.domain : '';
  if (!isAddress(address)) return null;
  const domain = normalizeDomain(rawDomain);
  return domain ? { address, domain } : null;
}

// ────────────────────────────────────────────────
// GET /organizer/domain-record: what to publish
// ────────────────────────────────────────────────
router.get('/organizer/domain-record', (req: Request, res: Response) => {
  const pair = readPair(req.query as Record<string, unknown>);
  if (!pair) return res.status(400).json({ error: 'A valid address and domain are required' });
  return res.status(200).json(expectedRecord(pair.address, pair.domain));
});

// ────────────────────────────────────────────────
// GET /organizer/domain-status: live check of one pair (public)
// ────────────────────────────────────────────────
router.get('/organizer/domain-status', checkLimiter, async (req: Request, res: Response) => {
  const pair = readPair(req.query as Record<string, unknown>);
  if (!pair) return res.status(400).json({ error: 'A valid address and domain are required' });

  const outcome = await cachedCheck(pair.address, pair.domain);
  return res.status(200).json({ domain: pair.domain, ...outcome });
});

// ────────────────────────────────────────────────
// POST /organizer/domains: verify, and store nothing
// ────────────────────────────────────────────────
router.post('/organizer/domains', checkLimiter, async (req: Request, res: Response) => {
  const pair = readPair(req.body as Record<string, unknown>);
  if (!pair) return res.status(400).json({ error: 'A valid address and domain are required' });

  const outcome = await checkDomain(pair.address, pair.domain);
  if (outcome.status !== 'verified') {
    // 409, not 400: the request is well formed, the DNS just does not agree yet.
    // The client distinguishes the outcomes to say what to fix.
    return res.status(409).json({ domain: pair.domain, ...outcome });
  }

  // Verified, and that is the whole answer. The claim itself is recorded by the
  // organizer's wallet in `OrganizerDomains`, so this server never holds a list
  // that an auditor would have to trust it about.
  return res.status(200).json({ domain: pair.domain, status: 'verified' });
});

/**
 * The two routes that used to live here are gone with the file they served.
 *
 * `GET /organizer/domains` read the claim list off this server's disk; the
 * browser reads `OrganizerDomains.domainsOf` from the chain instead and then
 * asks `/organizer/domain-status` about each one, which is the check that
 * actually decides anything.
 *
 * `DELETE /organizer/domains` needed a signed message to prove the caller owned
 * the address. Releasing a claim is a transaction from that address now, so the
 * proof is the transaction and there is nothing left for this server to check.
 *
 * `POST /organizer/domains` stays because a browser cannot resolve a TXT
 * record, but it no longer writes anything: it answers whether DNS agrees, and
 * the organizer's own wallet records the claim.
 */

export default router;
