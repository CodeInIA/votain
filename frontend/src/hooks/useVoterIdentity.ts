import { useCallback, useState } from 'react';
import { getOrCreateIdentity, isIdentityLoaded } from '../lib/semaphore';

/**
 * Whether the voter's Semaphore identity can be read, and how to ask for it.
 *
 * In PRF mode the secret is never stored at rest, so a page reload leaves it
 * unavailable until a passkey tap re-derives it. Every screen that shows a
 * voter their own ballots has to answer the same two questions: can I read them
 * now, and how do I offer the tap. This is that answer, once.
 *
 * The tap is ALWAYS deliberate. Deriving on mount would work, but it means a
 * browser security prompt nobody asked for the instant a page opens, and one
 * dismissed by reflex looks like the app failing. Opening the page is intent
 * enough to be offered the tap, not intent enough to have it taken.
 *
 * `live` is the chain-configured flag: with no chain there is nothing to unlock
 * and the seed data is already readable, so the hook reports ready.
 */
export interface VoterIdentityState {
  /** The identity is readable, so a lookup can see ballots cast anywhere. */
  ready: boolean;
  /** A passkey prompt is open. */
  unlocking: boolean;
  /** Prompts for the passkey. Resolves to whether the identity became readable. */
  unlock: () => Promise<boolean>;
}

export function useVoterIdentity(live: boolean): VoterIdentityState {
  const [ready, setReady] = useState(() => !live || isIdentityLoaded());
  const [unlocking, setUnlocking] = useState(false);

  const unlock = useCallback(async () => {
    setUnlocking(true);
    try {
      await getOrCreateIdentity();
      setReady(true);
      return true;
    } catch {
      // Cancelled, or no passkey reachable here. The offer stays where it was.
      return false;
    } finally {
      setUnlocking(false);
    }
  }, []);

  return { ready, unlocking, unlock };
}
