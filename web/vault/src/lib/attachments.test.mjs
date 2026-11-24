import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Consts, Kdbx, KdbxCredentials, ProtectedValue } from 'kdbxweb';
import { MAX_ATTACHMENT_BYTES, addAttachment, attachmentBlob, attachmentSize } from './attachments.ts';
import { listEntries, saveEntryUpdate } from './kdbx.ts';

// Use the browser DOM code path rather than kdbxweb's legacy xmldom constructor options.
Object.assign(globalThis, { DOMParser, XMLSerializer });

const fields = { title: 'Example', username: '', password: '', url: '', notes: '', otp: 'JBSWY3DPEHPK3PXP' };

/** Creates an ephemeral vault using the standard AES KDF without requiring the browser Argon2 adapter. */
function testVault() {
  const credentials = new KdbxCredentials(ProtectedValue.fromString('public test password'));
  const db = Kdbx.create(credentials, 'Attachment test');
  db.setKdf(Consts.KdfId.Aes);
  return db;
}

/** Verifies that invalid files cannot override an attachment or allocate a new KDBX binary. */
test('stages files without overwriting duplicate names or accepting files above the limit', () => {
  const draft = new Map();
  const attachment = new File(['hello'], 'notes.txt');
  const updated = addAttachment(draft, attachment);
  assert.equal(draft.size, 0);
  assert.equal(attachmentSize(updated.get('notes.txt')), 5);
  assert.throws(/** Attempts to replace a file implicitly. */ () => addAttachment(updated, attachment), /already exists/);
  const oversized = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], 'large.bin');
  assert.throws(/** Attempts to stage a file over the per-attachment limit. */ () => addAttachment(updated, oversized), /10 MiB/);
});

/** Verifies the entire KDBX round trip for creation, local download, and deletion from the current entry. */
test('round-trips new and existing attachments and the TOTP field through encrypted KDBX', async () => {
  const db = testVault();
  /**
   * Reopens the encrypted bytes as a fresh unlocked test vault.
   * @param bytes - The encrypted database sent to the persistence callback.
   */
  const reopen = (bytes) => Kdbx.load(bytes.buffer, db.credentials);
  const draft = addAttachment(new Map(), new File(['attachment contents'], 'notes.txt'));
  const { updated: opened } = await saveEntryUpdate(db, null, fields, draft, reopen);
  const [view] = listEntries(opened);
  assert.equal(view.otp, fields.otp);
  const attachment = view.entry.binaries.get('notes.txt');
  assert.ok(attachment);
  assert.equal(attachmentSize(attachment), 19);
  const download = attachmentBlob(attachment);
  assert.equal(download.type, 'application/octet-stream');
  assert.equal(await download.text(), 'attachment contents');

  const next = addAttachment(new Map(), new File([Uint8Array.of(0, 1, 255)], 'payload.bin'));
  const { updated: edited } = await saveEntryUpdate(opened, view.entry, fields, next, reopen);
  const [saved] = listEntries(edited);
  assert.deepEqual([...saved.entry.binaries.keys()], ['payload.bin']);
  assert.deepEqual(new Uint8Array(await attachmentBlob(saved.entry.binaries.get('payload.bin')).arrayBuffer()), Uint8Array.of(0, 1, 255));
  assert.ok(saved.entry.history[0].binaries.has('notes.txt'));
});

/** Verifies that protected KDBX binaries expose their decoded bytes only for an explicit download. */
test('downloads protected attachment values', async () => {
  const bytes = Uint8Array.of(0, 17, 255);
  const attachment = ProtectedValue.fromBinary(bytes.slice().buffer);
  assert.equal(attachmentSize(attachment), bytes.length);
  assert.deepEqual(new Uint8Array(await attachmentBlob(attachment).arrayBuffer()), bytes);
});

/** Verifies that a rejected save leaves the currently unlocked vault consistent for a subsequent edit. */
test('restores the entry and the KDBX binary store when persistence rejects the write', async () => {
  const db = testVault();
  const stored = addAttachment(new Map(), new File(['original'], 'old.txt'));
  /**
   * Accepts an encrypted vault with no server setup for this unit test.
   * @param bytes - The encrypted database accepted by the test persistence callback.
   */
  const accept = async (bytes) => bytes;
  const rejected = new Error('stale write');
  /** Simulates server rejection of the encrypted write. */
  const reject = async () => { throw rejected; };
  await saveEntryUpdate(db, null, fields, stored, accept);
  const [original] = listEntries(db);
  const historyCount = original.entry.history.length;
  const draft = addAttachment(new Map(), new File(['unsaved'], 'new.txt'));
  await assert.rejects(saveEntryUpdate(db, original.entry, { ...fields, title: 'Unsaved' }, draft, reject), rejected);
  await assert.rejects(saveEntryUpdate(db, null, fields, draft, reject), rejected);
  const [remaining, ...others] = listEntries(db);
  assert.equal(others.length, 0);
  assert.equal(remaining.title, fields.title);
  assert.equal(remaining.entry.history.length, historyCount);
  assert.deepEqual([...remaining.entry.binaries.keys()], ['old.txt']);
  assert.equal(db.binaries.getAllWithHashes().length, 1);
});
