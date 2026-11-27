import { useMemo, useState, type ChangeEvent } from 'react';
import { CheckCircle2Icon, FileUpIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { TableCell, TableRow } from '@/components/ui/table';
import type { FolderNode } from '@/lib/groups';
import { parseImport } from '@/lib/import/index';
import { COLUMN_TARGETS, readGeneric, type ColumnTarget, type ImportItem, type ParsedImport } from '@/lib/import/formats';
import { findDuplicates, type ImportOutcome, type ImportTarget } from '@/lib/import/apply';
import { DataTable, type TableColumn } from '@shared/data-table';
import { matchesTableSearch } from '@shared/table-data';
import { ACCENTS } from '@shared/accent';
import messages from '@/i18n/import-dialog';
import libMessages from '@/i18n/lib-import';
import { translate } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';

/** The largest file the dialog reads, so a wrong file cannot freeze the browser. */
const MAX_FILE_MB = 20;

/** The values of an existing entry used to find duplicates. */
interface ExistingEntry {
  title: string;
  username: string;
  url: string;
}

/** One row of the preview. */
interface PreviewRow {
  item: ImportItem;
  duplicate: boolean;
}

/**
 * Builds a preview column whose header follows the current language.
 * @param id - The column ID and catalog suffix.
 * @param sortValue - Picks the value the column sorts by.
 */
function column(
  id: 'folder' | 'title' | 'username' | 'url' | 'status',
  sortValue: (row: PreviewRow) => string
): TableColumn<PreviewRow> {
  return {
    id,
    /** The header in the current language. */
    get label() {
      return translate(messages, `col_${id}`);
    },
    sortValue
  };
}

const PREVIEW_COLUMNS: readonly TableColumn<PreviewRow>[] = [
  /**
   * Sorts by folder path.
   * @param row - One preview row.
   */
  column('folder', (row) => row.item.folder.join(' / ')),
  /**
   * Sorts by title.
   * @param row - One preview row.
   */
  column('title', (row) => row.item.title),
  /**
   * Sorts by username.
   * @param row - One preview row.
   */
  column('username', (row) => row.item.username),
  /**
   * Sorts by address.
   * @param row - One preview row.
   */
  column('url', (row) => row.item.url),
  /**
   * Sorts duplicates after new entries.
   * @param row - One preview row.
   */
  column('status', (row) => (row.duplicate ? '1' : '0'))
];

/**
 * Formats a date as YYYY-MM-DD in local time, for the name of the import folder.
 * @param date - The date.
 */
function localDate(date: Date): string {
  const pad = /**
   * Pads a date part to two digits.
   * @param value - The number.
   */ (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Lets the user import entries from another password manager into the open vault.
 * @param props - Whether the dialog is open, the vault's regular entries, the current folder, the busy state and the callbacks.
 */
export function ImportDialog({
  open,
  existing,
  currentFolder,
  busy,
  onImport,
  onClose
}: {
  open: boolean;
  existing: readonly ExistingEntry[];
  /** The folder shown in the list, offered as destination unless it is in the recycle bin. */
  currentFolder: FolderNode | null;
  busy: boolean;
  /** Adds the items to the vault and saves it; resolves to null when that failed. */
  onImport: (items: ImportItem[], target: ImportTarget, keepFolders: boolean) => Promise<ImportOutcome | null>;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={/**
     * Closes the dialog unless the import is running.
     * @param next - The requested dialog state.
     */ (next) => {
      if (!next && !busy) onClose();
    }}>
      {open && <ImportForm existing={existing} currentFolder={currentFolder} busy={busy} onImport={onImport} onClose={onClose} />}
    </Dialog>
  );
}

/**
 * The steps of the import dialog; remounted on every opening so no old file is kept.
 * @param props - The vault's regular entries, the current folder, the busy state and the callbacks.
 */
function ImportForm({
  existing,
  currentFolder,
  busy,
  onImport,
  onClose
}: {
  existing: readonly ExistingEntry[];
  currentFolder: FolderNode | null;
  busy: boolean;
  onImport: (items: ImportItem[], target: ImportTarget, keepFolders: boolean) => Promise<ImportOutcome | null>;
  onClose: () => void;
}) {
  const t = useT(messages);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [mapping, setMapping] = useState<ColumnTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [destination, setDestination] = useState<'new' | 'current'>('new');
  const [keepFolders, setKeepFolders] = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [done, setDone] = useState<{ imported: number; skipped: number; folder: string } | null>(null);
  const [folderName] = useState(/** Names the new folder after the date the dialog was opened. */ () => translate(libMessages, 'importedFolder', { date: localDate(new Date()) }));
  const canUseCurrent = Boolean(currentFolder && !currentFolder.inRecycleBin && !currentFolder.isTemplates);

  const read = useMemo(/** Reads the items again when the user assigns the columns of a generic file. */ () => {
    if (!parsed) return { items: [], problems: [] };
    return parsed.table ? readGeneric(parsed.table.rows, mapping, parsed.table.lines) : parsed;
  }, [parsed, mapping]);
  const duplicates = useMemo(/** Finds the items that already exist in the vault. */ () => findDuplicates(read.items, existing), [read.items, existing]);
  const rows = useMemo(/** Builds the preview rows. */ () => read.items.map(/**
   * Marks one item as new or existing.
   * @param item - One item of the file.
   */ (item) => ({ item, duplicate: duplicates.has(item) })), [read.items, duplicates]);
  const toImport = skipDuplicates ? read.items.filter(/**
   * Keeps items that do not exist yet.
   * @param item - One item of the file.
   */ (item) => !duplicates.has(item)) : read.items;

  /**
   * Reads the chosen file in the browser.
   * @param event - The change event of the file input.
   */
  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setParsed(null);
    setError(null);
    setFileName(file?.name ?? '');
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(t('fileTooLarge', { size: MAX_FILE_MB }));
      return;
    }
    setReading(true);
    try {
      const result = parseImport(await file.text());
      setParsed(result);
      setMapping(result.table?.mapping ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('readFailed'));
    } finally {
      setReading(false);
    }
  }

  /**
   * Assigns a column of a generic file.
   * @param index - The column.
   * @param target - What it contains.
   */
  function assign(index: number, target: ColumnTarget) {
    /**
     * Builds the new assignment; a target other than "do not import" is taken away from other columns.
     * @param current - The current assignment.
     */
    setMapping((current) => current.map(/**
     * Updates one column.
     * @param value - Its current target.
     * @param column - Its position.
     */ (value, column) => (column === index ? target : target !== 'ignore' && value === target ? 'ignore' : value)));
  }

  /** Imports the items and shows the summary. */
  async function runImport() {
    const target: ImportTarget = destination === 'current' && currentFolder && canUseCurrent
      ? { kind: 'folder', id: currentFolder.id }
      : { kind: 'new', name: folderName };
    const outcome = await onImport(toImport, target, keepFolders);
    if (!outcome) return;
    setDone({
      imported: outcome.imported,
      skipped: read.items.length - toImport.length,
      folder: target.kind === 'new' ? folderName : currentFolder?.name ?? ''
    });
  }

  if (done) {
    return (
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('doneTitle')}</DialogTitle>
          <DialogDescription>{t('doneImported', { count: done.imported, folder: done.folder })}</DialogDescription>
        </DialogHeader>
        {done.skipped > 0 && <p className="text-sm text-muted-foreground">{t('doneSkipped', { count: done.skipped })}</p>}
        <Alert className={ACCENTS.amber.badge}>
          <TriangleAlertIcon />
          <AlertTitle>{t('deleteFileTitle')}</AlertTitle>
          <AlertDescription>{t('deleteFile', { name: fileName })}</AlertDescription>
        </Alert>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            <CheckCircle2Icon /> {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-5">
        <Field>
          <FieldLabel htmlFor="import-file">{t('file')}</FieldLabel>
          <Input id="import-file" type="file" accept=".csv,.json,.txt,text/csv,application/json" disabled={busy || reading} onChange={/**
           * Reads the chosen file.
           * @param event - The change event.
           */ (event) => void chooseFile(event)} />
          <FieldDescription>{reading ? t('reading') : t('fileHelp')}</FieldDescription>
        </Field>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {parsed && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{t('detected', { format: t(`format_${parsed.format}`), count: read.items.length })}</Badge>
            </div>
            {parsed.table && (
              <Field>
                <FieldLabel>{t('columns')}</FieldLabel>
                <FieldDescription>{t('columnsHelp')}</FieldDescription>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {parsed.table.headers.map(/**
                   * Renders the choice for one column.
                   * @param header - The column's header.
                   * @param index - Its position.
                   */ (header, index) => (
                    <div key={index} className="grid gap-1">
                      <span className="truncate text-xs font-medium text-muted-foreground" title={header}>{header || `#${index + 1}`}</span>
                      <NativeSelect
                        aria-label={t('columnLabel', { name: header || `#${index + 1}` })}
                        value={mapping[index] ?? 'ignore'}
                        disabled={busy}
                        onChange={/**
                         * Assigns the column.
                         * @param event - The select change event.
                         */ (event) => assign(index, event.target.value as ColumnTarget)}
                      >
                        {COLUMN_TARGETS.map(/**
                         * Renders one possible content.
                         * @param target - What the column may contain.
                         */ (target) => (
                          <NativeSelectOption key={target} value={target}>{t(`column_${target}`)}</NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                  ))}
                </div>
              </Field>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="import-destination">{t('destination')}</FieldLabel>
                <NativeSelect
                  id="import-destination"
                  value={destination}
                  disabled={busy}
                  onChange={/**
                   * Chooses where the entries go.
                   * @param event - The select change event.
                   */ (event) => setDestination(event.target.value as 'new' | 'current')}
                >
                  <NativeSelectOption value="new">{t('newFolder', { name: folderName })}</NativeSelectOption>
                  {canUseCurrent && currentFolder && (
                    <NativeSelectOption value="current">{t('currentFolder', { name: currentFolder.name })}</NativeSelectOption>
                  )}
                </NativeSelect>
              </Field>
              <div className="grid gap-3">
                <Field orientation="horizontal">
                  <Checkbox id="import-keep-folders" checked={keepFolders} disabled={busy} onCheckedChange={/**
                   * Turns the source folders on or off.
                   * @param checked - The new state.
                   */ (checked) => setKeepFolders(checked === true)} />
                  <FieldContent>
                    <FieldLabel htmlFor="import-keep-folders">{t('keepFolders')}</FieldLabel>
                    <FieldDescription>{t('keepFoldersHelp')}</FieldDescription>
                  </FieldContent>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox id="import-skip-duplicates" checked={skipDuplicates} disabled={busy} onCheckedChange={/**
                   * Turns skipping of existing entries on or off.
                   * @param checked - The new state.
                   */ (checked) => setSkipDuplicates(checked === true)} />
                  <FieldContent>
                    <FieldLabel htmlFor="import-skip-duplicates">{t('skipDuplicates')}</FieldLabel>
                    <FieldDescription>{t('skipDuplicatesHelp', { count: duplicates.size })}</FieldDescription>
                  </FieldContent>
                </Field>
              </div>
            </div>
            {read.problems.length > 0 && (
              <Alert>
                <TriangleAlertIcon />
                <AlertTitle>{t('problemsTitle', { count: read.problems.length })}</AlertTitle>
                <AlertDescription>
                  <ul className="max-h-28 list-disc overflow-y-auto ps-4">
                    {read.problems.map(/**
                     * Describes one record that is not imported.
                     * @param problem - The record and the reason.
                     */ (problem) => (
                      <li key={problem.line}>
                        {problem.reason === 'noTitle'
                          ? t('problem_noTitle', { line: problem.line })
                          : t('problem_unsupportedType', { line: problem.line, label: problem.label, type: problem.detail ?? '' })}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="-mx-6 border-y">
              <DataTable
                label={t('previewLabel')}
                rows={rows}
                columns={PREVIEW_COLUMNS}
                searchLabel={t('search')}
                emptyMessage={t('empty')}
                matches={/**
                 * Searches the shown values of a row.
                 * @param row - One preview row.
                 * @param query - The normalized search text.
                 */ (row, query) => matchesTableSearch(query, row.item.folder.join(' / '), row.item.title, row.item.username, row.item.url)}
                renderRow={/**
                 * Renders one item without its password.
                 * @param row - One preview row.
                 */ (row) => (
                  <TableRow key={row.item.line}>
                    <TableCell className="ps-6 text-muted-foreground">
                      <div className="max-w-40 truncate" title={row.item.folder.join(' / ')}>{row.item.folder.join(' / ')}</div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-56 truncate font-medium" title={row.item.title}>{row.item.title}</div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-48 truncate" title={row.item.username}>{row.item.username}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="max-w-56 truncate" title={row.item.url}>{row.item.url}</div>
                    </TableCell>
                    <TableCell className="pe-6">
                      {row.duplicate ? (
                        <Badge variant="outline" className={ACCENTS.amber.badge}>{skipDuplicates ? t('status_skipped') : t('status_duplicate')}</Badge>
                      ) : (
                        <Badge variant="outline" className={ACCENTS.emerald.badge}>{t('status_new')}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              />
            </div>
          </>
        )}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
        <Button type="button" disabled={busy || !parsed || toImport.length === 0} onClick={/** Starts the import. */ () => void runImport()}>
          <FileUpIcon /> {busy ? t('importing') : t('importButton', { count: toImport.length })}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
