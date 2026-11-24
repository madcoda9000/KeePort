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
import { addAttachment, attachmentBlob, attachmentSize, type Attachment, type AttachmentDraft } from '@/lib/attachments';

type EntryAttachmentsProps = {
  draft: AttachmentDraft;
  canWrite: boolean;
  disabled: boolean;
  onChange: (draft: AttachmentDraft) => void;
  onError: (message: string) => void;
};

/**
 * Downloads one local attachment without rendering or navigating to its contents.
 * @param name - The filename to suggest to the browser.
 * @param attachment - The binary or local file to download.
 */
function downloadAttachment(name: string, attachment: Attachment) {
  const url = URL.createObjectURL(attachmentBlob(attachment));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(/** Releases the temporary URL after the browser has started the download. */ () => URL.revokeObjectURL(url), 1000);
}

/**
 * Lists attachment downloads and delegates draft changes to the entry editor.
 * @param props - The attachment draft, edit permissions, save state, and callbacks for changes or errors.
 */
export function EntryAttachments({ draft, canWrite, disabled, onChange, onError }: EntryAttachmentsProps) {
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
      onError(error instanceof Error ? error.message : 'Unable to add attachment.');
    }
  }

  return (
    <section aria-labelledby="entry-attachments-heading" className="grid gap-3 rounded-lg border p-3">
      <h3 id="entry-attachments-heading" className="text-sm font-medium">Attachments</h3>
      {!draft.size && <p className="text-sm text-muted-foreground">No attachments.</p>}
      {draft.size > 0 && (
        <ul className="divide-y">
          {Array.from(draft, /**
           * Renders the attachment's name, size, and allowed actions.
           * @param item - The filename and draft or stored attachment for this row.
           */ ([name, attachment]) => (
            <li key={name} className="flex min-w-0 items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{name}</p>
                <p className="text-xs text-muted-foreground">{attachmentSize(attachment).toLocaleString()} bytes</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={`Download ${name}`}
                title="Download attachment"
                onClick={/** Starts the browser download for this attachment. */ () => downloadAttachment(name, attachment)}
              >
                <DownloadIcon />
              </Button>
              {canWrite && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={`Remove ${name}`} title="Remove attachment">
                      <Trash2Icon />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove attachment?</AlertDialogTitle>
                      <AlertDialogDescription className="break-all">
                        Saving will remove “{name}” from the current entry. Saved attachments may remain in entry history.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
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
                        Remove
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
          <FieldLabel htmlFor="entry-attachment-file">Add attachment</FieldLabel>
          <Input id="entry-attachment-file" type="file" disabled={disabled} onChange={handleAdd} aria-describedby="entry-attachments-help" />
          <FieldDescription id="entry-attachments-help">
            Up to 10 MiB per file. Attachments increase the encrypted vault size. Save the entry to apply changes.
          </FieldDescription>
        </Field>
      )}
    </section>
  );
}
