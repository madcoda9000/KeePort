import * as kdbxweb from 'kdbxweb';
import { readCustomFields, readExpiry } from './fields.ts';

/** One state of an entry in its history: the current state or a saved earlier version. */
export interface HistoryItem {
  /** The index in `entry.history`, or null for the current state. */
  index: number | null;
  /** When this state was saved. */
  modified: Date | undefined;
  title: string;
  /** What this state changed compared to the state before it; null for the oldest saved version. */
  changes: string[] | null;
  version: kdbxweb.KdbxEntry;
}

/**
 * Reads a plain or protected field as text.
 * @param value - The raw field value.
 */
function text(value: kdbxweb.KdbxEntryField | undefined): string {
  if (value === undefined) return '';
  return value instanceof kdbxweb.ProtectedValue ? value.getText() : String(value);
}

const STANDARD_LABELS: readonly [string, string][] = [
  ['Title', 'Title'],
  ['UserName', 'Username'],
  ['Password', 'Password'],
  ['URL', 'Website'],
  ['Notes', 'Notes'],
  ['otp', 'TOTP']
];

/**
 * Lists the parts of an entry that differ between two states, by name only: values never appear in the result.
 * @param older - The earlier state.
 * @param newer - The later state.
 */
export function describeChanges(older: kdbxweb.KdbxEntry, newer: kdbxweb.KdbxEntry): string[] {
  const changes: string[] = [];
  for (const [field, label] of STANDARD_LABELS) {
    if (text(older.fields.get(field)) !== text(newer.fields.get(field))) changes.push(label);
  }
  const before = new Map(readCustomFields(older).map(/**
   * Maps a custom field to its value.
   * @param field - One custom field.
   */ (field) => [field.name, field.value]));
  const after = new Map(readCustomFields(newer).map(/**
   * Maps a custom field to its value.
   * @param field - One custom field.
   */ (field) => [field.name, field.value]));
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(name) !== after.get(name)) changes.push(name);
  }
  const binaryKey = /**
   * Summarizes the attachment names of a state.
   * @param entry - One state.
   */ (entry: kdbxweb.KdbxEntry) => [...entry.binaries.keys()].sort().join('\n');
  if (binaryKey(older) !== binaryKey(newer)) changes.push('Attachments');
  if ([...older.tags].sort().join('\n') !== [...newer.tags].sort().join('\n')) changes.push('Tags');
  if (readExpiry(older) !== readExpiry(newer)) changes.push('Expiry');
  if (older.icon !== newer.icon || older.customIcon?.id !== newer.customIcon?.id) changes.push('Icon');
  return changes;
}

/**
 * Lists the current state and the saved versions of an entry, newest first, each with what it changed.
 * @param entry - The entry whose history is listed.
 */
export function listHistory(entry: kdbxweb.KdbxEntry): HistoryItem[] {
  const states = [...entry.history, entry];
  const items: HistoryItem[] = states.map(/**
   * Describes one state.
   * @param version - The state.
   * @param position - Its position from oldest to newest.
   */ (version, position) => ({
    index: position < entry.history.length ? position : null,
    modified: version.times.lastModTime,
    title: text(version.fields.get('Title')) || 'Untitled',
    changes: position === 0 ? null : describeChanges(states[position - 1], version),
    version
  }));
  return items.reverse();
}

/**
 * Estimates the size of a state in bytes the way KeePass does: field names and values as UTF-16 plus attachments.
 * @param db - The database holding shared attachments.
 * @param entry - The state to measure.
 */
function estimateSize(db: kdbxweb.Kdbx, entry: kdbxweb.KdbxEntry): number {
  let size = 0;
  for (const [name, value] of entry.fields) size += (name.length + text(value).length) * 2;
  for (const binary of entry.binaries.values()) {
    const value = kdbxweb.KdbxBinaries.isKdbxBinaryWithHash(binary) ? db.binaries.getValueByHash(binary.hash) ?? binary.value : binary;
    if (value) size += value.byteLength;
  }
  for (const tag of entry.tags) size += tag.length * 2;
  return size;
}

/**
 * Removes the oldest versions of an entry until it keeps at most `Meta/HistoryMaxItems` versions and their estimated
 * size stays within `Meta/HistoryMaxSize`, like KeePass. Negative limits mean unlimited. Returns how many versions
 * were removed. Removal goes through kdbxweb so merges with other clients do not bring the versions back.
 * @param db - The database providing the limits.
 * @param entry - The entry whose history is trimmed.
 */
export function trimHistory(db: kdbxweb.Kdbx, entry: kdbxweb.KdbxEntry): number {
  let removed = 0;
  const maxItems = db.meta.historyMaxItems;
  if (maxItems !== undefined && maxItems >= 0) {
    const excess = entry.history.length - maxItems;
    if (excess > 0) {
      entry.removeHistory(0, excess);
      removed += excess;
    }
  }
  const maxSize = db.meta.historyMaxSize;
  if (maxSize !== undefined && maxSize >= 0) {
    let total = entry.history.reduce(/**
     * Adds the size of one version.
     * @param sum - The size so far.
     * @param version - One version.
     */ (sum, version) => sum + estimateSize(db, version), 0);
    while (entry.history.length > 0 && total > maxSize) {
      total -= estimateSize(db, entry.history[0]);
      entry.removeHistory(0);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Saves the current state of an entry as a version and trims the history to the vault's limits.
 * @param db - The database providing the limits.
 * @param entry - The entry about to be changed.
 */
export function backupEntry(db: kdbxweb.Kdbx, entry: kdbxweb.KdbxEntry) {
  entry.pushHistory();
  trimHistory(db, entry);
}

/**
 * Restores a saved version like KeePass: the current state is saved as a version first, then the entry takes over
 * the old version's fields, attachments, tags, icon and expiry. Its identity, creation time and history stay.
 * @param db - The database providing the history limits.
 * @param entry - The entry to restore.
 * @param index - The index of the version in `entry.history`.
 */
export function restoreVersion(db: kdbxweb.Kdbx, entry: kdbxweb.KdbxEntry, index: number) {
  const version = entry.history[index];
  if (!version) throw new Error('This version no longer exists. Reload the vault and try again.');
  const uuid = entry.uuid;
  const created = entry.times.creationTime;
  entry.pushHistory();
  const history = entry.history;
  entry.copyFrom(version);
  entry.uuid = uuid;
  entry.history = history;
  entry.times.creationTime = created;
  entry.times.update();
  trimHistory(db, entry);
}

/**
 * Removes one saved version from an entry's history.
 * @param entry - The entry.
 * @param index - The index of the version in `entry.history`.
 */
export function deleteVersion(entry: kdbxweb.KdbxEntry, index: number) {
  if (!entry.history[index]) throw new Error('This version no longer exists. Reload the vault and try again.');
  entry.removeHistory(index);
}

/**
 * Finds an entry anywhere in the database by its UUID or throws.
 * @param db - The unlocked database.
 * @param entryId - The base64 UUID of the entry.
 */
export function requireEntry(db: kdbxweb.Kdbx, entryId: string): kdbxweb.KdbxEntry {
  for (const group of db.groups) {
    for (const entry of group.allEntries()) {
      if (entry.uuid.id === entryId) return entry;
    }
  }
  throw new Error('The entry no longer exists. Reload the vault and try again.');
}
