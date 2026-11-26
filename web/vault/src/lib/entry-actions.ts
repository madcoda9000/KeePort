import * as kdbxweb from 'kdbxweb';
import messages from '../i18n/lib-entry-actions.ts';
import { translate } from '../../../shared/i18n/core.ts';

/**
 * Collects the entries with the given IDs from all groups of the database.
 * @param db - The unlocked database.
 * @param entryIds - The base64 UUIDs of the entries.
 */
function findEntries(db: kdbxweb.Kdbx, entryIds: Iterable<string>): kdbxweb.KdbxEntry[] {
  const wanted = new Set(entryIds);
  const entries = db.groups.flatMap(/**
   * Collects the entries of one root group.
   * @param group - A root group.
   */ (group) => [...group.allEntries()]).filter(/**
   * Keeps the requested entries.
   * @param entry - One entry.
   */ (entry) => wanted.has(entry.uuid.id));
  if (entries.length !== wanted.size) throw new Error(translate(messages, 'entriesMissing'));
  return entries;
}

/**
 * Returns the recycle bin, creating it when the database uses one but has none yet, or null when the recycle bin is
 * turned off for this database.
 * @param db - The unlocked database.
 */
function recycleBin(db: kdbxweb.Kdbx): kdbxweb.KdbxGroup | null {
  if (db.meta.recycleBinEnabled === false) return null;
  const existing = db.meta.recycleBinUuid && !db.meta.recycleBinUuid.empty ? db.getGroup(db.meta.recycleBinUuid) : undefined;
  if (existing) return existing;
  db.createRecycleBin();
  return db.meta.recycleBinUuid ? db.getGroup(db.meta.recycleBinUuid) ?? null : null;
}

/**
 * Checks whether an entry lies in the recycle bin or one of its subfolders.
 * @param db - The unlocked database.
 * @param entry - The entry to check.
 */
function inRecycleBin(db: kdbxweb.Kdbx, entry: kdbxweb.KdbxEntry): boolean {
  const bin = db.meta.recycleBinUuid;
  if (!bin || bin.empty) return false;
  for (let group = entry.parentGroup; group; group = group.parentGroup) {
    if (group.uuid.equals(bin)) return true;
  }
  return false;
}

/**
 * Deletes entries like KeePass does: entries outside the recycle bin move into it, entries already in the recycle bin
 * (or all entries when the database has no recycle bin) are removed permanently and recorded as deleted objects, so
 * other clients drop them when they merge.
 * @param db - The unlocked database to change.
 * @param entryIds - The base64 UUIDs of the entries to delete.
 */
export function deleteEntries(db: kdbxweb.Kdbx, entryIds: Iterable<string>): { recycled: number; removed: number } {
  const entries = findEntries(db, entryIds);
  let recycled = 0;
  let removed = 0;
  for (const entry of entries) {
    const bin = inRecycleBin(db, entry) ? null : recycleBin(db);
    db.move(entry, bin);
    if (bin) recycled += 1;
    else removed += 1;
  }
  return { recycled, removed };
}

/**
 * Removes everything in the recycle bin permanently, entries and subfolders, and returns how many entries that were.
 * @param db - The unlocked database to change.
 */
export function emptyRecycleBin(db: kdbxweb.Kdbx): number {
  const bin = db.meta.recycleBinUuid && !db.meta.recycleBinUuid.empty ? db.getGroup(db.meta.recycleBinUuid) : undefined;
  if (!bin) return 0;
  let count = 0;
  for (const entry of [...bin.entries]) {
    db.move(entry, null);
    count += 1;
  }
  for (const group of [...bin.groups]) {
    count += [...group.allEntries()].length;
    db.move(group, null);
  }
  return count;
}

/**
 * Checks whether an entry has an expiry date that has passed.
 * @param entry - The entry to check.
 * @param now - The current time.
 */
export function isExpired(entry: kdbxweb.KdbxEntry, now: Date): boolean {
  const date = entry.times.expires ? entry.times.expiryTime : undefined;
  return Boolean(date && !Number.isNaN(date.getTime()) && date.getTime() <= now.getTime());
}
