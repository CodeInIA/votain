import { describe, it, expect } from 'vitest';
import { fingerprintOf } from './CommitmentFingerprint';

/**
 * What a member's mark has to do.
 *
 * It replaced two hex characters inside a circle, which is 256 possible labels:
 * past about twenty distinct voters two members were more likely than not to
 * carry the same one, so the mark stopped telling them apart at exactly the size
 * where a list starts needing it to.
 */

const A = '0x1844bcb77e809a492b85180ef66ec4fc4418e0d7a0df91d26038fa11643185f9';
const B = '0x25013b50140fd68f2aa1c5302add5f823130779c22e052cad5e2cc87535adfe4';

/** The two characters the old badge showed, for the comparison below. */
const oldBadge = (commitment: string) => commitment.slice(2, 4).toUpperCase();

describe('fingerprintOf', () => {
  it('gives the same member the same mark every time', () => {
    expect(fingerprintOf(A)).toEqual(fingerprintOf(A));
    // Case is not part of the identity: the same commitment written either way
    // is the same member, and must not appear twice in a list under two marks.
    expect(fingerprintOf(A.toUpperCase().replace('0X', '0x'))).toEqual(fingerprintOf(A));
  });

  it('gives different members different marks', () => {
    const a = fingerprintOf(A);
    const b = fingerprintOf(B);
    expect(a.cells).not.toEqual(b.cells);
    expect(a.hue).not.toBe(b.hue);
  });

  it('tells apart commitments the old badge could not', () => {
    // Same first two characters, different members. This is the case the circle
    // of initials drew identically.
    const x = '0x18aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const y = '0x18bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    expect(oldBadge(x)).toBe(oldBadge(y));
    expect(fingerprintOf(x).cells).not.toEqual(fingerprintOf(y).cells);
  });

  it('is symmetric down the middle, which is what makes it recognisable', () => {
    const { cells } = fingerprintOf(A);
    const grid = 5;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < grid; col++) {
        expect(cells[row * grid + col]).toBe(cells[row * grid + (grid - 1 - col)]);
      }
    }
  });

  it('spreads real commitments out instead of clustering them', () => {
    // Forty members, the size at which the old two characters were near certain
    // to collide.
    const many = Array.from({ length: 40 }, (_, i) => `0x${i.toString(16).padStart(64, 'a')}`);
    const marks = new Set(many.map(c => JSON.stringify(fingerprintOf(c))));
    expect(marks.size).toBe(40);
  });
});
