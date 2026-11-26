import type { ChangeEvent } from 'react';
import { DownloadIcon, Trash2Icon } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { addAttachment, attachmentSize, downloadAttachment, type AttachmentDraft } from '@/lib/attachments';
import messages from '@/i18n/entry-attachments';
import { useT } from '@shared/i18n/react';

type EntryAttachmentsProps = {
  draft: AttachmentDraft;
  canWrite: boolean;
  disabled: boolean;
  onChange: (draft: AttachmentDraft) => void;
  onError: (message: string) => void;
};

/**
 * Lists attachment downloads and delegates draft changes to the entry editor.
 * @param props - The attachment draft, edit permissions, save state, and callbacks for changes or errors.
 */
export function EntryAttachments({ draft, canWrite, disabled, onChange, onError }: EntryAttachmentsProps) {
  const t = useT(messages);

  /**
   * Stages the selected attachment and clears the picker so it can be reused.
   * @param event - The file picker change event containing the selected attachment.
   */
  function handleAdd(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !canWrite || disabled) return;
    try {
      onChange(addAttachment(draft, file));
    } catch (error) {
      onError(error instanceof Error ? error.message : t('addFailed'));
    }
  }

  return (
    <section aria-labelledby="entry-attachments-heading" className="grid gap-3 rounded-lg border p-3">
      <h3 id="entry-attachments-heading" className="text-sm font-medium">{t('title')}</h3>
      {!draft.size && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      {draft.size > 0 && (
        <ul className="divide-y">
          {Array.from(draft, /**
           * Renders the attachment's name, size, and allowed actions.
           * @param item - The filename and draft or stored attachment for this row.
           */ ([name, attachment]) => (
            <li key={name} className="flex min-w-0 items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="wrap-break-word text-sm font-medium">{name}</p>
                <p className="text-xs text-muted-foreground">{t('bytes', { count: attachmentSize(attachment) })}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={t('downloadNamed', { name })}
                title={t('download')}
                onClick={/** Starts the browser download for this attachment. */ () => downloadAttachment(name, attachment)}
              >
                <DownloadIcon />
              </Button>
              {canWrite && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={t('removeNamed', { name })} title={t('remove')}>
                      <Trash2Icon />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('removeTitle')}</AlertDialogTitle>
                      <AlertDialogDescription className="break-all">
                        {t('removeDescription', { name })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel type="button">{t('cancel')}</AlertDialogCancel>
                      <AlertDialogAction
                        type="button"
                        variant="destructive"
                        disabled={disabled}
                        onClick={/** Removes the attachment from the draft without changing the saved entry. */ () => {
                          const updated = new Map(draft);
                          updated.delete(name);
                          onChange(updated);
                        }}
                      >
                        {t('removeConfirm')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <Field>
          <FieldLabel htmlFor="entry-attachment-file">{t('add')}</FieldLabel>
          <Input id="entry-attachment-file" type="file" disabled={disabled} onChange={handleAdd} aria-describedby="entry-attachments-help" />
          <FieldDescription id="entry-attachments-help">
            {t('help')}
          </FieldDescription>
        </Field>
      )}
    </section>
  );
}
