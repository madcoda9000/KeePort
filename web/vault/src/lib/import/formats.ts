import type { CustomField } from '../fields.ts';
import { parseCsv } from './csv.ts';
import messages from '../../i18n/lib-import.ts';
import { translate } from '../../../../shared/i18n/core.ts';

/** The most entries one import may contain, so a wrong file cannot freeze the browser. */
export const MAX_IMPORT_ITEMS = 10_000;

/** The sources KeePort recognizes; `generic` is any other CSV file whose columns the user assigns. */
export type ImportFormat =
  | 'bitwarden-csv'
  | 'bitwarden-json'
  | 'onepassword'
  | 'apple'
  | 'chromium'
  | 'firefox'
  | 'keepassxc'
  | 'proton'
  | 'generic';

/** An entry read from the file, before it is added to the vault. */
export interface ImportItem {
  /** The line of the CSV file the record starts on (the header is line 1) or the position in a JSON file, for messages. */
  line: number;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  /** A TOTP URI or Base32 secret, or an empty string. */
  otp: string;
  /** The folder names from the top of the source down to the entry's folder; empty for none. */
  folder: string[];
  tags: string[];
  fields: CustomField[];
  created?: Date;
  modified?: Date;
}

/** A record of the file that is not imported, with the reason. */
export interface ImportProblem {
  line: number;
  /** The record's title or address, if it has one. */
  label: string;
  reason: 'noTitle' | 'unsupportedType';
  /** The source's type name for `unsupportedType`. */
  detail?: string;
}

/** What an entry field of a generic CSV column is used for. */
export type ColumnTarget = 'ignore' | 'title' | 'username' | 'password' | 'url' | 'notes' | 'folder' | 'otp' | 'tags';

export const COLUMN_TARGETS: readonly ColumnTarget[] = ['ignore', 'title', 'username', 'password', 'url', 'notes', 'folder', 'otp', 'tags'];

/** The result of reading an import file. */
export interface ParsedImport {
  format: ImportFormat;
  items: ImportItem[];
  problems: ImportProblem[];
  /** For a generic CSV file: the header and the data rows, so the user can assign the columns again. */
  table?: { headers: string[]; rows: string[][]; lines: number[]; mapping: ColumnTarget[] };
}

/** The values of one CSV row by lower-case header name. */
type Row = (name: string) => string;

/** One known CSV layout: how to recognize it and how to read a row. */
interface CsvFormat {
  id: Exclude<ImportFormat, 'bitwarden-json' | 'generic'>;
  /**
   * Checks the header row.
   * @param lower - The header names in lower case.
   * @param raw - The header names as written.
   */
  detect: (lower: ReadonlySet<string>, raw: readonly string[]) => boolean;
  /**
   * Reads one row into an item, or returns a problem for a record that cannot be imported.
   * @param get - Returns the cell of a column by lower-case header name.
   * @param line - The line number of the row.
   */
  read: (get: Row, line: number) => ImportItem | ImportProblem;
}

/**
 * Checks that all given headers are present.
 * @param lower - The header names in lower case.
 * @param names - The required names.
 */
function has(lower: ReadonlySet<string>, ...names: string[]): boolean {
  return names.every(/**
   * Checks one name.
   * @param name - A required header.
   */ (name) => lower.has(name));
}

/**
 * Returns the host name of an address without a leading "www.", or an empty string.
 * @param url - The address, with or without scheme.
 */
export function hostName(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Splits a folder path at slashes and backslashes and drops empty parts.
 * @param path - The folder path of the source.
 */
export function splitFolder(path: string): string[] {
  return path.split(/[/\\]/).map(/**
   * Trims one folder name.
   * @param part - One part of the path.
   */ (part) => part.trim()).filter(Boolean);
}

/**
 * Splits a tag list at commas and semicolons.
 * @param value - The tags of the source.
 */
export function splitTags(value: string): string[] {
  return value.split(/[,;]/).map(/**
   * Trims one tag.
   * @param tag - One tag.
   */ (tag) => tag.trim()).filter(Boolean);
}

/**
 * Splits a list of addresses that a source joined with commas; a comma only separates when a scheme follows.
 * @param value - One or more addresses.
 */
export function splitUrls(value: string): string[] {
  return value.split(/,(?=\s*[a-z][a-z0-9+.-]*:\/\/)/i).map(/**
   * Trims one address.
   * @param url - One address.
   */ (url) => url.trim()).filter(Boolean);
}

/**
 * Reads a date from seconds or milliseconds since 1970 or an ISO text; returns undefined for anything else.
 * @param value - The source value.
 * @param unit - Whether numbers are seconds or milliseconds.
 */
export function readDate(value: string, unit: 'seconds' | 'milliseconds' = 'milliseconds'): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const date = /^\d+$/.test(trimmed) ? new Date(Number(trimmed) * (unit === 'seconds' ? 1000 : 1)) : new Date(trimmed);
  return Number.isNaN(date.getTime()) || date.getFullYear() < 1980 ? undefined : date;
}

