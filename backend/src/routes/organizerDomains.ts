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
  listClaimedDomains,
  addClaimedDomain,
  removeClaimedDomain,
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
// GET /organizer/domains: this organizer's domains, each re-checked live
// ────────────────────────────────────────────────
router.get('/organizer/domains', checkLimiter, async (req: Request, res: Response) => {
  const address = typeof req.query.address === 'string' ? req.query.address : '';
  if (!isAddress(address)) return res.status(400).json({ error: 'A valid address is required' });

  const domains = listClaimedDomains(address);
  const checked = await Promise.all(
    domains.map(async domain => ({ domain, ...(await cachedCheck(address, domain)) })),
  );
  return res.status(200).json({ domains: checked });
});

// ────────────────────────────────────────────────
// POST /organizer/domains: verify and remember
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

  const domains = addClaimedDomain(pair.address, pair.domain);
  return res.status(200).json({ domain: pair.domain, status: 'verified', domains });
});

// ────────────────────────────────────────────────
// DELETE /organizer/domains: signature required
// ────────────────────────────────────────────────
export function removalMessage(domain: string): string {
  return `Votain: remove domain ${domain}`;
}

router.delete('/organizer/domains', (req: Request, res: Response) => {
  const pair = readPair(req.body as Record<string, unknown>);
  const signature = typeof (req.body as { signature?: unknown }).signature === 'string'
    ? (req.body as { signature: string }).signature
    : '';
  if (!pair) return res.status(400).json({ error: 'A valid address and domain are required' });
  if (!signature) return res.status(400).json({ error: 'signature is required' });

  let signer: string;
  try {
    signer = verifyMessage(removalMessage(pair.domain), signature);
  } catch {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  if (signer.toLowerCase() !== pair.address.toLowerCase()) {
    return res.status(401).json({ error: 'Signature does not match the address' });
  }

  const domains = removeClaimedDomain(pair.address, pair.domain);
  return res.status(200).json({ domains });
});

export default router;
