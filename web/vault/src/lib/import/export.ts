import * as kdbxweb from 'kdbxweb';
import { isTemplateEntry } from '../fields.ts';
import { requireGroup } from '../groups.ts';
import { formatCsv } from './csv.ts';

/** The columns of the export, as KeePassXC writes them; KeePassXC, Bitwarden and KeePort read this layout. */
export const EXPORT_COLUMNS = ['Group', 'Title', 'Username', 'Password', 'URL', 'Notes', 'TOTP', 'Tags', 'Last Modified', 'Created'] as const;

/** The column whose cells are never changed by the formula protection, because a changed password would be wrong. */
const PASSWORD_COLUMN = EXPORT_COLUMNS.indexOf('Password');

/**
 * Reads a plain or protected field as text.
 * @param value - The field value, if any.
 */
function fieldText(value: kdbxweb.KdbxEntryField | undefined): string {
  if (value === undefined) return '';
  return value instanceof kdbxweb.ProtectedValue ? value.getText() : String(value);
}

/**
 * Checks whether a group is the recycle bin or the templates folder.
 * @param db - The unlocked database.
 * @param group - The group to check.
 */
function isSpecial(db: kdbxweb.Kdbx, group: kdbxweb.KdbxGroup): boolean {
  return [db.meta.recycleBinUuid, db.meta.entryTemplatesGroup].some(/**
   * Compares with one special folder reference.
   * @param uuid - The reference, if set.
   */ (uuid) => Boolean(uuid && !uuid.empty && group.uuid.equals(uuid)));
}

/**
 * Returns the folder path of a group from the root folder down, joined with "/" as KeePassXC does.
 * @param group - The group.
 */
function groupPath(group: kdbxweb.KdbxGroup): string {
  const names: string[] = [];
  for (let current: kdbxweb.KdbxGroup | undefined = group; current; current = current.parentGroup) names.unshift(current.name ?? '');
  return names.join('/');
}

/**
 * Formats a date for the export, or an empty string.
 * @param date - The date, if any.
 */
function isoDate(date: Date | undefined): string {
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
}

/**
 * Prefixes a cell that a spreadsheet program would run as a formula with an apostrophe.
 * @param value - The cell text.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Collects the export rows of a folder and its subfolders; the recycle bin, the templates folder and template
 * entries are left out.
 * @param db - The unlocked database.
 * @param group - The folder to export.
 * @param rows - The rows to append to.
 */
function collect(db: kdbxweb.Kdbx, group: kdbxweb.KdbxGroup, rows: string[][]) {
  if (isSpecial(db, group)) return;
  const path = groupPath(group);
  for (const entry of group.entries) {
    if (isTemplateEntry(entry)) continue;
    rows.push([
      path,
      fieldText(entry.fields.get('Title')),
      fieldText(entry.fields.get('UserName')),
      fieldText(entry.fields.get('Password')),
      fieldText(entry.fields.get('URL')),
      fieldText(entry.fields.get('Notes')),
      fieldText(entry.fields.get('otp')),
      entry.tags.join(','),
      isoDate(entry.times.lastModTime),
      isoDate(entry.times.creationTime)
    ]);
  }
  for (const child of group.groups) collect(db, child, rows);
}

/**
 * Builds the CSV export of the whole vault or of one folder with its subfolders. Custom fields, attachments and the
 * history are not part of it.
 * @param db - The unlocked database.
 * @param options - The folder to export (omit for the whole vault) and whether formulas are neutralized.
 */
export function exportCsv(db: kdbxweb.Kdbx, options: { folderId?: string; neutralizeFormulas: boolean }): { csv: string; count: number } {
  const rows: string[][] = [];
  const groups = options.folderId ? [requireGroup(db, options.folderId)] : db.groups;
  for (const group of groups) collect(db, group, rows);
  const safe = options.neutralizeFormulas
    ? rows.map(/**
       * Neutralizes the cells of one row except the password.
       * @param row - One exported entry.
       */ (row) => row.map(/**
         * Neutralizes one cell.
         * @param cell - The cell text.
         * @param column - Its column.
         */ (cell, column) => (column === PASSWORD_COLUMN ? cell : neutralizeFormula(cell))))
    : rows;
  return { csv: formatCsv([[...EXPORT_COLUMNS], ...safe]), count: rows.length };
}

/**
 * Builds the file name of an export: "keeport-", the vault name without ".kdbx" and the date.
 * @param vaultName - The vault's file name.
 * @param date - The export date.
 */
export function exportFileName(vaultName: string, date: Date): string {
  const base = vaultName.replace(/\.kdbx$/i, '').replace(/[\\/:*?"<>|]+/g, '-') || 'vault';
  const pad = /**
   * Pads a date part to two digits.
   * @param value - The number.
   */ (value: number) => String(value).padStart(2, '0');
  return `keeport-${base}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`;
}

/**
 * Lets the browser save the CSV text as a file.
 * @param name - The suggested file name.
 * @param csv - The file content.
 */
export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(/** Releases the temporary URL after the browser has started the download. */ () => URL.revokeObjectURL(url), 1000);
}