/**
 * Turns additional addresses into custom fields "URL 2", "URL 3" and so on.
 * @param urls - All addresses; the first one is the entry's URL.
 */
function extraUrlFields(urls: readonly string[]): CustomField[] {
  return urls.slice(1).map(/**
   * Creates the field of one additional address.
   * @param url - The address.
   * @param index - Its position after the first address.
   */ (url, index) => ({ name: translate(messages, 'extraUrl', { number: index + 2 }), value: url, protected: false }));
}

/**
 * Completes an item: a missing title is taken from the address; a record without title and address is a problem.
 * @param item - The item as read.
 */
export function finishItem(item: ImportItem): ImportItem | ImportProblem {
  const title = item.title.trim() || hostName(item.url) || item.url.trim();
  if (!title) return { line: item.line, label: item.username, reason: 'noTitle' };
  return { ...item, title };
}

/**
 * Creates an item with empty values.
 * @param line - The line number of the record.
 */
export function emptyItem(line: number): ImportItem {
  return { line, title: '', username: '', password: '', url: '', notes: '', otp: '', folder: [], tags: [], fields: [] };
}

/**
 * Reads Bitwarden's "fields" column: one "name: value" pair per line.
 * @param value - The column text.
 */
function bitwardenCsvFields(value: string): CustomField[] {
  return value.split(/\r?\n/).filter(Boolean).map(/**
   * Reads one field line.
   * @param line - A "name: value" line.
   */ (line) => {
    const colon = line.indexOf(': ');
    return colon === -1
      ? { name: line.trim(), value: '', protected: false }
      : { name: line.slice(0, colon).trim(), value: line.slice(colon + 2), protected: false };
  });
}

