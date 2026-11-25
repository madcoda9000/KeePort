import * as kdbxweb from 'kdbxweb';
import argon2 from 'argon2-browser/dist/argon2-bundled.min.js';
import { encodeAttachments, type AttachmentDraft } from './attachments.ts';
import {
  findTemplate,
  isTemplateEntry,
  linkTemplate,
  listTemplates,
  readCustomFields,
  readExpiry,
  writeCustomFields,
  withTemplateProtection,
  writeExpiry,
  type CustomField,
  type TemplateInfo
} from './fields.ts';
import { isExpired } from './entry-actions.ts';
import { requireGroup, rootGroup } from './groups.ts';
import { customIconUrl } from './icons.ts';
import { storedOtpValue } from './totp.ts';

let argon2Ready: Promise<void> | null = null;

/** Registers the browser Argon2 implementation once for KDBX operations. */
export function ensureKdbxCrypto(): Promise<void> {
  if (!argon2Ready) {
    argon2Ready = (/** Installs the Argon2 adapter into the KDBX crypto engine. */ async () => {
      /**
       * Maps KDBX Argon2 parameters to the browser library and returns the derived bytes.
       * @param password - The password bytes supplied by KDBX.
       * @param salt - The salt bytes from the KDBX key derivation settings.
       * @param memory - The Argon2 memory cost in KiB.
       * @param iterations - The number of Argon2 passes.
       * @param length - The requested output size in bytes.
       * @param parallelism - The number of Argon2 lanes.
       * @param type - The KDBX Argon2 variant used to select the browser implementation.
       */
      kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type) => {
        const result = await argon2.hash({
          pass: new Uint8Array(password),
          salt: new Uint8Array(salt),
          time: iterations,
          mem: memory,
          hashLen: length,
          parallelism,
          type
        });
        return result.hash.slice().buffer as ArrayBuffer;
      });
    })();
  }
  return argon2Ready;
}

export interface EntryEdits {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  otp: string;
  /** The complete list of custom fields; omit to leave them unchanged. */
  customFields?: CustomField[];
  /** The expiry date as YYYY-MM-DD, an empty string for none; omit to leave it unchanged. */
  expires?: string;
  /** For a new entry: the base64 UUID of the template it is created from. */
  templateId?: string;
}

export interface EntryView {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  otp: string;
  tags: string[];
  groupPath: string;
  /** The base64 UUID of the folder that directly contains the entry. */
  groupId: string;
  /** Whether the entry is a template or in the recycle bin; such entries are left out of "All entries" and the search. */
  hidden: boolean;
  /** Custom fields without standard and internal fields. */
  customFields: CustomField[];
  /** The expiry date as YYYY-MM-DD, or an empty string. */
  expires: string;
  /** Whether the entry is itself a template definition. */
  isTemplate: boolean;
  /** The template the entry was created from, or null. */
  template: TemplateInfo | null;
  /** The entry's own icon from the KDBX as a data URL, or null. */
  iconUrl: string | null;
  /** Whether the entry's expiry date has passed. */
  expired: boolean;
  entry: kdbxweb.KdbxEntry;
}

/**
 * Reads a plain or protected KDBX field as text, defaulting to an empty string.
 * @param field - A raw KDBX entry field, which may contain a protected value or be absent.
 */
function fieldText(field: kdbxweb.KdbxEntryField | undefined): string {
  if (field === undefined) return '';
  if (typeof field === 'string') return field;
  if (field instanceof kdbxweb.ProtectedValue) return field.getText();
  return String(field);
}

/**
 * Checks whether a group is the recycle bin or the entry templates group of the database.
 * @param db - The unlocked database providing the special group references.
 * @param group - The group to check.
 */
function isSpecialGroup(db: kdbxweb.Kdbx, group: kdbxweb.KdbxGroup): boolean {
  return [db.meta.recycleBinUuid, db.meta.entryTemplatesGroup].some(/**
   * Compares the group with one special group reference.
   * @param uuid - The reference stored in the database metadata, if any.
   */ (uuid) => Boolean(uuid && !uuid.empty && group.uuid.equals(uuid)));
}

