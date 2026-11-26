import type * as kdbxweb from 'kdbxweb';
import { backupEntry, requireEntry } from './history.ts';
import messages from '../i18n/lib-tags.ts';
import { translate } from '../../../shared/i18n/core.ts';

/** Longest tag KeePort accepts. */
export const MAX_TAG_LENGTH = 64;

/** Characters KeePass uses to separate tags when reading a vault, so they cannot appear inside a tag. */
const SEPARATORS = /[,;:]/;

/**
 * Trims a tag and collapses inner whitespace.
 * @param tag - The tag as typed.
 */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ');
}

/**
 * Validates a new tag and returns an error message, or null when it can be added.
 * @param tag - The tag as typed.
 * @param existing - The entry's current tags.
 */
export function tagError(tag: string, existing: readonly string[]): string | null {
  const value = normalizeTag(tag);
  if (!value) return translate(messages, 'required');
  if (value.length > MAX_TAG_LENGTH) return translate(messages, 'tooLong', { max: MAX_TAG_LENGTH });
  if (SEPARATORS.test(value)) return translate(messages, 'separators');
  if (existing.some(/**
   * Detects the same tag ignoring case.
   * @param other - One existing tag.
   */ (other) => other.toLowerCase() === value.toLowerCase())) return translate(messages, 'duplicate', { tag: value });
  return null;
}

/**
 * Lists the tags of the given entries with how often they occur, sorted by name. Tags that differ only in case are
 * counted together under their first spelling.
 * @param entries - The entries to count, e.g. all regular entries without templates and recycle bin.
 */
export function listTags(entries: readonly { tags: readonly string[] }[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const entry of entries) {
    const seen = new Set<string>();
    for (const tag of entry.tags) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const item = counts.get(key);
      if (item) item.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort(/**
   * Sorts tags by name.
   * @param a - The first tag.
   * @param b - The second tag.
   */ (a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }));
}

/**
 * Checks whether an entry has a tag, ignoring case.
 * @param tags - The entry's tags.
 * @param tag - The tag to look for.
 */
export function hasTag(tags: readonly string[], tag: string): boolean {
  const key = tag.toLowerCase();
  return tags.some(/**
   * Compares one tag.
   * @param item - One of the entry's tags.
   */ (item) => item.toLowerCase() === key);
}

/**
 * Adds and removes tags on several entries. Changed entries get a history version and a new modification time, like
 * any edit. Returns how many entries changed.
 * @param db - The unlocked database to change.
 * @param entryIds - The base64 UUIDs of the entries.
 * @param add - Tags to add where missing.
 * @param remove - Tags to remove, ignoring case.
 */
export function setEntryTags(db: kdbxweb.Kdbx, entryIds: Iterable<string>, add: readonly string[], remove: readonly string[]): number {
  const additions = add.map(normalizeTag).filter(Boolean);
  for (const tag of additions) {
    const error = tagError(tag, []);
    if (error) throw new Error(error);
  }
  let changed = 0;
  for (const id of entryIds) {
    const entry = requireEntry(db, id);
    const next = entry.tags.filter(/**
     * Drops removed tags.
     * @param tag - One current tag.
     */ (tag) => !hasTag(remove, tag));
    for (const tag of additions) if (!hasTag(next, tag)) next.push(tag);
    if (next.join('\n') === entry.tags.join('\n')) continue;
    backupEntry(db, entry);
    entry.tags = next;
    entry.times.update();
    changed += 1;
  }
  return changed;
}
