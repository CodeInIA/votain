import { describe, it, expect } from 'vitest';

import { ballotKey, hasDuplicateNames, collidesWithBlankVote, withDistinctNames } from './ballotNames';

/**
 * The rule is about what a voter SEES, not what an organizer typed. Each case
 * below is a pair that renders identically on a ballot while comparing as two
 * different strings, which is how a voter ends up picking the option they did
 * not mean while the tally stays perfectly correct.
 */

describe('when two ballot options are the same option', () => {
  it('ignores case, which nobody reads a name by', () => {
    expect(hasDuplicateNames(['Sergio', 'sergio'])).toBe(true);
  });

  it('ignores the Unicode form of an accent', () => {
    // Precomposed e-acute against e plus a combining accent. Same pixels.
    const precomposed = 'José';
    const decomposed = 'José';
    expect(precomposed).not.toBe(decomposed);
    expect(hasDuplicateNames([precomposed, decomposed])).toBe(true);
  });

  it('ignores runs of whitespace, which HTML collapses anyway', () => {
    expect(hasDuplicateNames(['Ana  Lopez', 'Ana Lopez'])).toBe(true);
    expect(hasDuplicateNames([' Ana Lopez ', 'Ana Lopez'])).toBe(true);
  });

  it('keeps accented and unaccented names apart, because they are different names', () => {
    // Stripping accents here would refuse a ballot an organizer is entitled to
    // put up.
    expect(hasDuplicateNames(['Jose', 'José'])).toBe(false);
  });

  it('leaves genuinely different names alone', () => {
    expect(hasDuplicateNames(['Sergio', 'Ana', 'Lucia'])).toBe(false);
    expect(hasDuplicateNames([])).toBe(false);
  });

  it('does not count empty entries as colliding with each other', () => {
    // Half-filled rows are the "too few candidates" error's business, not this
    // one's, and reporting them here would name the wrong problem.
    expect(hasDuplicateNames(['', '  ', 'Ana'])).toBe(false);
  });

  it('normalises to a key that is never shown', () => {
    expect(ballotKey('  Ana   Lopez ')).toBe('ana lopez');
  });
});

describe('the blank option every ballot gets for free', () => {
  it('catches a candidate given its exact name', () => {
    expect(collidesWithBlankVote('Voto en blanco / Abstención', 'Voto en blanco / Abstención')).toBe(true);
    expect(collidesWithBlankVote('voto en blanco / abstención', 'Voto en blanco / Abstención')).toBe(true);
  });

  it('leaves a merely similar name alone', () => {
    expect(collidesWithBlankVote('Voto en blanco de Ana', 'Voto en blanco / Abstención')).toBe(false);
  });
});

describe('withDistinctNames', () => {
  it('returns the very same array when nothing collides', () => {
    // Identity, not just equality: the caller uses it to decide whether to warn,
    // and an untouched ballot must cost nothing.
    const options = [{ name: 'Ana' }, { name: 'Lucia' }];
    expect(withDistinctNames(options)).toBe(options);
  });

  it('tells colliding options apart by the position the vote is cast by', () => {
    const out = withDistinctNames([{ name: 'Sergio' }, { name: 'Ana' }, { name: 'sergio' }]);
    expect(out.map(o => o.name)).toEqual(['Sergio (#1)', 'Ana', 'sergio (#3)']);
  });

  it('catches a candidate colliding with the blank option appended after it', () => {
    // The case the wizard cannot see: the blank option is added at read time,
    // in the reader's language, so this is where that collision surfaces.
    const out = withDistinctNames([{ name: 'Blank Vote / Abstain' }, { name: 'Blank Vote / Abstain' }]);
    expect(out.map(o => o.name)).toEqual(['Blank Vote / Abstain (#1)', 'Blank Vote / Abstain (#2)']);
  });

  it('keeps every other field on the options it rewrites', () => {
    const out = withDistinctNames([
      { name: 'Ana', id: 'option-0', votes: 7, isWinner: true },
      { name: 'ana', id: 'option-1', votes: 3 },
    ]);
    expect(out[0]).toMatchObject({ id: 'option-0', votes: 7, isWinner: true });
    expect(out[1]).toMatchObject({ id: 'option-1', votes: 3 });
  });
});