/**
 * Collects entry views recursively with each group's path.
 * @param db - The unlocked database providing the recycle bin and templates references.
 * @param group - The KDBX group whose entries and child groups should be visited.
 * @param path - The path of the parent group, used to build the full entry group path.
 * @param out - The array to which the entry views are appended.
 * @param inSpecial - Whether a parent group is the recycle bin or the templates group.
 * @param templates - The templates of the database, used to resolve each entry's template.
 * @param now - The current time, used to mark expired entries.
 */
function walkGroup(
  db: kdbxweb.Kdbx,
  group: kdbxweb.KdbxGroup,
  path: string,
  out: EntryView[],
  inSpecial: boolean,
  templates: readonly TemplateInfo[],
  now: Date
) {
  const groupPath = path ? `${path} / ${group.name ?? 'Group'}` : group.name ?? 'Root';
  const hidden = inSpecial || isSpecialGroup(db, group);
  for (const entry of group.entries) {
    const template = findTemplate(templates, entry);
    out.push({
      id: entry.uuid.id,
      title: fieldText(entry.fields.get('Title')) || 'Untitled',
      username: fieldText(entry.fields.get('UserName')),
      password: fieldText(entry.fields.get('Password')),
      url: fieldText(entry.fields.get('URL')),
      notes: fieldText(entry.fields.get('Notes')),
      otp: fieldText(entry.fields.get('otp')),
      tags: [...entry.tags],
      groupPath,
      groupId: group.uuid.id,
      hidden,
      customFields: withTemplateProtection(readCustomFields(entry), template),
      expires: readExpiry(entry),
      isTemplate: isTemplateEntry(entry),
      template,
      iconUrl: customIconUrl(db, entry),
      expired: isExpired(entry, now),
      entry
    });
  }
  for (const child of group.groups) {
    walkGroup(db, child, groupPath, out, hidden, templates, now);
  }
}

/**
 * Flattens the database entries into a list sorted by title.
 * @param db - The unlocked browser-side KDBX database to enumerate.
 */
