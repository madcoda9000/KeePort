import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Consts, Kdbx, KdbxCredentials, ProtectedValue } from 'kdbxweb';
import {
  VaultChangeError,
  applyVaultChange,
  createFolder,
  deleteFolder,
  flattenFolders,
  folderNameError,
  listFolders,
  moveEntries,
  renameFolder
} from './groups.ts';
import { createEntry, listEntries } from './kdbx.ts';

// Use the browser DOM code path rather than kdbxweb's legacy xmldom constructor options.
Object.assign(globalThis, { DOMParser, XMLSerializer });

const fields = { title: 'Example', username: '', password: '', url: '', notes: '', otp: '' };

/** Creates an ephemeral vault with a root folder and a recycle bin, using the AES KDF to avoid Argon2. */
function testVault() {
  const credentials = new KdbxCredentials(ProtectedValue.fromString('public test password'));
  const db = Kdbx.create(credentials, 'Folder test');
  db.setKdf(Consts.KdfId.Aes);
  db.createRecycleBin();
  return db;
}

/**
 * Returns the flattened folder node with the given path.
 * @param db - The vault whose folders are listed.
 * @param path - The full folder path, e.g. "Folder test / Work".
 */
function folder(db, path) {
  const node = flattenFolders(listFolders(db)).find(/**
   * Matches the folder path.
   * @param item - One folder node.
   */ (item) => item.path === path);
  assert.ok(node, `missing folder ${path}`);
  return node;
}

/**
 * Reopens encrypted bytes with the vault's credentials.
 * @param db - The vault providing the credentials.
 * @param bytes - The encrypted KDBX bytes.
 */
const reopen = (db, bytes) => Kdbx.load(bytes.slice().buffer, db.credentials);

/** Verifies folder creation, nesting, renaming, counts and the special folder flags. */
test('creates, nests and renames folders and lists them with counts', async () => {
  const db = testVault();
  const root = listFolders(db)[0];
  assert.equal(root.isRoot, true);
  const work = createFolder(db, root.id, '  Work  ');
  const sub = createFolder(db, work.uuid.id, 'Servers');
  createEntry(db, fields, sub.uuid.id);
  createEntry(db, fields, work.uuid.id);
  createEntry(db, fields);
  renameFolder(db, work.uuid.id, 'Office');

  const tree = listFolders(db)[0];
  assert.deepEqual(tree.children.map(/**
   * Selects the folder names.
   * @param node - One child folder.
   */ (node) => node.name), ['Office', 'Recycle Bin']);
  assert.equal(tree.children.at(-1).isRecycleBin, true);
  assert.equal(tree.totalEntryCount, 3);
  assert.equal(tree.entryCount, 1);
  const office = folder(db, 'Folder test / Office');
  assert.equal(office.entryCount, 1);
  assert.equal(office.totalEntryCount, 2);
  assert.equal(folder(db, 'Folder test / Office / Servers').depth, 2);

  const entry = listEntries(db).find(/**
   * Finds the entry in the nested folder.
   * @param view - One entry view.
   */ (view) => view.groupPath.endsWith('Servers'));
  assert.equal(entry.groupId, sub.uuid.id);

  const saved = await reopen(db, new Uint8Array(await db.save()));
  assert.equal(folder(saved, 'Folder test / Office / Servers').entryCount, 1);
  assert.equal(folder(saved, 'Folder test / Recycle Bin').isRecycleBin, true);
});

/** Verifies the name rules: required, limited length and unique among siblings. */
test('validates folder names', () => {
  const db = testVault();
  const rootId = listFolders(db)[0].id;
  const work = createFolder(db, rootId, 'Work');
  assert.match(folderNameError(db, rootId, '   '), /Enter a folder name/);
  assert.match(folderNameError(db, rootId, 'x'.repeat(256)), /at most 255/);
  assert.match(folderNameError(db, rootId, 'work'), /already exists/);
  assert.equal(folderNameError(db, rootId, 'Work', work.uuid.id), null);
  assert.throws(/** Creates a duplicate sibling. */ () => createFolder(db, rootId, 'WORK'), /already exists/);
});

/** Verifies that root and recycle bin are protected and that only empty folders can be deleted. */
test('deletes only empty folders and records them as deleted objects', () => {
  const db = testVault();
  const root = listFolders(db)[0];
  const bin = folder(db, 'Folder test / Recycle Bin');
  const full = createFolder(db, root.id, 'Full');
  createEntry(db, fields, full.uuid.id);
  const parent = createFolder(db, root.id, 'Parent');
  createFolder(db, parent.uuid.id, 'Child');
  const empty = createFolder(db, root.id, 'Empty');

  assert.throws(/** Deletes the root. */ () => deleteFolder(db, root.id), /root folder/);
  assert.throws(/** Deletes the recycle bin. */ () => deleteFolder(db, bin.id), /recycle bin/);
  assert.throws(/** Renames the recycle bin. */ () => renameFolder(db, bin.id, 'Trash'), /recycle bin/);
  assert.throws(/** Renames the root. */ () => renameFolder(db, root.id, 'Other'), /root folder/);
  assert.throws(/** Creates a folder in the recycle bin. */ () => createFolder(db, bin.id, 'Inside'), /recycle bin/);
  assert.throws(/** Deletes a folder with an entry. */ () => deleteFolder(db, full.uuid.id), /Only empty folders/);
  assert.throws(/** Deletes a folder with a subfolder. */ () => deleteFolder(db, parent.uuid.id), /Only empty folders/);

  deleteFolder(db, empty.uuid.id);
  assert.equal(db.getGroup(empty.uuid.id), undefined);
  assert.ok(db.deletedObjects.some(/**
   * Finds the deletion record of the removed folder.
   * @param item - One deleted object record.
   */ (item) => item.uuid.equals(empty.uuid)));
});

