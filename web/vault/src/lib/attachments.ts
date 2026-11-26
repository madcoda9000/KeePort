import { KdbxBinaries, ProtectedValue, type Kdbx, type KdbxEntry } from 'kdbxweb';
import messages from '../i18n/lib-attachments.ts';
import { translate } from '../../../shared/i18n/core.ts';

type SavedAttachment = KdbxEntry['binaries'] extends Map<string, infer Binary> ? Binary : never;
export type Attachment = SavedAttachment | File;
export type AttachmentDraft = ReadonlyMap<string, Attachment>;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Gets an uploaded or saved attachment's size without decrypting its contents.
 * @param attachment - A selected file or an existing KDBX binary.
 */
export function attachmentSize(attachment: Attachment): number {
  if (attachment instanceof File) return attachment.size;
  const value = KdbxBinaries.isKdbxBinaryWithHash(attachment) ? attachment.value : attachment;
  return value.byteLength;
}

/**
 * Stages a local file without overwriting an existing attachment or reading its contents.
 * @param draft - The current attachment list for this entry.
 * @param file - The file the user selected for addition.
 */
export function addAttachment(draft: AttachmentDraft, file: File): AttachmentDraft {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(translate(messages, 'tooLarge'));
  if (draft.has(file.name)) throw new Error(translate(messages, 'duplicate'));
  const updated = new Map(draft);
  updated.set(file.name, file);
  return updated;
}

/**
 * Exposes an attachment as a download, not as inline content.
 * @param attachment - The draft or stored attachment to download locally.
 */
export function attachmentBlob(attachment: Attachment): Blob {
  if (attachment instanceof File) return attachment.slice(0, attachment.size, 'application/octet-stream');
  const value = KdbxBinaries.isKdbxBinaryWithHash(attachment) ? attachment.value : attachment;
  const bytes = value instanceof ProtectedValue ? value.getBinary() as Uint8Array<ArrayBuffer> : value;
  return new Blob([bytes], { type: 'application/octet-stream' });
}

/**
 * Registers new binary data with KDBX and keeps the original references for unchanged attachments.
 * @param db - The unlocked vault receiving the new binary data.
 * @param draft - The final attachment list to store on the entry.
 */
export async function encodeAttachments(db: Kdbx, draft: AttachmentDraft): Promise<KdbxEntry['binaries']> {
  const binaries: KdbxEntry['binaries'] = new Map();
  for (const [name, attachment] of draft) {
    binaries.set(name, attachment instanceof File ? await db.createBinary(await attachment.arrayBuffer()) : attachment);
  }
  return binaries;
}

/**
 * Downloads one local attachment without rendering or navigating to its contents.
 * @param name - The filename to suggest to the browser.
 * @param attachment - The binary or local file to download.
 */
export function downloadAttachment(name: string, attachment: Attachment) {
  const url = URL.createObjectURL(attachmentBlob(attachment));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(/** Releases the temporary URL after the browser has started the download. */ () => URL.revokeObjectURL(url), 1000);
}
