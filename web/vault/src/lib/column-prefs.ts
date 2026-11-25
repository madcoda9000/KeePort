/** Columns of the entry list that can be hidden; the title is always shown. */
export const OPTIONAL_COLUMNS = ['username', 'password', 'totp', 'modified', 'website'] as const;
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];

const STORAGE_KEY = 'keeport-hidden-columns';

/** Minimal storage interface, so tests can pass a substitute. */
interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Returns the browser's local storage, or null when it is not available (private mode, blocked site data).
 */
function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads the hidden columns of the entry list from this browser. Unknown or broken values are ignored.
 * @param storage - The storage to read; defaults to local storage.
 */
export function readHiddenColumns(storage: KeyValueStorage | null = defaultStorage()): Set<OptionalColumn> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter(/**
     * Keeps known column IDs.
     * @param value - One stored value.
     */ (value): value is OptionalColumn => (OPTIONAL_COLUMNS as readonly unknown[]).includes(value)) : []);
  } catch {
    return new Set();
  }
}

/**
 * Stores the hidden columns in this browser; failures (e.g. blocked storage) are ignored.
 * @param hidden - The hidden columns.
 * @param storage - The storage to write; defaults to local storage.
 */
export function writeHiddenColumns(hidden: ReadonlySet<OptionalColumn>, storage: KeyValueStorage | null = defaultStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify([...hidden]));
  } catch {
    /* the choice then lasts for this page view only */
  }
}
