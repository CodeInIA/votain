/**
 * Mints the enrolment tag key for an epoch, and prints what to put in `.env`.
 *
 * WHY THIS EXISTS RATHER THAN A DERIVATION. Forward secrecy cannot be derived;
 * it has to be thrown away. A key derived from some longer-lived master can
 * always be recomputed from that master, so deleting it deletes nothing. These
 * are independent random keys precisely so that deleting one is final.
 *
 * WHEN TO RUN IT. Before the first election of a new UTC month is deployed. The
 * epoch of an election is the month it was created in, read from the contract's
 * immutable `createdAt`, and a missing epoch makes the server refuse to issue a
 * tag rather than substitute another key.
 *
 * WHEN TO DELETE ONE. Once every election created in that epoch has closed
 * enrolment, nothing will ever recompute its tags again: the contract already
 * holds the ones it accepted. Deleting the key then puts those enrolments
 * beyond reach of everyone, this platform included, which is the only way the
 * link stops existing rather than merely being kept.
 *
 *   node --import tsx scripts/mint-tag-key.ts            # this month
 *   node --import tsx scripts/mint-tag-key.ts 2026-10    # a named epoch
 */
import { randomBytes } from 'node:crypto';

const pedida = process.argv[2];
const ahora = new Date();
const epoca =
  pedida ?? `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`;

if (!/^\d{4}-\d{2}$/.test(epoca)) {
  console.error(`Not an epoch: ${epoca}. Expected YYYY-MM, as UTC.`);
  process.exit(1);
}

const clave = randomBytes(32).toString('hex');

/**
 * Merged into whatever is configured, never replacing it. Printing only the new
 * pair would invite pasting it over the others, which retires every earlier
 * epoch by accident and stops enrolment dead in any election still open.
 */
let existentes: Record<string, string> = {};
const configuradas = process.env.ENROLMENT_TAG_KEYS;
if (configuradas) {
  try {
    existentes = JSON.parse(configuradas) as Record<string, string>;
  } catch {
    console.error('ENROLMENT_TAG_KEYS is set but is not valid JSON; fix it before minting.');
    process.exit(1);
  }
}

if (existentes[epoca]) {
  console.error(
    `Epoch ${epoca} already has a key. Replacing it would change the tag of every ` +
      'election created that month, and hand a second leaf to anybody still enrolling.',
  );
  process.exit(1);
}

console.log(`\nMinted a tag key for ${epoca}. Put this whole line in .env:\n`);
console.log(`ENROLMENT_TAG_KEYS=${JSON.stringify({ ...existentes, [epoca]: clave })}\n`);
console.log('Keep the earlier epochs until their elections have closed enrolment.');
console.log('Delete one only when no election created in it can still enrol.\n');
