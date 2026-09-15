/**
 * The phrase is the root of a voter's identity, so everything here is about one
 * property: the same words must always rebuild the same identity, and anything
 * else must refuse rather than quietly build a different one. A phrase that
 * derives the wrong identity does not fail, it produces a stranger, and the
 * voter finds out when the election they enrolled in says they are not a member.
 */
import { describe, it, expect } from 'vitest';

import {
  generateRecoveryPhrase,
  identityFromPhrase,
  isValidPhrase,
  normalizePhrase,
  phraseWordList,
  unknownWords,
} from './recoveryPhrase';

describe('recovery phrase', () => {
  it('generates twelve words from the list', () => {
    const phrase = generateRecoveryPhrase();
    const words = phrase.split(' ');
    expect(words).toHaveLength(12);
    expect(words.every(w => phraseWordList().includes(w))).toBe(true);
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateRecoveryPhrase()));
    expect(seen.size).toBe(50);
  });

  it('has a word list that is a power of two, so the draw is uniform', () => {
    // The generator masks a random byte with 0x7f. Any other length would make
    // some words likelier than others and quietly cost entropy.
    expect(phraseWordList()).toHaveLength(128);
    expect(new Set(phraseWordList()).size).toBe(128);
  });
});

describe('normalising what a person actually types', () => {
  it('survives capitals, padding and doubled spaces', () => {
    const phrase = generateRecoveryPhrase();
    const mangled = '  ' + phrase.toUpperCase().split(' ').join('   ') + '\n';
    expect(normalizePhrase(mangled)).toBe(phrase);
  });

  it('derives the same identity however it was typed', async () => {
    const phrase = generateRecoveryPhrase();
    const a = await identityFromPhrase(phrase);
    const b = await identityFromPhrase(' ' + phrase.toUpperCase().replace(/ /g, '  ') + ' ');
    expect(a.commitment).toBe(b.commitment);
  });
});

describe('deriving the identity', () => {
  it('is deterministic: the same words rebuild the same voter', async () => {
    const phrase = generateRecoveryPhrase();
    const a = await identityFromPhrase(phrase);
    const b = await identityFromPhrase(phrase);
    expect(a.commitment).toBe(b.commitment);
  });

  it('gives different phrases different identities', async () => {
    const a = await identityFromPhrase(generateRecoveryPhrase());
    const b = await identityFromPhrase(generateRecoveryPhrase());
    expect(a.commitment).not.toBe(b.commitment);
  });

  it('refuses a phrase that is not one of ours', async () => {
    await expect(identityFromPhrase('not even close')).rejects.toThrow(/recovery phrase/);
    // Right length, wrong vocabulary: the case a typo produces.
    const twelveWrongWords = Array.from({ length: 12 }, () => 'zzz').join(' ');
    await expect(identityFromPhrase(twelveWrongWords)).rejects.toThrow(/recovery phrase/);
  });

  it('refuses the right words in the wrong number', async () => {
    const words = generateRecoveryPhrase().split(' ');
    await expect(identityFromPhrase(words.slice(0, 11).join(' '))).rejects.toThrow();
    await expect(identityFromPhrase([...words, words[0]].join(' '))).rejects.toThrow();
  });
});

describe('pointing at the typo', () => {
  it('names the words that are not in the list', () => {
    const words = generateRecoveryPhrase().split(' ');
    words[3] = 'bananna';
    expect(unknownWords(words.join(' '))).toEqual(['bananna']);
  });

  it('says nothing when every word is known', () => {
    expect(unknownWords(generateRecoveryPhrase())).toEqual([]);
  });

  it('accepts a valid phrase and rejects a mistyped one', () => {
    const phrase = generateRecoveryPhrase();
    expect(isValidPhrase(phrase)).toBe(true);
    expect(isValidPhrase(phrase.replace(/^\w+/, 'bananna'))).toBe(false);
  });
});
