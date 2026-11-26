import { useState } from 'react';
import { DownloadIcon, HistoryIcon, RotateCcwIcon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, type AdminFile, type VaultVersion, type VaultVersions } from '@/lib/api';
import messages from '@/i18n/vault-versions';
import { formatDateTime, formatRelative } from '@shared/i18n/core';
import { formatSize } from '@/lib/format-size';
import { useT, type Translator } from '@shared/i18n/react';

/**
 * Names how a revision was saved; the server stores this in English, so known values are translated here.
 * @param source - The stored source, e.g. "Web vault", "WebDAV · Pixel 8" or "Restore of revision 37".
 * @param t - The translator of the versions catalog.
 */
function describeSource(source: string | null, t: Translator<typeof messages.en>) {
  if (!source) return t('unknown');
  if (source === 'Web vault') return t('sourceWebVault');
  if (source === 'Upload') return t('sourceUpload');
  if (source === 'Conflict copy') return t('sourceConflictCopy');
  const restore = /^Restore of revision (\d+)$/.exec(source);
  if (restore) return t('sourceRestore', { revision: Number(restore[1]) });
  return source;
}

/**
 * Opens the list of a vault's current revision and kept earlier versions, with download and restore.
 * @param props - The vault, a callback that reloads the vault list, a callback for notices, and whether actions are blocked.
 */
export function VaultVersionsButton({
  file,
  onChanged,
  onMessage,
  disabled
}: {
  file: AdminFile;
  onChanged: () => Promise<void>;
  onMessage: (message: { kind: 'notice' | 'error'; text: string }) => void;
  disabled?: boolean;
}) {
  const t = useT(messages);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<VaultVersions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Loads the versions; called when the dialog opens and after a restore. */
  async function load() {
    setError(null);
    try {
      setData(await api.listVersions(file.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('loadFailed'));
    }
  }

  /**
   * Downloads one earlier version through a temporary object URL.
   * @param version - The version to download.
   */
  async function download(version: VaultVersion) {
    setBusy(true);
    try {
      const blob = await api.downloadVersion(file.id, version.revision);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${file.name.replace(/\.kdbx$/i, '')}-r${version.revision}.kdbx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('downloadFailed'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Restores one earlier version as a new revision, then reloads the list and the vault table.
   * @param version - The version to restore.
   */
  async function restore(version: VaultVersion) {
    setBusy(true);
    try {
      const restored = await api.restoreVersion(file.id, version.revision);
      onMessage({ kind: 'notice', text: t('restored', { revision: version.revision, newRevision: restored.revision }) });
      await load();
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('restoreFailed'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Renders one revision as a table row; only earlier versions get actions.
   * @param version - The revision.
   * @param current - Whether it is the current revision.
   */
  function row(version: VaultVersion, current: boolean) {
    return (
      <TableRow key={version.revision}>
        <TableCell className="ps-6 font-medium tabular-nums">
          {version.revision}
          {current && <Badge variant="secondary" className="ms-2">{t('current')}</Badge>}
        </TableCell>
        <TableCell className="whitespace-nowrap" title={formatDateTime(version.savedAt, { dateStyle: 'medium', timeStyle: 'medium' })}>
          {formatRelative(version.savedAt)}
        </TableCell>
        <TableCell>{version.savedBy ?? <span className="text-muted-foreground">{t('unknown')}</span>}</TableCell>
        <TableCell className="text-muted-foreground">
          <div className="max-w-48 truncate" title={describeSource(version.source, t)}>{describeSource(version.source, t)}</div>
        </TableCell>
        <TableCell className="text-muted-foreground tabular-nums">{formatSize(version.size)}</TableCell>
        <TableCell className="pe-6">
          {!current && (
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('download', { revision: version.revision })}
                title={t('download', { revision: version.revision })}
                disabled={busy}
                onClick={/** Downloads this version. */ () => void download(version)}
              >
                <DownloadIcon />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={busy || Boolean(file.deletedAt)}>
                    <RotateCcwIcon /> {t('restore')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('restoreTitle', { revision: version.revision })}</AlertDialogTitle>
                    <AlertDialogDescription>{t('restoreDescription', { name: file.name, revision: version.revision })}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={/** Restores after confirmation. */ () => void restore(version)}>{t('restore')}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </TableCell>
      </TableRow>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={/**
       * Loads the versions each time the dialog opens.
       * @param next - The requested dialog state.
       */ (next) => {
        setOpen(next);
        if (next) {
          setData(null);
          void load();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <HistoryIcon /> {t('versions')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('title', { name: file.name })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!data ? (
          !error && <p role="status" className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : (
          <div className="-mx-6 border-y">
            <Table aria-label={t('title', { name: file.name })}>
              <TableHeader className="bg-muted/45">
                <TableRow>
                  <TableHead className="ps-6">{t('revision')}</TableHead>
                  <TableHead>{t('saved')}</TableHead>
                  <TableHead>{t('by')}</TableHead>
                  <TableHead>{t('via')}</TableHead>
                  <TableHead>{t('size')}</TableHead>
                  <TableHead className="pe-6 text-end">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {row(data.current, true)}
                {data.versions.map(/**
                 * Renders one earlier version.
                 * @param version - The version.
                 */ (version) => row(version, false))}
              </TableBody>
            </Table>
            {data.versions.length === 0 && <p className="px-6 py-4 text-sm text-muted-foreground">{t('none')}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