const CSV_FORMATS: readonly CsvFormat[] = [
  {
    id: 'bitwarden-csv',
    /**
     * Recognizes Bitwarden's columns.
     * @param lower - The header names in lower case.
     */
    detect: (lower) => has(lower, 'folder', 'type', 'name', 'login_uri', 'login_username', 'login_password'),
    /**
     * Reads a Bitwarden login or secure note.
     * @param get - The row's cells.
     * @param line - The line number.
     */
    read: (get, line) => {
      const type = get('type').trim().toLowerCase();
      if (type && type !== 'login' && type !== 'note') return { line, label: get('name'), reason: 'unsupportedType', detail: type };
      const urls = splitUrls(get('login_uri'));
      return finishItem({
        ...emptyItem(line),
        title: get('name'),
        username: get('login_username'),
        password: get('login_password'),
        url: urls[0] ?? '',
        notes: get('notes'),
        otp: get('login_totp'),
        folder: splitFolder(get('folder')),
        fields: [...extraUrlFields(urls), ...bitwardenCsvFields(get('fields'))]
      });
    }
  },
  {
    id: 'proton',
    /**
     * Recognizes Proton Pass's columns.
     * @param lower - The header names in lower case.
     */
    detect: (lower) => has(lower, 'type', 'name', 'url', 'email', 'username', 'password', 'note', 'totp', 'vault'),
    /**
     * Reads a Proton Pass login, alias or note.
     * @param get - The row's cells.
     * @param line - The line number.
     */
    read: (get, line) => {
      const type = get('type').trim().toLowerCase();
      if (type && !['login', 'note', 'alias'].includes(type)) return { line, label: get('name'), reason: 'unsupportedType', detail: type };
      const urls = splitUrls(get('url'));
      const username = get('username').trim();
      const email = get('email').trim();
      const fields = extraUrlFields(urls);
      if (username && email && username !== email) fields.push({ name: translate(messages, 'email'), value: email, protected: false });
      return finishItem({
        ...emptyItem(line),
        title: get('name'),
        username: username || email,
        password: get('password'),
        url: urls[0] ?? '',
        notes: get('note'),
        otp: get('totp'),
        folder: splitFolder(get('vault')),
        fields,
        created: readDate(get('createtime'), 'seconds'),
        modified: readDate(get('modifytime'), 'seconds')
      });
    }
  },
  {
    id: 'firefox',
    /**
     * Recognizes Firefox's columns.
     * @param lower - The header names in lower case.
     */
    detect: (lower) => has(lower, 'url', 'username', 'password', 'httprealm', 'formactionorigin'),
    /**
     * Reads a Firefox login; Firefox has no titles, so the title is the host name.
     * @param get - The row's cells.
     * @param line - The line number.
     */
    read: (get, line) => finishItem({
      ...emptyItem(line),
      username: get('username'),
      password: get('password'),
      url: get('url'),
      created: readDate(get('timecreated')),
      modified: readDate(get('timepasswordchanged'))
    })
  },
  {
    id: 'keepassxc',
    /**
     * Recognizes KeePassXC's columns, which KeePort's export uses too.
     * @param lower - The header names in lower case.
     */
    detect: (lower) => has(lower, 'group', 'title', 'username', 'password', 'url', 'notes'),
    /**
     * Reads a KeePassXC entry; the group path starts with the root folder, which is left out.
     * @param get - The row's cells.
     * @param line - The line number.
     */
    read: (get, line) => finishItem({
      ...emptyItem(line),
      title: get('title'),
      username: get('username'),
      password: get('password'),
      url: get('url'),
      notes: get('notes'),
      otp: get('totp'),
      folder: splitFolder(get('group')).slice(1),
      tags: splitTags(get('tags')),
      created: readDate(get('created')),
      modified: readDate(get('last modified'))
    })
  },
  {
    id: 'apple',
    /**
     * Recognizes Apple Passwords, whose columns look like 1Password's but spell "URL" in capitals.
     * @param lower - The header names in lower case.
     * @param raw - The header names as written.
     */
    detect: (lower, raw) => raw.includes('URL') && raw.includes('OTPAuth') && has(lower, 'title', 'username', 'password') && !lower.has('archived'),
    /**
     * Reads an Apple Passwords entry.
     * @param get - The row's cells.
     * @param line - The line number.
     */
    read: (get, line) => finishItem({
      ...emptyItem(line),
      title: get('title'),
      username: get('username'),
      password: get('password'),
      url: get('url'),
      notes: get('notes'),
      otp: get('otpauth')
    })
  },
  {
    id: 'onepassword',
    /**
     * Recognizes 1Password's columns.
     * @param lower - The header names in lower case.
     */
    detect: (lower) => has(lower, 'title', 'url', 'username', 'password'),
    /**
     * Reads a 1Password item.
     * @param get - The row's cells.
     * @param line - The line number.
     */
    read: (get, line) => finishItem({
      ...emptyItem(line),
      title: get('title'),
      username: get('username'),
      password: get('password'),
      url: get('url'),
      notes: get('notes'),
      otp: get('otpauth'),
      tags: splitTags(get('tags'))
    })
  },
  {
    id: 'chromium',
    /**
     * Recognizes the columns of Chrome, Edge, Brave and other Chromium browsers.
     * @param lower - The header names in lower case.
     */
    detect: (lower) => has(lower, 'name', 'url', 'username', 'password'),
    /**
     * Reads a browser login.
     * @param get - The row's cells.
     * @param line - The line number.
     */
    read: (get, line) => finishItem({
      ...emptyItem(line),
      title: get('name'),
      username: get('username'),
      password: get('password'),
      url: get('url'),
      notes: get('note')
    })
  }
];

/** Header names a generic CSV column is assigned to automatically, by target. */
const COLUMN_NAMES: Record<Exclude<ColumnTarget, 'ignore'>, readonly string[]> = {
  title: ['title', 'name', 'titel', 'account', 'site name', 'entry'],
  username: ['username', 'user name', 'user', 'login', 'login name', 'benutzername', 'email', 'e-mail'],
  password: ['password', 'passwort', 'pass', 'pwd', 'mot de passe'],
  url: ['url', 'uri', 'website', 'web site', 'site', 'address', 'link', 'adresse'],
  notes: ['notes', 'note', 'notizen', 'comments', 'comment', 'extra', 'description', 'remarques'],
  folder: ['folder', 'group', 'category', 'vault', 'path', 'ordner', 'gruppe', 'dossier'],
  otp: ['totp', 'otp', 'otpauth', '2fa', 'one-time password'],
  tags: ['tags', 'tag', 'labels', 'étiquettes']
};

