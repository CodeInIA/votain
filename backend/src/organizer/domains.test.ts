import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { promises as dns } from 'node:dns';

const { checkDomain, expectedRecord, normalizeDomain } = await import('./domains.js');

const ADDRESS = '0xa5216ed9ab68fceb8cd8dbb0a47dc18740e946ce';
const CHECKSUMMED = '0xa5216eD9AB68FCEb8CD8dBb0A47Dc18740e946Ce';
const OTHER = '0x000000000000000000000000000000000000dead';

/** Makes resolveTxt answer with the given records (each an array of chunks). */
function resolvesTo(records: string[][]): void {
  mock.method(dns, 'resolveTxt', async () => records);
}

function failsWith(code: string): void {
  mock.method(dns, 'resolveTxt', async () => {
    const error = new Error(code) as NodeJS.ErrnoException;
    error.code = code;
    throw error;
  });
}

// Nothing to clean between tests any more: this module holds no state, which
// is the point of the claim list having moved to `OrganizerDomains`.
beforeEach(() => {
  mock.restoreAll();
});

describe('DNS domain check', () => {
  test('verifies a record naming this address', async () => {
    resolvesTo([[`v=votain1; address=${ADDRESS}`]]);
    assert.deepEqual(await checkDomain(ADDRESS, 'gob.es'), { status: 'verified' });
  });

  test('queries the underscore subdomain, not the apex', async () => {
    const seen: string[] = [];
    mock.method(dns, 'resolveTxt', async (name: string) => {
      seen.push(name);
      return [[`v=votain1; address=${ADDRESS}`]];
    });
    await checkDomain(ADDRESS, 'gob.es');
    assert.deepEqual(seen, ['_votain.gob.es']);
  });

  test('joins a TXT value split across chunks', async () => {
    // Values over 255 bytes arrive as several strings for ONE record. Parsing
    // them separately would silently fail to match.
    const padding = 'x'.repeat(240);
    resolvesTo([['v=votain1; address=' + ADDRESS.slice(0, 20), ADDRESS.slice(20) + '; pad=' + padding]]);
    assert.deepEqual(await checkDomain(ADDRESS, 'gob.es'), { status: 'verified' });
  });

  test('accepts a match among several records at the same name', async () => {
    resolvesTo([
      ['v=spf1 include:_spf.google.com ~all'],
      [`v=votain1; address=${OTHER}`],
      [`v=votain1; address=${ADDRESS}`],
    ]);
    assert.deepEqual(await checkDomain(ADDRESS, 'gob.es'), { status: 'verified' });
  });

  test('ignores EIP-55 checksum casing on both sides', async () => {
    resolvesTo([[`v=votain1; address=${CHECKSUMMED}`]]);
    assert.deepEqual(await checkDomain(CHECKSUMMED.toLowerCase(), 'gob.es'), { status: 'verified' });
    assert.deepEqual(await checkDomain(CHECKSUMMED, 'gob.es'), { status: 'verified' });
  });

  test('reports the addresses found when none is ours', async () => {
    resolvesTo([[`v=votain1; address=${OTHER}`]]);
    const outcome = await checkDomain(ADDRESS, 'gob.es');
    assert.equal(outcome.status, 'address_mismatch');
    assert.deepEqual(outcome.status === 'address_mismatch' ? outcome.found : [], [OTHER]);
  });

  test('treats an unknown version tag as no record', async () => {
    resolvesTo([[`v=votain2; address=${ADDRESS}`]]);
    assert.deepEqual(await checkDomain(ADDRESS, 'gob.es'), { status: 'no_record' });
  });

  test('treats unrelated TXT records as no record', async () => {
    resolvesTo([['google-site-verification=abc'], ['v=DMARC1; p=none']]);
    assert.deepEqual(await checkDomain(ADDRESS, 'gob.es'), { status: 'no_record' });
  });

  test('NXDOMAIN and empty answers read as not published yet', async () => {
    failsWith('ENOTFOUND');
    assert.deepEqual(await checkDomain(ADDRESS, 'gob.es'), { status: 'no_record' });
    failsWith('ENODATA');
    assert.deepEqual(await checkDomain(ADDRESS, 'gob.es'), { status: 'no_record' });
  });

  test('a resolver failure is NOT reported as not published', async () => {
    // The difference matters: "no record" tells the organizer to go publish one,
    // and would wrongly strike a badge on an election whose DNS is fine.
    failsWith('SERVFAIL');
    const outcome = await checkDomain(ADDRESS, 'gob.es');
    assert.equal(outcome.status, 'lookup_failed');
  });
});

describe('Domain input handling', () => {
  test('normalizes case and a trailing dot', () => {
    assert.equal(normalizeDomain('  Elecciones.GOB.es.  '), 'elecciones.gob.es');
  });

  test('rejects anything that is not a bare hostname', () => {
    for (const bad of [
      'https://gob.es',
      'gob.es/path',
      'gob.es:8080',
      '*.gob.es',
      'localhost',
      '',
      '-gob.es',
      'gob-.es',
    ]) {
      assert.equal(normalizeDomain(bad), null, `should reject ${bad}`);
    }
  });

  test('builds the record the organizer has to publish', () => {
    assert.deepEqual(expectedRecord(CHECKSUMMED, 'gob.es'), {
      name: '_votain.gob.es',
      value: `v=votain1; address=${ADDRESS}`,
    });
  });
});
