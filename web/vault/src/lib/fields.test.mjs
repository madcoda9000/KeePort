import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Consts, Kdbx, KdbxCredentials, KdbxUuid, ProtectedValue } from 'kdbxweb';
import {
  customFieldNameError,
  listTemplates,
  readCustomFields,
  templateStartFields,
  uuidToHex
} from './fields.ts';
import { createFolder, listFolders } from './groups.ts';
import { listEntries, saveEntryUpdate } from './kdbx.ts';

// Use the browser DOM code path rather than kdbxweb's legacy xmldom constructor options.
Object.assign(globalThis, { DOMParser, XMLSerializer });

const CREDIT_CARD_UUID = '49DD48DBFF149445B3392CE90EA75309';

/**
 * Converts hex text to an ArrayBuffer.
 * @param hex - An even number of hex digits.
 */
function hexBytes(hex) {
  return Uint8Array.from(hex.match(/../g), /**
   * Parses one byte.
   * @param pair - Two hex digits.
   */ (pair) => Number.parseInt(pair, 16)).buffer;
}

/**
 * Creates a vault with a templates folder holding KeePass2Android's credit card template, field for field as
 * AddTemplateEntries.cs writes it, and a card created from it the way KpEntryTemplatedEdit does.
 */
function cardVault() {
  const credentials = new KdbxCredentials(ProtectedValue.fromString('public test password'));
  const db = Kdbx.create(credentials, 'Template test');
  db.setKdf(Consts.KdfId.Aes);
  const templates = createFolder(db, listFolders(db)[0].id, 'Vorlagen');
  db.meta.entryTemplatesGroup = templates.uuid;

  const template = db.createEntry(templates);
  template.uuid = new KdbxUuid(hexBytes(CREDIT_CARD_UUID));
  template.icon = 66;
  template.fields.set('Title', 'Kreditkarte');
  template.fields.set('_etm_template', '1');
  [['Nummer', 'Inline'], ['CVV', 'Protected Inline'], ['PIN', 'Protected Inline'], ['Karteninhaber', 'Inline'], ['@exp_date', 'Date Time']]
    .forEach(/**
     * Adds one field definition.
     * @param definition - The field name and type.
     * @param position - The field's position.
     */ ([name, type], position) => {
      template.fields.set(`_etm_position_${name}`, String(position));
      template.fields.set(`_etm_title_${name}`, name);
      template.fields.set(`_etm_type_${name}`, type);
    });

  const card = db.createEntry(db.getDefaultGroup());
  card.fields.set('Title', 'Visa');
  card.fields.set('_etm_template_uuid', CREDIT_CARD_UUID);
  card.fields.set('Nummer', '4111 1111 1111 1111');
  card.fields.set('CVV', ProtectedValue.fromString('123'));
  card.fields.set('PIN', ProtectedValue.fromString('9876'));
  card.fields.set('Karteninhaber', 'Anna Schmidt');
  card.times.expires = true;
  card.times.expiryTime = new Date(2028, 4, 31);
  return db;
}

/**
 * Finds an entry view by title.
 * @param db - The vault.
 * @param title - The entry title.
 */
function view(db, title) {
  const found = listEntries(db).find(/**
   * Matches the title.
   * @param item - One entry view.
   */ (item) => item.title === title);
  assert.ok(found, `missing entry ${title}`);
  return found;
}

/** Verifies that KeePass2Android's template and a card created from it are read like the app shows them. */
test('reads KeePass2Android templates, their fields and the expiry date', () => {
  const db = cardVault();
  const [template] = listTemplates(db);
  assert.equal(template.title, 'Kreditkarte');
  assert.deepEqual(template.fields.map(/**
   * Summarizes a template field.
   * @param field - One template field.
   */ (field) => `${field.name}:${field.kind}:${field.protected}`), [
    'Nummer:custom:false', 'CVV:custom:true', 'PIN:custom:true', 'Karteninhaber:custom:false', '@exp_date:expiry:false'
  ]);

  const card = view(db, 'Visa');
  assert.equal(card.template?.title, 'Kreditkarte');
  assert.equal(card.isTemplate, false);
  assert.equal(card.expires, '2028-05-31');
  assert.deepEqual(card.customFields, [
    { name: 'CVV', value: '123', protected: true },
    { name: 'Karteninhaber', value: 'Anna Schmidt', protected: false },
    { name: 'Nummer', value: '4111 1111 1111 1111', protected: false },
    { name: 'PIN', value: '9876', protected: true }
  ]);
  assert.equal(view(db, 'Kreditkarte').isTemplate, true);
  assert.deepEqual(view(db, 'Kreditkarte').customFields, [], 'template markers stay hidden');
});

