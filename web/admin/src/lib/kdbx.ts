import * as kdbxweb from 'kdbxweb';
import argon2 from 'argon2-browser/dist/argon2-bundled.min.js';

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
          mem: memory * 1024,
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
}

export interface EntryView {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  tags: string[];
  groupPath: string;
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
 * Collects entry views recursively with each group's path.
 * @param group - The KDBX group whose entries and child groups should be visited.
 * @param path - The path of the parent group, used to build the full entry group path.
 * @param out - The array to which the entry views are appended.
 */
function walkGroup(group: kdbxweb.KdbxGroup, path: string, out: EntryView[]) {
  const groupPath = path ? `${path} / ${group.name ?? 'Group'}` : group.name ?? 'Root';
  for (const entry of group.entries) {
    out.push({
      id: entry.uuid.id,
      title: fieldText(entry.fields.get('Title')) || 'Untitled',
      username: fieldText(entry.fields.get('UserName')),
      password: fieldText(entry.fields.get('Password')),
      url: fieldText(entry.fields.get('URL')),
      notes: fieldText(entry.fields.get('Notes')),
      tags: [...entry.tags],
      groupPath,
      entry
    });
  }
  for (const child of group.groups) {
    walkGroup(child, groupPath, out);
  }
}

/**
 * Flattens the database entries into a list sorted by title.
 * @param db - The unlocked browser-side KDBX database to enumerate.
 */
export function listEntries(db: kdbxweb.Kdbx): EntryView[] {
  const out: EntryView[] = [];
  for (const group of db.groups) {
    walkGroup(group, '', out);
  }
  return out.sort(/**
   * Compares entry titles without case or accent distinctions.
   * @param a - The first entry whose title is compared.
   * @param b - The second entry whose title is compared.
   */ (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

/**
 * Checks searchable entry fields for the normalized query.
 * @param entry - The entry metadata whose searchable fields are checked.
 * @param query - The search text before trimming and case normalization.
 */
export function entryMatches(entry: EntryView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [entry.title, entry.username, entry.url, entry.notes, entry.groupPath, ...entry.tags]
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
 * Applies the edited fields to an entry and updates its modification time.
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
  entry.times.update();
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
  db.createDefaultGroup();
  const buffer = await db.save();
  return new Uint8Array(buffer);
}
