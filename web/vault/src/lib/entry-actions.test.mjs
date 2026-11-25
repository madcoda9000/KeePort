import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Consts, Kdbx, KdbxCredentials, KdbxUuid, ProtectedValue } from 'kdbxweb';
import { deleteEntries, emptyRecycleBin, isExpired } from './entry-actions.ts';
import { listFolders } from './groups.ts';
import { customIconUrl, faviconUrl, openableUrl } from './icons.ts';
import { createEntry, listEntries } from './kdbx.ts';
import { generatePassword, passwordEntropyBits, strengthLabel, CHARACTER_SETS } from './password.ts';

// Use the browser DOM code path rather than kdbxweb's legacy xmldom constructor options.
Object.assign(globalThis, { DOMParser, XMLSerializer });
if (!globalThis.crypto) Object.assign(globalThis, { crypto: webcrypto });

const fields = { title: 'Example', username: '', password: '', url: '', notes: '', otp: '' };

/**
 * Creates an ephemeral vault using the AES KDF.
 * @param withRecycleBin - Whether the vault uses a recycle bin.
 */
function testVault(withRecycleBin = true) {
  const db = Kdbx.create(new KdbxCredentials(ProtectedValue.fromString('public test password')), 'Actions test');
  db.setKdf(Consts.KdfId.Aes);
  if (!withRecycleBin) db.meta.recycleBinEnabled = false;
  return db;
}

/**
 * Returns the titles of all entries in the recycle bin.
 * @param db - The vault.
 */
function binTitles(db) {
  const bin = db.getGroup(db.meta.recycleBinUuid);
  return bin ? [...bin.allEntries()].map(/**
   * Selects the title.
   * @param entry - One entry.
   */ (entry) => entry.fields.get('Title')).sort() : [];
}

/** Verifies that deleting moves entries into the recycle bin first and removes them permanently from there. */
test('deletes entries into the recycle bin, then permanently, and empties the bin', () => {
  const db = testVault();
  const a = createEntry(db, { ...fields, title: 'A' });
  const b = createEntry(db, { ...fields, title: 'B' });
  const c = createEntry(db, { ...fields, title: 'C' });
  assert.deepEqual(deleteEntries(db, [a.uuid.id, b.uuid.id]), { recycled: 2, removed: 0 });
  assert.deepEqual(binTitles(db), ['A', 'B']);
  assert.ok(listEntries(db).find(/**
   * Finds entry A.
   * @param view - One entry view.
   */ (view) => view.title === 'A').hidden, 'recycled entries are hidden from all entries');

  assert.deepEqual(deleteEntries(db, [a.uuid.id]), { recycled: 0, removed: 1 });
  assert.ok(db.deletedObjects.some(/**
   * Finds the deletion record.
   * @param item - One deleted object.
   */ (item) => item.uuid.equals(a.uuid)));

  // A deleted folder inside the recycle bin, as KeePass leaves it after deleting a folder.
  const nested = db.createGroup(db.getGroup(db.meta.recycleBinUuid), 'Old folder');
  createEntry(db, { ...fields, title: 'D' }, nested.uuid.id);
  assert.equal(emptyRecycleBin(db), 2);
  assert.deepEqual(binTitles(db), []);
  assert.equal(db.getGroup(nested.uuid), undefined);
  assert.equal(listEntries(db).length, 1);
  assert.equal(listEntries(db)[0].entry, c);
  assert.throws(/** Deletes an unknown entry. */ () => deleteEntries(db, ['missing']), /no longer exist/);
});

/** Verifies that a vault without recycle bin deletes permanently and does not get one. */
test('deletes permanently when the recycle bin is turned off', () => {
  const db = testVault(false);
  const entry = createEntry(db, fields);
  assert.deepEqual(deleteEntries(db, [entry.uuid.id]), { recycled: 0, removed: 1 });
  assert.equal(db.meta.recycleBinEnabled, false, 'the recycle bin stays off');
  assert.deepEqual(binTitles(db), [], 'nothing was moved into the existing recycle bin folder');
  assert.ok(db.deletedObjects.some(/**
   * Finds the deletion record.
   * @param item - One deleted object.
   */ (item) => item.uuid.equals(entry.uuid)));
  assert.equal(listFolders(db)[0].totalEntryCount, 0);
});

