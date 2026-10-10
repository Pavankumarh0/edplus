/**
 * npm run demo:phone -- +919876543210 [USN] [--live]
 *
 * Points a demo student's parent contact at a real number — almost always your
 * own — so a live Vobiz call rings a phone you are holding.
 *
 * This matters more than it looks. The seeded parent numbers are INVENTED.
 * Dialling one during a demo would ring a stranger who has no idea why an
 * automated voice is talking to them about a student. Run this first, every
 * time, before switching TELEPHONY_PROVIDER to vobiz.
 */
import { normalisePhone, type ParentLanguage } from '@eduplus/core';
import { getDb, getParentContact, getStudent } from '@eduplus/core/repositories';
import { assertSafeTarget, describeTarget } from './lib/admin';
import { DEMO_STUDENTS } from './lib/demo-data';

const args = process.argv.slice(2);
const allowLive = args.includes('--live');
const positional = args.filter((a) => !a.startsWith('--'));

const rawPhone = positional[0];
const usn = (positional[1] ?? DEMO_STUDENTS.critical).toUpperCase();
const language = (positional[2] ?? '') as ParentLanguage | '';

async function main() {
  if (!rawPhone) {
    console.error(
      '\nUsage: npm run demo:phone -- +919876543210 [USN] [language] [--live]\n' +
        `\nDefaults to ${DEMO_STUDENTS.critical} (the headline demo student).\n` +
        'Language is a Sarvam code such as en-IN, hi-IN, kn-IN, te-IN.\n',
    );
    process.exitCode = 1;
    return;
  }

  assertSafeTarget(allowLive);

  const phone = normalisePhone(rawPhone);
  if (!phone) {
    console.error(
      `\n"${rawPhone}" is not a number we can dial. Use E.164, e.g. +919876543210.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const student = await getStudent(db, usn);
  if (!student) {
    console.error(`\nNo student with USN ${usn}.\n`);
    process.exitCode = 1;
    return;
  }

  const existing = await getParentContact(db, usn);

  await db
    .collection('students')
    .doc(usn)
    .collection('private')
    .doc('parent')
    .set(
      {
        name: existing?.name ?? 'Parent/Guardian',
        phone,
        preferredLanguage: language || existing?.preferredLanguage || 'en-IN',
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

  await db.collection('students').doc(usn).set({ hasParentContact: true }, { merge: true });

  // Masked, because this script's whole job is handling a real phone number
  // and echoing it in full to a terminal during a demo helps nobody.
  const masked = `${phone.slice(0, 3)}${'•'.repeat(Math.max(0, phone.length - 5))}${phone.slice(-2)}`;

  console.log(`\nUpdated ${describeTarget()}`);
  console.log(`  student   ${student.name} (${usn})`);
  console.log(`  parent    ${existing?.name ?? 'Parent/Guardian'}`);
  console.log(`  phone     ${masked}`);
  console.log(`  language  ${language || existing?.preferredLanguage || 'en-IN'}`);
  console.log('\nA call to this student will now ring that number.\n');
}

main().catch((error) => {
  console.error('\nFailed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
