import * as kdbxweb from 'kdbxweb';
import argon2 from 'argon2-browser/dist/argon2-bundled.min.js';

let argon2Ready: Promise<void> | null = null;

export function ensureKdbxCrypto(): Promise<void> {
  if (!argon2Ready) {
    argon2Ready = (async () => {
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
  otp: string;
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
  entry: kdbxweb.KdbxEntry;
}

function fieldText(field: kdbxweb.KdbxEntryField | undefined): string {
  if (field === undefined) return '';
  if (typeof field === 'string') return field;
  if (field instanceof kdbxweb.ProtectedValue) return field.getText();
  return String(field);
}

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
      otp: fieldText(entry.fields.get('otp')),
      tags: [...entry.tags],
      groupPath,
      entry
    });
  }
  for (const child of group.groups) {
    walkGroup(child, groupPath, out);
  }
}

export function listEntries(db: kdbxweb.Kdbx): EntryView[] {
  const out: EntryView[] = [];
  for (const group of db.groups) {
    walkGroup(group, '', out);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

export function entryMatches(entry: EntryView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [entry.title, entry.username, entry.url, entry.notes, entry.groupPath, ...entry.tags]
    .join('\n')
    .toLowerCase()
    .includes(q);
}

export async function loadVault(bytes: ArrayBuffer, password: string, keyFileBytes: ArrayBuffer | null): Promise<kdbxweb.Kdbx> {
  await ensureKdbxCrypto();
  const credentials = new kdbxweb.KdbxCredentials(
    password ? kdbxweb.ProtectedValue.fromString(password) : null,
    keyFileBytes
  );
  await credentials.ready;
  return kdbxweb.Kdbx.load(bytes, credentials);
}

export function applyEntryEdits(entry: kdbxweb.KdbxEntry, edits: EntryEdits) {
  entry.pushHistory();
  entry.fields.set('Title', edits.title);
  entry.fields.set('UserName', edits.username);
  entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(edits.password));
  entry.fields.set('URL', edits.url);
  entry.fields.set('Notes', kdbxweb.ProtectedValue.fromString(edits.notes));
  entry.fields.set('otp', edits.otp);
  entry.times.update();
}

export function createEntry(db: kdbxweb.Kdbx, edits: EntryEdits): kdbxweb.KdbxEntry {
  let group = db.groups[0];
  if (!group) {
    db.createDefaultGroup();
    group = db.groups[0];
  }
  if (!group) throw new Error('Vault has no group that can hold the new entry.');
  const entry = db.createEntry(group);
  entry.fields.set('Title', edits.title);
  entry.fields.set('UserName', edits.username);
  entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(edits.password));
  entry.fields.set('URL', edits.url);
  entry.fields.set('Notes', kdbxweb.ProtectedValue.fromString(edits.notes));
  entry.fields.set('otp', edits.otp);
  entry.times.update();
  return entry;
}

export async function saveVault(db: kdbxweb.Kdbx): Promise<Uint8Array> {
  const buffer = await db.save();
  return new Uint8Array(buffer);
}

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

export async function createKdbxBytes(name: string, password: string): Promise<Uint8Array> {
  await ensureKdbxCrypto();
  const credentials = new kdbxweb.KdbxCredentials(kdbxweb.ProtectedValue.fromString(password), null);
  await credentials.ready;
  const db = kdbxweb.Kdbx.create(credentials, name);
  db.createDefaultGroup();
  const buffer = await db.save();
  return new Uint8Array(buffer);
}
