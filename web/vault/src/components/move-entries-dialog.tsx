import { useState } from 'react';
import { FolderIcon, FolderInputIcon, LayoutTemplateIcon } from 'lucide-react';
import type { FolderNode } from '@/lib/groups';
import { flattenFolders } from '@/lib/groups';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import messages from '@/i18n/move-entries-dialog';
import { useT } from '@shared/i18n/react';

/**
 * Lets the user pick the destination folder for the selected entries.
 * @param props - Whether the dialog is open, the folder tree, the folders the selection is in, the busy state and the callbacks.
 */
export function MoveEntriesDialog({
  open,
  folders,
  count,
  sourceFolderIds,
  busy,
  onMove,
  onClose
}: {
  open: boolean;
  folders: readonly FolderNode[];
  count: number;
  /** The folders that currently contain the selected entries. */
  sourceFolderIds: ReadonlySet<string>;
  busy: boolean;
  onMove: (targetId: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={/**
     * Closes the dialog unless a save is running.
     * @param next - The requested dialog state.
     */ (next) => {
      if (!next && !busy) onClose();
    }}>
      {open && (
        <MoveEntriesForm folders={folders} count={count} sourceFolderIds={sourceFolderIds} busy={busy} onMove={onMove} />
      )}
    </Dialog>
  );
}

/**
 * The folder picker inside the move dialog; remounted on every opening so no old choice is kept.
 * @param props - The folder tree, the number of entries, their current folders, the busy state and the move callback.
 */
function MoveEntriesForm({
  folders,
  count,
  sourceFolderIds,
  busy,
  onMove
}: {
  folders: readonly FolderNode[];
  count: number;
  sourceFolderIds: ReadonlySet<string>;
  busy: boolean;
  onMove: (targetId: string) => void;
}) {
  const [targetId, setTargetId] = useState<string | null>(null);
  // The recycle bin is not a destination: moving there would be a deletion. Entries can be moved out of it.
  const targets = flattenFolders(folders).filter(/**
   * Keeps folders outside the recycle bin.
   * @param folder - One folder of the vault.
   */ (folder) => !folder.inRecycleBin);
  const allInSameFolder = sourceFolderIds.size === 1;
  const t = useT(messages);

  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{t('title', { count })}</DialogTitle>
        <DialogDescription>{t('description', { count })}</DialogDescription>
      </DialogHeader>
      <div role="radiogroup" aria-label={t('destination')} className="-mx-2 grid max-h-80 gap-0.5 overflow-y-auto px-2 py-1">
        {targets.map(/**
         * Renders one destination folder, indented by its depth.
         * @param folder - The folder that can receive the entries.
         */ (folder) => {
          const current = allInSameFolder && sourceFolderIds.has(folder.id);
          const chosen = folder.id === targetId;
          return (
            <Button
              key={folder.id}
              type="button"
              role="radio"
              aria-checked={chosen}
              variant={chosen ? 'secondary' : 'ghost'}
              className={cn('h-8 justify-start gap-2 font-normal', chosen && 'font-medium ring-2 ring-primary/40')}
              style={{ paddingInlineStart: `${0.625 + folder.depth * 1.125}rem` }}
              disabled={busy || current}
              title={folder.path}
              onClick={/** Chooses this folder as the destination. */ () => setTargetId(folder.id)}
            >
              {folder.isTemplates ? <LayoutTemplateIcon /> : <FolderIcon />}
              <span className="truncate">{folder.name}</span>
              {current && <Badge variant="outline" className="ms-auto">{t('currentFolder')}</Badge>}
            </Button>
          );
        })}
      </div>
      <DialogFooter>
        <Button type="button" disabled={busy || targetId === null} onClick={/** Moves the entries to the chosen folder. */ () => targetId && onMove(targetId)}>
          <FolderInputIcon /> {busy ? t('moving') : t('moveHere')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
