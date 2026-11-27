import type * as kdbxweb from 'kdbxweb';
import { createEntry } from '../kdbx.ts';
import { MAX_FIELD_NAME_LENGTH, customFieldNameError, type CustomField } from '../fields.ts';
import { MAX_FOLDER_NAME_LENGTH, folderNameError, requireGroup, rootGroup } from '../groups.ts';
import { MAX_TAG_LENGTH, normalizeTag } from '../tags.ts';
import { hostName, type ImportItem } from './formats.ts';
import messages from '../../i18n/lib-import.ts';
import { translate } from '../../../../shared/i18n/core.ts';

/** The values that decide whether two entries are the same login. */
interface DuplicateFields {
  title: string;
  username: string;
  url: string;
}

/** Where imported entries go. */
export type ImportTarget = { kind: 'new'; name: string } | { kind: 'folder'; id: string };

/** What an import changed. */
export interface ImportOutcome {
  imported: number;
  /** The folder the entries were imported into. */
  folderId: string;
}

/**
 * Returns the key two entries share when they are the same login: the address's host name (or the title when there is
 * no address) and the username, both without case.
 * @param entry - The entry or item.
 */
export function duplicateKey(entry: DuplicateFields): string {
  const site = hostName(entry.url) || entry.title.trim().toLowerCase();
  return `${site}\n${entry.username.trim().toLowerCase()}`;
}

/**
 * Finds the items that already exist in the vault: same host name (or title) and username as an existing entry.
 * @param items - The items to import.
 * @param existing - The vault's regular entries, without templates and recycle bin.
 */
export function findDuplicates(items: readonly ImportItem[], existing: readonly DuplicateFields[]): Set<ImportItem> {
  const keys = new Set(existing.map(duplicateKey));
  return new Set(items.filter(/**
   * Checks one item.
   * @param item - The item to import.
   */ (item) => keys.has(duplicateKey(item))));
}

/**
 * Returns the name of the new import folder: the requested name, or with " (2)", " (3)" … when the root folder
 * already has a folder of that name.
 * @param db - The unlocked database.
 * @param name - The requested name.
 */
export function freeFolderName(db: kdbxweb.Kdbx, name: string): string {
  const root = rootGroup(db).uuid.id;
  const base = name.trim().slice(0, MAX_FOLDER_NAME_LENGTH - 6);
  let candidate = base;
  for (let number = 2; folderNameError(db, root, candidate); number += 1) candidate = `${base} (${number})`;
  return candidate;
}

/**
 * Returns the subfolder of a folder with the given name, creating it when there is none; the recycle bin and the
 * templates folder are never reused.
 * @param db - The unlocked database.
 * @param parent - The folder that contains the subfolder.
 * @param name - The subfolder's name.
 */
function childFolder(db: kdbxweb.Kdbx, parent: kdbxweb.KdbxGroup, name: string): kdbxweb.KdbxGroup {
  const wanted = name.slice(0, MAX_FOLDER_NAME_LENGTH).toLocaleLowerCase();
  const special = [db.meta.recycleBinUuid, db.meta.entryTemplatesGroup];
  const existing = parent.groups.find(/**
   * Finds a regular subfolder with the name.
   * @param group - One subfolder.
   */ (group) => (group.name ?? '').trim().toLocaleLowerCase() === wanted && !special.some(/**
     * Checks one special folder reference.
     * @param uuid - The reference, if set.
     */ (uuid) => uuid && !uuid.empty && group.uuid.equals(uuid)));
  return existing ?? db.createGroup(parent, name.slice(0, MAX_FOLDER_NAME_LENGTH));
}

/**
 * Makes the custom field names of an item usable: empty, reserved and repeated names get a fallback or a number.
 * @param fields - The item's fields.
 */
function usableFields(fields: readonly CustomField[]): CustomField[] {
  const out: CustomField[] = [];
  for (const field of fields) {
    let base = field.name.trim().replace(/^@+/, '').slice(0, MAX_FIELD_NAME_LENGTH - 5);
    if (!base || /^(_etm_|KP2A_)/.test(base)) base = `${translate(messages, 'fieldFallback')} ${base}`.trim();
    const names = out.map(/**
     * Selects a field name.
     * @param item - A field already accepted.
     */ (item) => item.name);
    let name = base;
    for (let number = 2; customFieldNameError(name, names); number += 1) name = `${base} (${number})`;
    out.push({ name, value: field.value, protected: field.protected });
  }
  return out;
}

/**
 * Makes tags usable: separators become spaces, overlong tags are cut and repeated tags dropped.
 * @param tags - The item's tags.
 */
function usableTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const value = normalizeTag(tag.replace(/[,;:]/g, ' ')).slice(0, MAX_TAG_LENGTH).trim();
    if (value && !out.some(/**
     * Detects the same tag ignoring case.
     * @param other - A tag already accepted.
     */ (other) => other.toLowerCase() === value.toLowerCase())) out.push(value);
  }
  return out;
}

/**
 * Adds the items to the vault as new entries. Folder paths of the source are recreated below the target when wanted;
 * the source's dates are kept.
 * @param db - The unlocked database to change.
 * @param items - The items to add.
 * @param target - A new folder in the root folder, or an existing folder.
 * @param keepFolders - Whether the source's folders are recreated below the target.
 */
export function importItems(db: kdbxweb.Kdbx, items: readonly ImportItem[], target: ImportTarget, keepFolders: boolean): ImportOutcome {
  const destination = target.kind === 'new' ? db.createGroup(rootGroup(db), freeFolderName(db, target.name)) : requireGroup(db, target.id);
  for (const item of items) {
    let group = destination;
    if (keepFolders) for (const name of item.folder) group = childFolder(db, group, name);
    const entry = createEntry(db, {
      title: item.title,
      username: item.username,
      password: item.password,
      url: item.url,
      notes: item.notes,
      otp: item.otp,
      customFields: usableFields(item.fields),
      tags: usableTags(item.tags)
    }, group.uuid.id);
    if (item.created) entry.times.creationTime = item.created;
    if (item.modified ?? item.created) entry.times.lastModTime = item.modified ?? item.created;
  }
  return { imported: items.length, folderId: destination.uuid.id };
}