/** Verifies editing custom fields and the expiry date, keeping protection and the template link. */
test('saves edited, added and removed custom fields and the expiry date', async () => {
  const db = cardVault();
  const card = view(db, 'Visa');
  const fields = card.customFields
    .filter(/**
     * Drops the PIN.
     * @param field - One custom field.
     */ (field) => field.name !== 'PIN')
    .map(/**
     * Changes the CVV.
     * @param field - One custom field.
     */ (field) => (field.name === 'CVV' ? { ...field, value: '999' } : field));
  fields.push({ name: 'Bank', value: 'Example Bank', protected: false });
  const edits = { title: 'Visa', username: '', password: '', url: '', notes: '', otp: '', customFields: fields, expires: '' };
  /**
   * Reopens the encrypted bytes.
   * @param bytes - The saved vault.
   */
  const reopen = (bytes) => Kdbx.load(bytes.slice().buffer, db.credentials);
  const { updated } = await saveEntryUpdate(db, card.entry, edits, card.entry.binaries, reopen);
  const saved = view(updated, 'Visa');
  assert.deepEqual(saved.customFields.map(/**
   * Summarizes a field.
   * @param field - One custom field.
   */ (field) => `${field.name}=${field.value}:${field.protected}`), [
    'Bank=Example Bank:false', 'CVV=999:true', 'Karteninhaber=Anna Schmidt:false', 'Nummer=4111 1111 1111 1111:false'
  ]);
  assert.equal(saved.expires, '');
  assert.equal(saved.template?.title, 'Kreditkarte', 'template link kept');
  assert.ok(saved.entry.history.at(-1).fields.has('PIN'), 'old values in history');
});

/** Verifies creating an entry from a template the way KeePass2Android does. */
test('creates entries from a template with reference, icon and fields', async () => {
  const db = cardVault();
  const [template] = listTemplates(db);
  const fields = templateStartFields(template).map(/**
   * Fills in the number.
   * @param field - One starting field.
   */ (field) => (field.name === 'Nummer' ? { ...field, value: '5500 0000 0000 0004' } : field));
  const edits = { title: 'Mastercard', username: '', password: '', url: '', notes: '', otp: '', customFields: fields, expires: '2027-12-01', templateId: template.id };
  /**
   * Accepts the write.
   * @param bytes - The saved vault.
   */
  const accept = async (bytes) => bytes;
  await saveEntryUpdate(db, null, edits, new Map(), accept);
  const created = view(db, 'Mastercard');
  assert.equal(created.entry.fields.get('_etm_template_uuid'), CREDIT_CARD_UUID);
  assert.equal(uuidToHex(template.entry.uuid), CREDIT_CARD_UUID);
  assert.equal(created.entry.icon, 66);
  assert.equal(created.template?.title, 'Kreditkarte');
  assert.equal(created.expires, '2027-12-01');
  assert.ok(created.entry.fields.get('CVV') instanceof ProtectedValue);
  assert.deepEqual(readCustomFields(created.entry).map(/**
   * Selects the field name.
   * @param field - One custom field.
   */ (field) => field.name), ['CVV', 'Karteninhaber', 'Nummer', 'PIN']);
});

/** Verifies the rules for new custom field names. */
test('validates custom field names', () => {
  assert.match(customFieldNameError(' ', []), /Enter a field name/);
  assert.match(customFieldNameError('password', []), /standard field/);
  assert.match(customFieldNameError('OTP', []), /standard field/);
  assert.match(customFieldNameError('_etm_title_x', []), /reserved/);
  assert.match(customFieldNameError('@exp_date', []), /reserved/);
  assert.match(customFieldNameError('cvv', ['CVV']), /already exists/);
  assert.equal(customFieldNameError('Bank', ['CVV']), null);
});

/** Verifies that an empty protected template field stays protected after a save and when filled in later. */
test('keeps template fields protected even while they are empty', async () => {
  const db = cardVault();
  const [template] = listTemplates(db);
  const edits = { title: 'Empty CVV', username: '', password: '', url: '', notes: '', otp: '', customFields: templateStartFields(template), expires: '', templateId: template.id };
  /**
   * Reopens the encrypted bytes, as a later session would.
   * @param bytes - The saved vault.
   */
  const reopen = (bytes) => Kdbx.load(bytes.slice().buffer, db.credentials);
  const { updated } = await saveEntryUpdate(db, null, edits, new Map(), reopen);
  const created = view(updated, 'Empty CVV');
  const cvv = created.customFields.find(/**
   * Finds the CVV field.
   * @param field - One custom field.
   */ (field) => field.name === 'CVV');
  assert.equal(cvv.protected, true, 'protected by the template although the stored value is empty');
  const filled = created.customFields.map(/**
   * Fills in the CVV.
   * @param field - One custom field.
   */ (field) => (field.name === 'CVV' ? { ...field, value: '321' } : field));
  await saveEntryUpdate(updated, created.entry, { ...edits, customFields: filled, templateId: undefined }, new Map(), /**
   * Accepts the write.
   * @param bytes - The saved vault.
   */ async (bytes) => bytes);
  assert.ok(created.entry.fields.get('CVV') instanceof ProtectedValue);
});
