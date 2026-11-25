import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Consts, Kdbx, KdbxCredentials, ProtectedValue } from 'kdbxweb';
import { checkPasswords, countInRange, sha1Hex } from './breach.ts';
import { readHiddenColumns, writeHiddenColumns } from './column-prefs.ts';
import { storeEntryIcon } from './icons.ts';
import { createEntry, listEntries } from './kdbx.ts';
import { buildReport } from './security-report.ts';

// Use the browser DOM code path rather than kdbxweb's legacy xmldom constructor options.
Object.assign(globalThis, { DOMParser, XMLSerializer });
if (!globalThis.crypto) Object.assign(globalThis, { crypto: webcrypto });

/**
 * Computes the upper-case SHA-1 hex hash with Node, as a reference.
 * @param text - The text to hash.
 */
const sha1 = (text) => createHash('sha1').update(text).digest('hex').toUpperCase();

/** Verifies k-anonymity: only five hash characters leave, padding is ignored, matches are counted. */
test('checks passwords with k-anonymity and counts matches', async () => {
  assert.equal(await sha1Hex('password'), sha1('password'));
  const leaked = sha1('password');
  const requests = [];
  /**
   * Simulates the range API with a real hit and padding lines.
   * @param prefix - The requested prefix.
   */
  const fakeRange = async (prefix) => {
    requests.push(prefix);
    const lines = ['0000000000000000000000000000000000A:0', `${'F'.repeat(35)}:0`];
    if (prefix === leaked.slice(0, 5)) lines.push(`${leaked.slice(5)}:9545824`);
    return lines.join('\r\n');
  };
  const progress = [];
  const results = await checkPasswords(['password', 'Vq7#pL2!xZ9$wR4m', 'password', ''], /**
   * Records the progress.
   * @param done - Prefixes done.
   * @param total - All prefixes.
   */ (done, total) => progress.push(`${done}/${total}`), fakeRange);
  assert.equal(results.get('password'), 9545824);
  assert.equal(results.get('Vq7#pL2!xZ9$wR4m'), 0);
  assert.equal(requests.length, 2, 'each prefix once, empty and duplicate passwords skipped');
  assert.ok(requests.every(/**
   * Checks that only five hex characters were sent.
   * @param prefix - One requested prefix.
   */ (prefix) => /^[0-9A-F]{5}$/.test(prefix)));
  assert.deepEqual(progress.at(-1), '2/2');
  assert.equal(countInRange('ABC:0\n', 'ABC'), 0, 'padding entries do not count');
});

/** Verifies that the report lists breached entries with their counts. */
test('adds breached entries to the security report', () => {
  const db = Kdbx.create(new KdbxCredentials(ProtectedValue.fromString('public test password')), 'Breach test');
  db.setKdf(Consts.KdfId.Aes);
  const fields = { title: 'A', username: 'u', password: 'Vq7#pL2!xZ9$wR4m', url: '', notes: '', otp: '' };
  createEntry(db, fields);
  createEntry(db, { ...fields, title: 'B', password: 'Unique-Pass-8472-Kx!' });
  const views = listEntries(db);
  const report = buildReport(views, new Date(), new Map([['Vq7#pL2!xZ9$wR4m', 12]]));
  const a = views.find(/**
   * Finds entry A.
   * @param view - One entry view.
   */ (view) => view.title === 'A');
  assert.deepEqual([...report.issues.breached], [a.id]);
  assert.equal(report.breachCounts.get(a.id), 12);
  assert.equal(buildReport(views, new Date()).issues.breached.size, 0, 'nothing without a check');
});

/** Verifies that icons are stored once and set on entries. */
test('stores website icons in the vault and reuses identical ones', async () => {
  const db = Kdbx.create(new KdbxCredentials(ProtectedValue.fromString('public test password')), 'Icon test');
  db.setKdf(Consts.KdfId.Aes);
  const fields = { title: 'A', username: '', password: '', url: '', notes: '', otp: '' };
  const a = createEntry(db, fields);
  const b = createEntry(db, { ...fields, title: 'B' });
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 7, 7);
  const first = storeEntryIcon(db, a, png, 'github.com');
  const second = storeEntryIcon(db, b, png.slice(), 'github.com');
  assert.equal(first, second);
  assert.equal(db.meta.customIcons.size, 1);
  assert.equal(a.customIcon.id, first);
  const reopened = await Kdbx.load((new Uint8Array(await db.save())).slice().buffer, db.credentials);
  assert.ok(listEntries(reopened).every(/**
   * Checks that the icon survives saving.
   * @param view - One entry view.
   */ (view) => view.iconUrl?.startsWith('data:image/png;base64,')));
});

/** Verifies reading and writing the hidden columns, also with broken or missing storage. */
test('remembers hidden columns in this browser', () => {
  const values = new Map();
  const storage = {
    /**
     * Reads a value.
     * @param key - The key.
     */
    getItem: (key) => values.get(key) ?? null,
    /**
     * Writes a value.
     * @param key - The key.
     * @param value - The value.
     */
    setItem: (key, value) => values.set(key, value)
  };
  assert.deepEqual([...readHiddenColumns(storage)], []);
  writeHiddenColumns(new Set(['totp', 'modified']), storage);
  assert.deepEqual([...readHiddenColumns(storage)].sort(), ['modified', 'totp']);
  values.set('keeport-hidden-columns', '["title","bogus","website"]');
  assert.deepEqual([...readHiddenColumns(storage)], ['website'], 'unknown columns ignored, title cannot be hidden');
  values.set('keeport-hidden-columns', '{broken');
  assert.deepEqual([...readHiddenColumns(storage)], []);
  assert.deepEqual([...readHiddenColumns(null)], []);
  const failing = {
    /** Fails like blocked storage. */
    getItem: () => { throw new Error('blocked'); },
    /** Fails like blocked storage. */
    setItem: () => { throw new Error('blocked'); }
  };
  assert.deepEqual([...readHiddenColumns(failing)], []);
  writeHiddenColumns(new Set(['totp']), failing);
});
