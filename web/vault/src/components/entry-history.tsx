import { useState } from 'react';
import type { KdbxEntry } from 'kdbxweb';
import { ProtectedValue } from 'kdbxweb';
import { ChevronRightIcon, CopyIcon, DownloadIcon, EyeIcon, EyeOffIcon, HistoryIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { attachmentSize, downloadAttachment } from '@/lib/attachments';
import { readCustomFields, readExpiry } from '@/lib/fields';
import { listHistory, type HistoryItem } from '@/lib/history';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import messages from '@/i18n/entry-history';
import { formatDateTime, formatNumber, translate } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';

/** A pending confirmation for restoring or deleting one version. */
type PendingAction = { kind: 'restore' | 'delete'; item: HistoryItem } | null;

/**
 * Reads a plain or protected field as text.
 * @param entry - The version.
 * @param name - The field name.
 */
function fieldValue(entry: KdbxEntry, name: string) {
  const value = entry.fields.get(name);
  if (value === undefined) return '';
  return value instanceof ProtectedValue ? value.getText() : String(value);
}

/**
 * Formats the time of a version in the current language.
 * @param date - The modification time, if known.
 */
function formatTime(date: Date | undefined) {
  return date && !Number.isNaN(date.getTime()) ? formatDateTime(date) : translate(messages, 'unknownTime');
}

/**
 * Formats an attachment size.
 * @param size - The size in bytes.
 */
function formatSize(size: number) {
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  if (size < 1024) return translate(messages, 'sizeBytes', { size: formatNumber(size) });
  if (size < 1024 * 1024) return translate(messages, 'sizeKb', { size: formatNumber(size / 1024, oneDecimal) });
  return translate(messages, 'sizeMb', { size: formatNumber(size / (1024 * 1024), oneDecimal) });
}

/**
 * Shows one field of a version read-only, masking protected values until revealed.
 * @param props - The label, the value, whether it is protected, and the copy callback.
 */
function VersionField({
  label,
  value,
  protect,
  onCopy
}: {
  label: string;
  value: string;
  protect: boolean;
  onCopy: (value: string, label: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const t = useT(messages);
  if (!value) return null;
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:pt-1.5">{label}</dt>
      <dd className="flex min-w-0 items-start gap-1">
        <span className={cn('min-w-0 flex-1 py-1 text-sm wrap-break-word whitespace-pre-wrap', protect && 'font-mono')}>
          {protect && !shown ? '••••••••' : value}
        </span>
        {protect && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={shown ? t('hideNamed', { label }) : t('showNamed', { label })} onClick={/** Toggles the protected value. */ () => setShown(!shown)}>
            {shown ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('copyNamed', { label })} onClick={/** Copies the value. */ () => onCopy(value, label)}>
          <CopyIcon />
        </Button>
      </dd>
    </div>
  );
}

/**
 * Shows all fields of one version read-only.
 * @param props - The version and the copy callback.
 */
function VersionDetails({ version, onCopy }: { version: KdbxEntry; onCopy: (value: string, label: string) => void }) {
  const expiry = readExpiry(version);
  const t = useT(messages);
  return (
    <dl className="grid gap-1.5 border-t px-3 py-3">
      <VersionField label={t('title')} value={fieldValue(version, 'Title')} protect={false} onCopy={onCopy} />
      <VersionField label={t('username')} value={fieldValue(version, 'UserName')} protect={false} onCopy={onCopy} />
      <VersionField label={t('password')} value={fieldValue(version, 'Password')} protect onCopy={onCopy} />
      <VersionField label={t('website')} value={fieldValue(version, 'URL')} protect={false} onCopy={onCopy} />
      <VersionField label={t('notes')} value={fieldValue(version, 'Notes')} protect={false} onCopy={onCopy} />
      <VersionField label="TOTP" value={fieldValue(version, 'otp')} protect onCopy={onCopy} />
      {readCustomFields(version).map(/**
       * Renders one custom field of the version.
       * @param field - One custom field.
       */ (field) => (
        <VersionField key={field.name} label={field.name} value={field.value} protect={field.protected} onCopy={onCopy} />
      ))}
      {version.tags.length > 0 && (
        <div className="grid gap-0.5 sm:grid-cols-[8rem_1fr] sm:gap-3">
          <dt className="text-xs text-muted-foreground sm:pt-1">{t('tags')}</dt>
          <dd className="flex flex-wrap gap-1">
            {version.tags.map(/**
             * Renders one tag.
             * @param tag - One tag of the version.
             */ (tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          </dd>
        </div>
      )}
      {expiry && (
        <div className="grid gap-0.5 sm:grid-cols-[8rem_1fr] sm:gap-3">
          <dt className="text-xs text-muted-foreground sm:pt-0.5">{t('expires')}</dt>
          <dd className="text-sm">{formatDateTime(new Date(`${expiry}T00:00:00`), { year: 'numeric', month: 'numeric', day: 'numeric' })}</dd>
        </div>
      )}
      {version.binaries.size > 0 && (
        <div className="grid gap-0.5 sm:grid-cols-[8rem_1fr] sm:gap-3">
          <dt className="text-xs text-muted-foreground sm:pt-1.5">{t('attachments')}</dt>
          <dd className="grid gap-1">
            {[...version.binaries].map(/**
             * Renders one attachment of the version with a download button.
             * @param attachment - The attachment name and value.
             */ ([name, value]) => (
              <span key={name} className="flex min-w-0 items-center gap-1 text-sm">
                <span className="min-w-0 truncate">{name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatSize(attachmentSize(value))}</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('downloadNamed', { name })} onClick={/** Downloads the attachment. */ () => downloadAttachment(name, value)}>
                  <DownloadIcon />
                </Button>
              </span>
            ))}
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * The history tab of the entry form: the current state and all saved versions, newest first, with what each one
 * changed. Versions can be opened, restored (the current state is saved as a version first) and deleted.
 * @param props - The entry, the vault's version limit, write permission, the busy state and the action callbacks.
 */
export function EntryHistory({
  entry,
  maxVersions,
  canWrite,
  busy,
  onRestore,
  onDelete,
  onCopy
}: {
  entry: KdbxEntry;
  /** The vault's `HistoryMaxItems`; negative or undefined means unlimited. */
  maxVersions: number | undefined;
  canWrite: boolean;
  busy: boolean;
  onRestore: (index: number) => Promise<boolean>;
  onDelete: (index: number) => Promise<boolean>;
  onCopy: (value: string, label: string) => void;
}) {
  const [pending, setPending] = useState<PendingAction>(null);
  const items = listHistory(entry);
  const versions = items.length - 1;
  const t = useT(messages);

  /** Runs the confirmed action and closes the confirmation when it is done. */
  async function confirm() {
    if (!pending || pending.item.index === null) return;
    const index = pending.item.index;
    await (pending.kind === 'restore' ? onRestore(index) : onDelete(index));
    setPending(null);
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {versions === 0 ? t('noVersions') : t('versions', { count: versions })}{' '}
        {maxVersions !== undefined && maxVersions >= 0 ? t('keepsUpTo', { count: maxVersions }) : t('keepsAll')}
      </p>
      <ol className="grid gap-2" aria-label={t('historyLabel')}>
        {items.map(/**
         * Renders the current state or one saved version.
         * @param item - One state of the entry.
         */ (item) => (
          <li key={item.index ?? 'current'}>
            <Collapsible className="min-w-0 rounded-lg border">
              <div className="flex items-start gap-2 p-2">
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="ghost" className="group h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 text-start whitespace-normal">
                    <ChevronRightIcon className="mt-0.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {formatTime(item.modified)}
                        {item.index === null && <Badge variant="secondary">{t('current')}</Badge>}
                      </span>
                      <span className="truncate text-xs font-normal text-muted-foreground">
                        {item.changes === null
                          ? t('oldest', { title: item.title })
                          : item.changes.length
                            ? t('changed', { changes: item.changes.join(', ') })
                            : t('noChanges')}
                      </span>
                    </span>
                  </Button>
                </CollapsibleTrigger>
                {canWrite && item.index !== null && (
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={/** Asks to restore this version. */ () => setPending({ kind: 'restore', item })}>
                      <RotateCcwIcon /> {t('restore')}
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label={t('deleteFrom', { time: formatTime(item.modified) })} title={t('deleteVersion')} onClick={/** Asks to delete this version. */ () => setPending({ kind: 'delete', item })}>
                      <Trash2Icon />
                    </Button>
                  </div>
                )}
              </div>
              <CollapsibleContent>
                <VersionDetails version={item.version} onCopy={onCopy} />
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ol>
      {versions === 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <HistoryIcon className="size-4" /> {t('savedOnChange')}
        </p>
      )}
      <AlertDialog open={pending !== null} onOpenChange={/**
       * Closes the confirmation unless a save is running.
       * @param open - The requested dialog state.
       */ (open) => {
        if (!open && !busy) setPending(null);
      }}>
        {pending && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pending.kind === 'restore' ? t('restoreTitle') : t('deleteTitle')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pending.kind === 'restore'
                  ? t('restoreDescription', { time: formatTime(pending.item.modified) })
                  : t('deleteDescription', { time: formatTime(pending.item.modified) })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                variant={pending.kind === 'delete' ? 'destructive' : 'default'}
                disabled={busy}
                onClick={/**
                 * Runs the action and keeps the dialog open until the save finishes.
                 * @param event - The click event, prevented so the dialog does not close early.
                 */ (event) => {
                  event.preventDefault();
                  void confirm();
                }}
              >
                {busy ? t('saving') : pending.kind === 'restore' ? t('restoreVersion') : t('deleteVersion')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}