/** Verifies moving several entries between folders, restoring from the recycle bin and the location timestamp. */
test('moves several entries and updates their location timestamp', async () => {
  const db = testVault();
  const root = listFolders(db)[0];
  const bin = db.getGroup(db.meta.recycleBinUuid);
  const target = createFolder(db, root.id, 'Target');
  const a = createEntry(db, { ...fields, title: 'A' });
  const b = createEntry(db, { ...fields, title: 'B' });
  const trashed = createEntry(db, { ...fields, title: 'Trashed' }, bin.uuid.id);
  const already = createEntry(db, { ...fields, title: 'Already' }, target.uuid.id);
  const before = new Date(0);
  a.times.locationChanged = before;

  assert.throws(/** Moves into the recycle bin. */ () => moveEntries(db, [a.uuid.id], bin.uuid.id), /recycle bin/);
  assert.throws(/** Moves an unknown entry. */ () => moveEntries(db, ['missing'], target.uuid.id), /no longer exist/);
  const moved = moveEntries(db, [a.uuid.id, b.uuid.id, trashed.uuid.id, already.uuid.id], target.uuid.id);
  assert.equal(moved, 3);
  assert.ok(a.times.locationChanged > before);
  assert.equal(folder(db, 'Folder test / Target').entryCount, 4);
  assert.equal(folder(db, 'Folder test / Recycle Bin').entryCount, 0);

  const saved = await reopen(db, new Uint8Array(await db.save()));
  assert.deepEqual(listEntries(saved).filter(/**
   * Selects the entries in the target folder.
   * @param view - One entry view.
   */ (view) => view.groupId === target.uuid.id).map(/**
   * Selects the titles.
   * @param view - One entry view.
   */ (view) => view.title), ['A', 'Already', 'B', 'Trashed']);
});

/** Verifies that a rejected save restores the last saved structure and a successful one returns the new bytes. */
test('saves changes and reloads the last saved state when the save is rejected', async () => {
  const db = testVault();
  const rootId = listFolders(db)[0].id;
  const saved = new Uint8Array(await db.save());

  const ok = await applyVaultChange(db, saved, /**
   * Creates a folder.
   * @param vault - The vault to change.
   */ (vault) => createFolder(vault, rootId, 'Kept').uuid.id, /**
   * Accepts the write.
   * @param bytes - The encrypted vault.
   */ async (bytes) => bytes.length);
  assert.ok(ok.updated > 0);
  assert.equal(folder(await reopen(db, ok.bytes), 'Folder test / Kept').id, ok.result);

  const rejected = new Error('stale write');
  const failure = await applyVaultChange(db, ok.bytes, /**
   * Creates a folder that must not survive.
   * @param vault - The vault to change.
   */ (vault) => createFolder(vault, rootId, 'Lost'), /** Rejects the write. */ async () => {
    throw rejected;
  }).then(/** Fails the test if the change was saved. */ () => assert.fail('expected a rejection'), /**
   * Returns the rejection.
   * @param error - The thrown error.
   */ (error) => error);
  assert.ok(failure instanceof VaultChangeError);
  assert.equal(failure.cause, rejected);
  assert.ok(failure.restored);
  const names = flattenFolders(listFolders(failure.restored)).map(/**
   * Selects the folder names.
   * @param node - One folder node.
   */ (node) => node.name);
  assert.ok(names.includes('Kept'));
  assert.ok(!names.includes('Lost'));
});

/** Verifies that templates and recycled entries are marked hidden so "All entries" and the search leave them out. */
test('marks templates and recycled entries as hidden', () => {
  const db = testVault();
  const rootId = listFolders(db)[0].id;
  const templates = createFolder(db, rootId, 'Templates');
  db.meta.entryTemplatesGroup = templates.uuid;
  const nested = createFolder(db, templates.uuid.id, 'Cards');
  createEntry(db, { ...fields, title: 'Regular' });
  createEntry(db, { ...fields, title: 'Template' }, templates.uuid.id);
  createEntry(db, { ...fields, title: 'Nested template' }, nested.uuid.id);
  createEntry(db, { ...fields, title: 'Recycled' }, db.meta.recycleBinUuid.id);
  const hidden = Object.fromEntries(listEntries(db).map(/**
   * Maps each title to its hidden flag.
   * @param view - One entry view.
   */ (view) => [view.title, view.hidden]));
  assert.deepEqual(hidden, { 'Nested template': true, Recycled: true, Regular: false, Template: true });
});
