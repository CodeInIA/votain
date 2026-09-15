/**
 * The names a passkey is created under.
 *
 * These are not cosmetic. WebAuthn writes them into the credential at creation
 * and offers no way to rename one afterwards, so whatever ships is what every
 * passkey created by that build says in its owner's password manager, forever.
 *
 * They are also the only thing distinguishing one from another in that list.
 * The app lets one person hold both roles and several devices, and deleting the
 * wrong entry is not recoverable: the organizer's PRF is what their tally keys
 * derive from, and the voter's is what opens their identity.
 *
 * The expectations are built from the same Date rather than written out, because
 * the label is in LOCAL time and a literal would only pass in the timezone it was
 * written in.
 */
import { describe, it, expect } from 'vitest';

import { passkeyLabel } from './passkeyPrf';

const DAY = new Date('2026-09-12T10:30:00Z');

const pad = (n: number): string => String(n).padStart(2, '0');
/** What the local clock says, the way the label spells it. */
const stamp = (d: Date) => {
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { day, hhmm: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};

describe('passkey labels', () => {
  it('gives each role a name of its own', () => {
    const { day, hhmm } = stamp(DAY);
    const suffix = `${day}-${hhmm.replace(':', '')}`;
    expect(passkeyLabel('voter', DAY).name).toBe(`votain-voter-${suffix}`);
    expect(passkeyLabel('organizer', DAY).name).toBe(`votain-organizer-${suffix}`);
  });

  it('carries the date, so two of the same role can be told apart', () => {
    const first = passkeyLabel('voter', new Date('2026-09-12T10:00:00Z'));
    const second = passkeyLabel('voter', new Date('2026-11-03T10:00:00Z'));
    expect(first.name).not.toBe(second.name);
    expect(second.name).toContain(stamp(new Date('2026-11-03T10:00:00Z')).day);
  });

  it('carries the time as well, for two made on the same day', () => {
    // The case this exists for: clearing site data and enrolling again, twice
    // in one afternoon. With only the date, both rows read identically and the
    // person has to guess which to delete.
    const morning = new Date('2026-09-12T08:05:00Z');
    const evening = new Date('2026-09-12T19:41:00Z');

    expect(passkeyLabel('voter', morning).name).not.toBe(passkeyLabel('voter', evening).name);
    expect(passkeyLabel('voter', evening).displayName).toContain(stamp(evening).hhmm);
  });

  it('pads the clock, so the names line up and sort', () => {
    const early = new Date(2026, 0, 2, 3, 4); // local by construction
    expect(passkeyLabel('voter', early).name).toBe('votain-voter-2026-01-02-0304');
    expect(passkeyLabel('voter', early).displayName).toBe('Votain voter (2026-01-02 03:04)');
  });

  it('shows the moment to a person too, not only in the machine name', () => {
    // The display name is what most password managers actually render.
    const { day, hhmm } = stamp(DAY);
    expect(passkeyLabel('organizer', DAY).displayName).toBe(`Votain organizer (${day} ${hhmm})`);
  });

  it('never gives two roles the same label at the same moment', () => {
    const voter = passkeyLabel('voter', DAY);
    const organizer = passkeyLabel('organizer', DAY);
    expect(voter.name).not.toBe(organizer.name);
    expect(voter.displayName).not.toBe(organizer.displayName);
  });

  it('keeps the name ASCII and the display name readable', () => {
    for (const role of ['voter', 'organizer'] as const) {
      const label = passkeyLabel(role, DAY);
      // Stored by the authenticator and rendered by an OS password manager,
      // neither of which is ours to test. No colon in the machine name.
      expect(label.name).toMatch(/^[a-z0-9-]+$/);
      expect(label.displayName).toMatch(/^Votain /);
    }
  });

  it('uses a date format that sorts and reads the same everywhere', () => {
    // Not a locale format: this string is written into the credential and read
    // by people in thirteen languages.
    expect(passkeyLabel('voter', DAY).name).toMatch(/-\d{4}-\d{2}-\d{2}-\d{4}$/);
  });
});