/** Verifies the expiry check. */
test('marks entries whose expiry date has passed', () => {
  const db = testVault();
  const entry = createEntry(db, { ...fields, expires: '2020-01-01' });
  const now = new Date(2026, 10, 25);
  assert.equal(isExpired(entry, now), true);
  entry.times.expires = false;
  assert.equal(isExpired(entry, now), false);
  const later = createEntry(db, { ...fields, expires: '2030-01-01' });
  assert.equal(isExpired(later, now), false);
  assert.equal(listEntries(db).find(/**
   * Finds the later entry.
   * @param view - One entry view.
   */ (view) => view.entry === later).expired, false);
});

/** Verifies which entry URLs produce a favicon address or a link, and that custom KDBX icons become data URLs. */
test('derives favicon and link addresses and reads custom icons', () => {
  assert.equal(faviconUrl('https://github.com/login'), 'https://github.com/favicon.ico');
  assert.equal(faviconUrl('mail.example.org'), 'https://mail.example.org/favicon.ico');
  assert.equal(faviconUrl('http://Bank.Example.de:8443/x'), 'https://bank.example.de/favicon.ico');
  assert.equal(faviconUrl('http://192.168.0.1'), null);
  assert.equal(faviconUrl('nas'), null);
  assert.equal(faviconUrl('javascript:alert(1)'), null);
  assert.equal(faviconUrl('ftp://files.example.com'), null);
  assert.equal(faviconUrl(''), null);
  assert.equal(openableUrl('github.com'), 'https://github.com/');
  assert.equal(openableUrl('http://192.168.0.1'), 'http://192.168.0.1/');
  assert.equal(openableUrl('javascript:alert(1)'), null);

  const db = testVault();
  const entry = createEntry(db, fields);
  assert.equal(customIconUrl(db, entry), null);
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3);
  const id = KdbxUuid.random();
  db.meta.customIcons.set(id.id, { data: png.buffer });
  entry.customIcon = id;
  assert.equal(customIconUrl(db, entry), `data:image/png;base64,${Buffer.from(png).toString('base64')}`);
  assert.equal(listEntries(db)[0].iconUrl, customIconUrl(db, entry));
});

/** Verifies the password generator's length, character groups, look-alike filter and strength estimate. */
test('generates passwords with every chosen group and estimates their strength', () => {
  for (let i = 0; i < 50; i += 1) {
    const password = generatePassword({ length: 20, sets: ['lower', 'upper', 'digits', 'symbols'], avoidLookAlikes: true });
    assert.equal(password.length, 20);
    for (const set of ['lower', 'upper', 'digits', 'symbols']) {
      assert.ok([...password].some(/**
       * Checks for a character of the group.
       * @param char - One character.
       */ (char) => CHARACTER_SETS[set].includes(char)), `contains ${set}`);
    }
    assert.ok(![...password].some(/**
     * Detects a look-alike character.
     * @param char - One character.
     */ (char) => 'Il1O0o'.includes(char)));
  }
  assert.equal(generatePassword({ length: 3, sets: ['digits'], avoidLookAlikes: false }).length, 8, 'minimum length');
  assert.match(generatePassword({ length: 12, sets: ['digits'], avoidLookAlikes: false }), /^\d{12}$/);
  assert.throws(/** Generates without groups. */ () => generatePassword({ length: 12, sets: [], avoidLookAlikes: false }), /at least one/);
  const bits = passwordEntropyBits({ length: 20, sets: ['lower', 'upper', 'digits', 'symbols'], avoidLookAlikes: false });
  assert.ok(bits > 120);
  assert.equal(strengthLabel(bits), 'Very strong');
  assert.equal(strengthLabel(passwordEntropyBits({ length: 8, sets: ['digits'], avoidLookAlikes: false })), 'Weak');
});
