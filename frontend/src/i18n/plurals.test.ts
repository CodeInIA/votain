import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the pluralisation of every string that interpolates `{{count}}`.
 *
 * The bug this exists for: `discover.results_count_plural` was written in
 * i18next's JSON v3 format, which this version (v26, JSON v4) does not read. It
 * silently fell back to the unsuffixed key, so the results line said "13
 * elección" in Spanish and "13 election" in English, and nothing failed. A
 * translation that is quietly ignored is worse than a missing one.
 *
 * Two rules follow, and neither can be satisfied by eyeballing thirteen files:
 * no legacy suffixes, and one form per plural category the language actually
 * uses. That last part is why this asks `Intl.PluralRules` rather than assuming
 * two forms: Spanish and French add "many", Russian has four, Arabic six, and
 * Chinese, Japanese and Korean have exactly one.
 */

const DIR = join(__dirname, 'locales');
const LOCALES = readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));

const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

type Flat = Record<string, string>;

function flatten(value: unknown, prefix = ''): Flat {
  if (typeof value === 'string') return { [prefix]: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<Flat>(
    (acc, [k, v]) => Object.assign(acc, flatten(v, prefix ? `${prefix}.${k}` : k)),
    {},
  );
}

const load = (locale: string): Flat =>
  flatten(JSON.parse(readFileSync(join(DIR, `${locale}.json`), 'utf8')));

/** Categories a locale genuinely uses, probed across the interesting ranges. */
function categoriesFor(locale: string): string[] {
  const rules = new Intl.PluralRules(locale);
  const probes = [0, 1, 2, 3, 5, 11, 21, 100, 101, 1000, 1_000_000, 1.5];
  return [...new Set(probes.map(n => rules.select(n)))];
}

const stripSuffix = (key: string): string =>
  key.replace(new RegExp(`_(${PLURAL_CATEGORIES.join('|')})$`), '');

describe('plural translations', () => {
  it('has no keys in the legacy i18next v3 "_plural" format', () => {
    const offenders: string[] = [];
    for (const locale of LOCALES) {
      for (const key of Object.keys(load(locale))) {
        if (key.endsWith('_plural')) offenders.push(`${locale}: ${key}`);
      }
    }
    // v26 reads JSON v4, where the suffixes are the CLDR category names. A
    // "_plural" key is dead weight that reads as a translation and is not one.
    expect(offenders).toEqual([]);
  });

  it('gives every count-bearing key one form per category its language uses', () => {
    // English is the reference for WHICH keys take a count.
    const english = load('en');
    const countKeys = new Set(
      Object.entries(english)
        .filter(([, value]) => value.includes('{{count}}'))
        .map(([key]) => stripSuffix(key)),
    );
    expect(countKeys.size).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const locale of LOCALES) {
      const flat = load(locale);
      for (const base of countKeys) {
        for (const category of categoriesFor(locale)) {
          const suffixed = `${base}_${category}`;
          if (typeof flat[suffixed] !== 'string') missing.push(`${locale}: ${suffixed}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('never leaves an unsuffixed form beside the suffixed ones', () => {
    // i18next would resolve the bare key ahead of the plural forms in some
    // configurations, which is exactly how the singular went missing.
    const english = load('en');
    const countKeys = new Set(
      Object.entries(english)
        .filter(([, value]) => value.includes('{{count}}'))
        .map(([key]) => stripSuffix(key)),
    );

    const offenders: string[] = [];
    for (const locale of LOCALES) {
      const flat = load(locale);
      for (const base of countKeys) {
        if (typeof flat[base] === 'string') offenders.push(`${locale}: ${base}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('actually distinguishes singular from plural where the language does', () => {
    // The end the rules above are a means to. Languages with a single category
    // are expected to read identically and are not asked to differ.
    const english = load('en');
    const countKeys = [
      ...new Set(
        Object.entries(english)
          .filter(([, value]) => value.includes('{{count}}'))
          .map(([key]) => stripSuffix(key)),
      ),
    ];

    const suspicious: string[] = [];
    for (const locale of LOCALES) {
      if (categoriesFor(locale).length === 1) continue;
      const flat = load(locale);
      for (const base of countKeys) {
        const one = flat[`${base}_one`];
        const other = flat[`${base}_other`];
        if (one === undefined || other === undefined) continue;
        // Compared with the number removed: "1 election" and "13 elections"
        // differ in the noun, which is the part that has to change.
        if (one.replace(/\{\{count\}\}/g, '') === other.replace(/\{\{count\}\}/g, '')) {
          suspicious.push(`${locale}: ${base}`);
        }
      }
    }

    // Not every phrase inflects in every language ("y {{count}} más" is the
    // same either way in Spanish), so this reports rather than forbids. The
    // list is pinned so a NEW key cannot join it unnoticed.
    expect(suspicious.sort()).toMatchInlineSnapshot(`
      [
        "de: election_mgmt.tally_voters",
        "en: country_picker.more_results",
        "en: voter_elections.urgent",
        "es: country_picker.more_results",
        "fr: country_picker.more_results",
        "hi: country_picker.more_results",
        "hi: discover.results_count",
        "hi: election_mgmt.tally_voters",
        "hi: gas.votes_remaining",
        "hi: voter_elections.urgent",
        "it: voter_elections.urgent",
        "nl: country_picker.more_results",
        "pt: country_picker.more_results",
        "ru: country_picker.more_results",
      ]
    `);
  });
});
