import { useMemo, useState } from 'react';
import type { Kdbx } from 'kdbxweb';
import { DownloadIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { FolderNode } from '@/lib/groups';
import { downloadCsv, exportCsv, exportFileName } from '@/lib/import/export';
import messages from '@/i18n/export-dialog';
import { useT } from '@shared/i18n/react';

/**
 * Lets the user download the entries of the open vault as a CSV file.
 * @param props - Whether the dialog is open, the vault, its file name, the current folder and the callbacks.
 */
export function ExportDialog({
  open,
  db,
  vaultName,
  currentFolder,
  onExported,
  onClose
}: {
  open: boolean;
  db: Kdbx | null;
  vaultName: string;
  /** The folder shown in the list, offered as scope unless it is the recycle bin or the templates folder. */
  currentFolder: FolderNode | null;
  /** Reports the downloaded file. */
  onExported: (count: number, fileName: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={/**
     * Closes the dialog.
     * @param next - The requested dialog state.
     */ (next) => {
      if (!next) onClose();
    }}>
      {open && db && <ExportForm db={db} vaultName={vaultName} currentFolder={currentFolder} onExported={onExported} onClose={onClose} />}
    </Dialog>
  );
}

/**
 * The options of the export dialog; remounted on every opening so the defaults apply again.
 * @param props - The vault, its file name, the current folder and the callbacks.
 */
function ExportForm({
  db,
  vaultName,
  currentFolder,
  onExported,
  onClose
}: {
  db: Kdbx;
  vaultName: string;
  currentFolder: FolderNode | null;
  onExported: (count: number, fileName: string) => void;
  onClose: () => void;
}) {
  const t = useT(messages);
  const folder = currentFolder && !currentFolder.inRecycleBin && !currentFolder.isTemplates && !currentFolder.isRoot ? currentFolder : null;
  const [scope, setScope] = useState<'all' | 'folder'>(folder ? 'folder' : 'all');
  const [neutralize, setNeutralize] = useState(false);
  const counts = useMemo(/** Counts the entries of both scopes. */ () => ({
    all: exportCsv(db, { neutralizeFormulas: false }).count,
    folder: folder ? exportCsv(db, { folderId: folder.id, neutralizeFormulas: false }).count : 0
  }), [db, folder]);
  const count = scope === 'folder' ? counts.folder : counts.all;

  /** Builds the file and lets the browser save it. */
  function download() {
    const { csv, count: exported } = exportCsv(db, { folderId: scope === 'folder' && folder ? folder.id : undefined, neutralizeFormulas: neutralize });
    const name = exportFileName(vaultName, new Date());
    downloadCsv(name, csv);
    onExported(exported, name);
  }

  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{t('warningTitle')}</AlertTitle>
        <AlertDescription>{t('warning')}</AlertDescription>
      </Alert>
      <FieldGroup className="gap-5">
        <Field>
          <FieldLabel htmlFor="export-scope">{t('scope')}</FieldLabel>
          <NativeSelect
            id="export-scope"
            value={scope}
            onChange={/**
             * Chooses which entries are exported.
             * @param event - The select change event.
             */ (event) => setScope(event.target.value as 'all' | 'folder')}
          >
            <NativeSelectOption value="all">{t('scopeAll', { count: counts.all })}</NativeSelectOption>
            {folder && <NativeSelectOption value="folder">{t('scopeFolder', { name: folder.name, count: counts.folder })}</NativeSelectOption>}
          </NativeSelect>
          <FieldDescription>{t('excluded')}</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="export-formulas" checked={neutralize} onCheckedChange={/**
           * Turns the formula protection on or off.
           * @param checked - The new state.
           */ (checked) => setNeutralize(checked === true)} />
          <FieldContent>
            <FieldLabel htmlFor="export-formulas">{t('formulas')}</FieldLabel>
            <FieldDescription>{t('formulasHelp')}</FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
        <Button type="button" disabled={count === 0} onClick={download}>
          <DownloadIcon /> {t('download', { count })}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
