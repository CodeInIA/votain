/**
 * Pending eligibility sessions.
 *
 * The attribute check is a round trip through a phone: this server hands the
 * voter a challenge, the voter's wallet app posts a proof back on its own
 * connection, and only then can the voter's browser collect an attestation.
 * Something has to remember, between those two requests, which challenge
 * belonged to whom.
 *
 * IN MEMORY, DELIBERATELY. This backend has no database, and this is the rare
 * case where that costs nothing. A session is worthless fifteen minutes after
 * it is created and is consumed once; the only effect of a restart is that a
 * voter mid-scan has to scan again. Persisting it would mean writing a record
 * that links a World ID nullifier to an in-flight passport check, which is
 * exactly the kind of durable trace this project exists to avoid.
 *
 * The session id doubles as the Self `userIdentifier`, which is why it is a
 * UUID: the SDK is configured with `userIdentifierType: 'uuid'` and rejects
 * anything else.
 */
import { randomUUID } from 'node:crypto';

export const SESSION_TTL_MS = 15 * 60 * 1000;

/** Bound so a flood of unfinished sessions cannot grow the heap without limit. */
const MAX_SESSIONS = 5_000;

export type SessionStatus = 'pending' | 'passed' | 'failed';

export interface EligibilitySession {
  id: string;
  election: string;
  /** World ID nullifier of the voter who opened it. Only this voter may claim it. */
  voter: string;
  status: SessionStatus;
  /** Machine-readable failure cause, for the UI to translate. */
  reason?: string;
  createdAt: number;
}

const sessions = new Map<string, EligibilitySession>();

function sweep(now: number): void {
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

export function createSession(election: string, voter: string): EligibilitySession {
  const now = Date.now();
  sweep(now);

  // Oldest first, because Map preserves insertion order and every entry is
  // inserted with the timestamp it carries.
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next();
    if (oldest.done) break;
    sessions.delete(oldest.value);
  }

  const session: EligibilitySession = {
    id: randomUUID(),
    election: election.toLowerCase(),
    voter,
    status: 'pending',
    createdAt: now,
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): EligibilitySession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return undefined;
  }
  return session;
}

export function markSession(id: string, status: SessionStatus, reason?: string): void {
  const session = getSession(id);
  if (!session) return;
  session.status = status;
  session.reason = reason;
}

/**
 * Removes a session once its attestation has been issued.
 *
 * One attestation per scan. Without this, a voter who passed the check could
 * keep coming back for fresh signatures over different commitments, which the
 * per-human deduplication on chain would eventually stop but only after the
 * first one had already landed.
 */
export function consumeSession(id: string): void {
  sessions.delete(id);
}

/** Test seam: sessions are process-local, so tests need a way to start clean. */
export function resetSessions(): void {
  sessions.clear();
}
