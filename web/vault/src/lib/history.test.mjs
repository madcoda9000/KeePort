import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Consts, Kdbx, KdbxCredentials, ProtectedValue } from 'kdbxweb';
import { addAttachment } from './attachments.ts';
import { deleteVersion, describeChanges, listHistory, restoreVersion, trimHistory } from './history.ts';
import { createEntry, listEntries, saveEntryUpdate } from './kdbx.ts';
import { listTags, setEntryTags, tagError } from './tags.ts';

// Use the browser DOM code path rather than kdbxweb's legacy xmldom constructor options.
Object.assign(globalThis, { DOMParser, XMLSerializer });

const base = { title: 'Mail', username: 'anna', password: 'first secret', url: '', notes: '', otp: '' };

/** Creates an ephemeral vault using the AES KDF. */
function testVault() {
  const db = Kdbx.create(new KdbxCredentials(ProtectedValue.fromString('public test password')), 'History test');
  db.setKdf(Consts.KdfId.Aes);
  return db;
}

/**
 * Accepts a write without a server.
 * @param bytes - The encrypted vault.
 */
const accept = async (bytes) => bytes;

/**
 * Saves edits of an existing entry through the normal save path.
 * @param db - The vault.
 * @param entry - The entry.
 * @param edits - The changed fields.
 */
async function edit(db, entry, edits) {
  await saveEntryUpdate(db, entry, { ...base, ...edits }, entry.binaries, accept);
}

/** Verifies that the history lists states newest first and names changes without values. */
test('lists the history with the changed parts but never their values', async () => {
  const db = testVault();
  const entry = createEntry(db, base);
  await edit(db, entry, { password: 'second secret', url: 'https://mail.example.org' });
  await edit(db, entry, { password: 'second secret', url: 'https://mail.example.org', customFields: [{ name: 'PIN', value: '1234', protected: true }], tags: ['work'] });

  const items = listHistory(entry);
  assert.equal(items.length, 3);
  assert.equal(items[0].index, null, 'current state first');
  assert.deepEqual(items[0].changes, ['PIN', 'Tags']);
  assert.deepEqual(items[1].changes, ['Password', 'Website']);
  assert.equal(items[2].changes, null, 'oldest version');
  const text = JSON.stringify(items.map(/**
   * Keeps the visible parts of an item.
   * @param item - One history item.
   */ (item) => item.changes));
  assert.ok(!text.includes('secret') && !text.includes('1234'));
  assert.deepEqual(describeChanges(entry, entry), []);
});

/** Verifies restoring like KeePass: the current state is kept as a version, identity and creation time stay. */
test('restores a version, keeps the current state in the history and survives a reload', async () => {
  const db = testVault();
  const entry = createEntry(db, base);
  const created = entry.times.creationTime;
  const uuid = entry.uuid.id;
  await saveEntryUpdate(db, entry, base, addAttachment(new Map(), new File(['old'], 'old.txt')), accept);
  await edit(db, entry, { password: 'changed later' });
  const historyBefore = entry.history.length;
  const target = entry.history.length - 1; // the version with old.txt and the first password

  restoreVersion(db, entry, target);
  assert.equal(entry.uuid.id, uuid);
  assert.equal(entry.times.creationTime, created);
  assert.equal(entry.fields.get('Password').getText(), 'first secret');
  assert.deepEqual([...entry.binaries.keys()], ['old.txt']);
  assert.equal(entry.history.length, historyBefore + 1);
  assert.equal(entry.history.at(-1).fields.get('Password').getText(), 'changed later', 'replaced state kept');

  const reopened = await Kdbx.load((new Uint8Array(await db.save())).slice().buffer, db.credentials);
  const [view] = listEntries(reopened);
  assert.equal(view.password, 'first secret');
  assert.equal(view.entry.history.length, historyBefore + 1);

  deleteVersion(entry, 0);
  assert.equal(entry.history.length, historyBefore);
  assert.throws(/** Restores a missing version. */ () => restoreVersion(db, entry, 99), /no longer exists/);
});

/** Verifies trimming by the vault's item and size limits, including unlimited. */
test('trims the history to the vault limits when saving', async () => {
  const db = testVault();
  db.meta.historyMaxItems = 3;
  const entry = createEntry(db, base);
  for (let i = 0; i < 6; i += 1) await edit(db, entry, { password: `secret ${i}` });
  assert.equal(entry.history.length, 3);
  assert.equal(entry.history[0].fields.get('Password').getText(), 'secret 2', 'oldest versions removed first');

  db.meta.historyMaxItems = -1;
  for (let i = 0; i < 4; i += 1) await edit(db, entry, { password: `more ${i}` });
  assert.equal(entry.history.length, 7, 'unlimited');

  db.meta.historyMaxSize = 200;
  trimHistory(db, entry);
  assert.ok(entry.history.length < 7 && entry.history.length >= 1, 'size limit removes the oldest versions');
});

/** Verifies tag validation, counting and changing tags on several entries. */
test('validates, counts and changes tags on several entries', async () => {
  const db = testVault();
  const a = createEntry(db, { ...base, title: 'A' });
  const b = createEntry(db, { ...base, title: 'B' });
  assert.match(tagError(' ', []), /Enter a tag/);
  assert.match(tagError('a,b', []), /commas/);
  assert.match(tagError('Work', ['work']), /already set/);
  assert.match(tagError('x'.repeat(65), []), /at most 64/);
  assert.equal(tagError('  team   ops ', []), null);

  assert.equal(setEntryTags(db, [a.uuid.id, b.uuid.id], ['work', 'team ops'], []), 2);
  assert.equal(a.history.length, 1, 'tag changes create a version');
  assert.equal(setEntryTags(db, [a.uuid.id, b.uuid.id], ['WORK'], []), 0, 'no duplicate in other case');
  assert.equal(setEntryTags(db, [b.uuid.id], [], ['Work']), 1);
  assert.deepEqual(b.tags, ['team ops']);
  assert.throws(/** Adds an invalid tag. */ () => setEntryTags(db, [a.uuid.id], ['a;b'], []), /commas/);
  assert.deepEqual(listTags(listEntries(db)), [{ tag: 'team ops', count: 2 }, { tag: 'work', count: 1 }]);

  const reopened = await Kdbx.load((new Uint8Array(await db.save())).slice().buffer, db.credentials);
  const titles = Object.fromEntries(listEntries(reopened).map(/**
   * Maps titles to tags.
   * @param view - One entry view.
   */ (view) => [view.title, view.tags]));
  assert.deepEqual(titles, { A: ['work', 'team ops'], B: ['team ops'] });
});