/**
 * Assigns the columns of an unknown CSV file by their header names; each target is used once at most.
 * @param headers - The header row.
 */
export function guessMapping(headers: readonly string[]): ColumnTarget[] {
  const used = new Set<ColumnTarget>();
  return headers.map(/**
   * Finds the target of one column.
   * @param header - The column's header.
   */ (header) => {
    const name = header.trim().toLowerCase();
    const target = (Object.keys(COLUMN_NAMES) as Exclude<ColumnTarget, 'ignore'>[]).find(/**
     * Checks whether the header is a known name of the target.
     * @param candidate - One target.
     */ (candidate) => !used.has(candidate) && COLUMN_NAMES[candidate].includes(name));
    if (!target) return 'ignore';
    used.add(target);
    return target;
  });
}

/**
 * Reads the rows of an unknown CSV file with the columns assigned by the user.
 * @param rows - The data rows without the header.
 * @param mapping - The target of each column.
 * @param lines - The line of the file each data row starts on; without it, rows are counted from line 2.
 */
export function readGeneric(
  rows: readonly string[][],
  mapping: readonly ColumnTarget[],
  lines: readonly number[] = []
): Pick<ParsedImport, 'items' | 'problems'> {
  const items: ImportItem[] = [];
  const problems: ImportProblem[] = [];
  rows.forEach(/**
   * Reads one row.
   * @param row - The cells.
   * @param index - The row's position among the data rows.
   */ (row, index) => {
    const item = emptyItem(lines[index] ?? index + 2);
    mapping.forEach(/**
     * Copies one assigned cell into the item.
     * @param target - What the column is used for.
     * @param column - The column's position.
     */ (target, column) => {
      const value = row[column] ?? '';
      if (target === 'ignore' || !value) return;
      if (target === 'folder') item.folder = splitFolder(value);
      else if (target === 'tags') item.tags = splitTags(value);
      else item[target] = target === 'password' || target === 'notes' ? value : value.trim();
    });
    const result = finishItem(item);
    if ('reason' in result) problems.push(result);
    else items.push(result);
  });
  return { items, problems };
}

/**
 * Reads a CSV export: a known layout is read directly, any other file with guessed columns.
 * @param text - The file content.
 */
export function parseCsvImport(text: string): ParsedImport {
  const { rows, lines } = parseCsv(text);
  const [header, ...data] = rows;
  const dataLines = lines.slice(1);
  if (!header || !data.length) throw new Error(translate(messages, 'noEntries'));
  if (data.length > MAX_IMPORT_ITEMS) throw new Error(translate(messages, 'tooMany', { max: MAX_IMPORT_ITEMS }));
  const raw = header.map(/**
   * Trims one header name.
   * @param name - The header cell.
   */ (name) => name.trim());
  const lower = new Set(raw.map(/**
   * Lower-cases one header name.
   * @param name - The trimmed header cell.
   */ (name) => name.toLowerCase()));
  const format = CSV_FORMATS.find(/**
   * Checks one known layout.
   * @param candidate - A known layout.
   */ (candidate) => candidate.detect(lower, raw));
  if (!format) {
    const mapping = guessMapping(raw);
    return { format: 'generic', ...readGeneric(data, mapping, dataLines), table: { headers: raw, rows: data, lines: dataLines, mapping } };
  }
  const columns = new Map<string, number>();
  raw.forEach(/**
   * Remembers the first position of each header.
   * @param name - The header name.
   * @param index - Its column.
   */ (name, index) => {
    if (!columns.has(name.toLowerCase())) columns.set(name.toLowerCase(), index);
  });
  const items: ImportItem[] = [];
  const problems: ImportProblem[] = [];
  data.forEach(/**
   * Reads one row with the layout.
   * @param row - The cells.
   * @param index - The row's position among the data rows.
   */ (row, index) => {
    const result = format.read(/**
     * Returns a cell by header name.
     * @param name - The lower-case header name.
     */ (name) => {
      const column = columns.get(name);
      return column === undefined ? '' : row[column] ?? '';
    }, dataLines[index]);
    if ('reason' in result) problems.push(result);
    else items.push(result);
  });
  return { format: format.id, items, problems };
}