export function listEntries(db: kdbxweb.Kdbx): EntryView[] {
  const out: EntryView[] = [];
  const templates = listTemplates(db);
  const now = new Date();
  for (const group of db.groups) {
    walkGroup(db, group, '', out, false, templates, now);
  }
  return out.sort(/**
   * Compares entry titles without case or accent distinctions.
   * @param a - The first entry whose title is compared.
   * @param b - The second entry whose title is compared.
   */ (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

/**
 * Checks searchable entry fields for the normalized query without using passwords or TOTP secrets.
 * @param entry - The entry metadata whose searchable fields are checked.
 * @param query - The search text before trimming and case normalization.
 */
export function entryMatches(entry: EntryView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const fields = entry.customFields.filter(/**
   * Keeps unprotected custom fields; protected ones are treated like passwords.
   * @param field - One custom field.
   */ (field) => !field.protected).map(/**
   * Selects the field value.
   * @param field - One unprotected custom field.
   */ (field) => field.value);
  return [entry.title, entry.username, entry.url, entry.notes, entry.groupPath, entry.template?.title ?? '', ...fields, ...entry.tags]
    .join('\n')
    .toLowerCase()
    .includes(q);
}

/**
 * Unlocks KDBX bytes in the browser with a password and optional key file.
 * @param bytes - The encrypted KDBX bytes.
 * @param password - The master password used for local KDBX encryption or decryption.
 * @param keyFileBytes - The optional KeePass key file contents, or null if no key file was selected.
 */
export async function loadVault(bytes: ArrayBuffer, password: string, keyFileBytes: ArrayBuffer | null): Promise<kdbxweb.Kdbx> {
  await ensureKdbxCrypto();
  const credentials = new kdbxweb.KdbxCredentials(
    password ? kdbxweb.ProtectedValue.fromString(password) : null,
    keyFileBytes
  );
  await credentials.ready;
  return kdbxweb.Kdbx.load(bytes, credentials);
}

/**
 * Opens newer KDBX bytes of an already unlocked vault with the credentials still held in the browser, so the user does
 * not have to enter the master password again. Fails with a clear message if the file now uses other credentials.
 * @param bytes - The encrypted KDBX bytes downloaded from the server.
 * @param credentials - The credentials of the open vault (derived hashes, not the plain password).
 */
export async function reopenVault(bytes: ArrayBuffer, credentials: kdbxweb.KdbxCredentials): Promise<kdbxweb.Kdbx> {
  await ensureKdbxCrypto();
  try {
    return await kdbxweb.Kdbx.load(bytes, credentials);
  } catch (error) {
    if (error instanceof kdbxweb.KdbxError && error.code === kdbxweb.Consts.ErrorCodes.InvalidKey) {
      throw new Error('The vault on the server now uses a different master password or key file. Lock the vault and unlock it again.', { cause: error });
    }
    throw error;
  }
}

/**
 * Applies edited fields, including the TOTP setting, and updates the modification time.
 * @param entry - The unlocked KDBX entry to modify in place.
 * @param edits - The draft field values to apply to the encrypted entry.
 */
export function applyEntryEdits(entry: kdbxweb.KdbxEntry, edits: EntryEdits) {
  entry.pushHistory();
  entry.fields.set('Title', edits.title);
  entry.fields.set('UserName', edits.username);
  entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(edits.password));
  entry.fields.set('URL', edits.url);
  entry.fields.set('Notes', kdbxweb.ProtectedValue.fromString(edits.notes));
  setOtpField(entry, edits);
  applyExtraEdits(entry, edits);
  entry.times.update();
}

/**
 * Writes the custom fields and the expiry date when the draft provides them.
 * @param entry - The entry to change.
 * @param edits - The draft values.
 */
function applyExtraEdits(entry: kdbxweb.KdbxEntry, edits: EntryEdits) {
  if (edits.customFields) writeCustomFields(entry, edits.customFields);
  if (edits.expires !== undefined) writeExpiry(entry, edits.expires);
}

/**
 * Stores the TOTP setting in the `otp` field in a format other KeePass clients recognize, protected like
 * KeePassXC does, and removes the field when no TOTP is set so clients do not show an empty `otp` field.
 * @param entry - The KDBX entry whose `otp` field is written.
 * @param edits - The draft values providing the TOTP input and the entry title used as URI label.
 */
function setOtpField(entry: kdbxweb.KdbxEntry, edits: EntryEdits) {
  const value = storedOtpValue(edits.otp, edits.title);
  if (value) {
    entry.fields.set('otp', kdbxweb.ProtectedValue.fromString(value));
  } else {
    entry.fields.delete('otp');
  }
}

/**
 * Creates an entry with the supplied field values in a folder, or in the root folder when none is given.
 * @param db - The unlocked database that receives the new entry.
 * @param edits - The draft field values to apply to the encrypted entry.
 * @param groupId - The base64 UUID of the folder for the new entry; omit to use the root folder.
 */
export function createEntry(db: kdbxweb.Kdbx, edits: EntryEdits, groupId?: string): kdbxweb.KdbxEntry {
  const group = groupId ? requireGroup(db, groupId) : rootGroup(db);
  const template = edits.templateId
    ? listTemplates(db).find(/**
       * Finds the chosen template.
       * @param item - One template of the database.
       */ (item) => item.id === edits.templateId)
    : undefined;
  if (edits.templateId && !template) throw new Error('The template no longer exists. Reload the vault and try again.');
  const entry = db.createEntry(group);
  if (template) linkTemplate(entry, template);
  entry.fields.set('Title', edits.title);
  entry.fields.set('UserName', edits.username);
  entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(edits.password));
  entry.fields.set('URL', edits.url);
  entry.fields.set('Notes', kdbxweb.ProtectedValue.fromString(edits.notes));
  setOtpField(entry, edits);
  applyExtraEdits(entry, edits);
  entry.times.update();
  return entry;
}

/**
 * Serializes the database as encrypted KDBX bytes.
 * @param db - The unlocked browser-side KDBX database to serialize and encrypt.
 */
export async function saveVault(db: kdbxweb.Kdbx): Promise<Uint8Array> {
  const buffer = await db.save();
  return new Uint8Array(buffer);
}

/**
 * Applies an entry draft and hands only the encrypted vault to the persistence callback.
 * @param db - The unlocked database containing the entry.
 * @param entry - The existing entry, or null to add a new entry.
 * @param edits - The entry fields to save.
 * @param attachments - The final set of draft attachments to save with those fields.
 * @param persist - The callback that writes the encrypted KDBX with the current ETag.
 * @param groupId - The folder for a new entry; omit to use the root folder. Ignored for existing entries.
 */
export async function saveEntryUpdate<T>(
  db: kdbxweb.Kdbx,
  entry: kdbxweb.KdbxEntry | null,
  edits: EntryEdits,
  attachments: AttachmentDraft,
  persist: (bytes: Uint8Array) => Promise<T>,
  groupId?: string
): Promise<{ entryId: string; updated: T }> {
  const original = entry && {
    fields: new Map(entry.fields),
    binaries: entry.binaries,
    times: entry.times.clone(),
    history: entry.history.slice(),
    _editState: entry._editState && { added: [...entry._editState.added], deleted: [...entry._editState.deleted] }
  };
  const originalBinaries = db.binaries.getAllWithHashes();
  let created: kdbxweb.KdbxEntry | undefined;
  try {
    const binaries = await encodeAttachments(db, attachments);
    const edited = entry ?? (created = createEntry(db, edits, groupId));
    if (entry) applyEntryEdits(entry, edits);
    edited.binaries = binaries;
    return { entryId: edited.uuid.id, updated: await persist(await saveVault(db)) };
  } catch (error) {
    if (entry && original) Object.assign(entry, original);
    if (created?.parentGroup) {
      const siblings = created.parentGroup.entries;
      const index = siblings.indexOf(created);
      if (index !== -1) siblings.splice(index, 1);
    }
    const originalHashes = new Set(originalBinaries.map(/**
     * Selects the original identity of each registered binary.
     * @param binary - A binary already present before saving the draft.
     */ (binary) => binary.hash));
    for (const binary of db.binaries.getAllWithHashes()) {
      if (!originalHashes.has(binary.hash)) db.binaries.deleteWithHash(binary.hash);
    }
    for (const binary of originalBinaries) db.binaries.addWithHash(binary);
    throw error;
  }
}

/**
 * Replaces the database credentials with empty credentials when locking it.
 * @param db - The database whose credentials are discarded, or null if no vault is open.
 */
export function clearVaultCredentials(db: kdbxweb.Kdbx | null) {
  if (!db) return;
  const passwordHash = db.credentials.passwordHash;
  const keyFileHash = db.credentials.keyFileHash;
  if (passwordHash) {
    passwordHash.value.fill(0);
    passwordHash.salt.fill(0);
  }
  if (keyFileHash) {
    keyFileHash.value.fill(0);
    keyFileHash.salt.fill(0);
  }
  db.credentials.passwordHash = undefined;
  db.credentials.keyFileHash = undefined;
}

/**
 * Creates a new encrypted KDBX file from the supplied name and master password.
 * @param name - The display name used for the new KDBX database.
 * @param password - The master password used for local KDBX encryption or decryption.
 */
export async function createKdbxBytes(name: string, password: string): Promise<Uint8Array> {
  await ensureKdbxCrypto();
  const credentials = new kdbxweb.KdbxCredentials(kdbxweb.ProtectedValue.fromString(password), null);
  await credentials.ready;
  const db = kdbxweb.Kdbx.create(credentials, name);
  db.setKdf(kdbxweb.Consts.KdfId.Argon2id);
  const kdf = db.header.kdfParameters;
  if (!kdf) throw new Error('Missing KDBX key derivation parameters.');
  kdf.set('M', kdbxweb.VarDictionary.ValueType.UInt64, new kdbxweb.Int64(64 * 1024 * 1024));
  kdf.set('I', kdbxweb.VarDictionary.ValueType.UInt64, new kdbxweb.Int64(3));
  kdf.set('P', kdbxweb.VarDictionary.ValueType.UInt32, 4);
  db.createDefaultGroup();
  const buffer = await db.save();
  return new Uint8Array(buffer);
}
