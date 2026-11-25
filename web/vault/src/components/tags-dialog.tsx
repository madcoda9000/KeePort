import { useState } from 'react';
import { TagIcon } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { TagInput } from '@/components/tag-input';

/**
 * Adds tags to and removes tags from several selected entries at once.
 * @param props - Whether the dialog is open, the number of entries, the vault's tags, the tags on the selection, the busy state and the callbacks.
 */
export function TagsDialog({
  open,
  count,
  vaultTags,
  selectionTags,
  busy,
  onApply,
  onClose
}: {
  open: boolean;
  count: number;
  vaultTags: readonly string[];
  /** Tags that at least one selected entry has, with how many of them. */
  selectionTags: readonly { tag: string; count: number }[];
  busy: boolean;
  onApply: (add: string[], remove: string[]) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={/**
     * Closes the dialog unless a save is running.
     * @param next - The requested dialog state.
     */ (next) => {
      if (!next && !busy) onClose();
    }}>
      {open && <TagsForm count={count} vaultTags={vaultTags} selectionTags={selectionTags} busy={busy} onApply={onApply} />}
    </Dialog>
  );
}

/**
 * The form inside the tags dialog; remounted on every opening.
 * @param props - The number of entries, the vault's tags, the tags on the selection, the busy state and the apply callback.
 */
function TagsForm({
  count,
  vaultTags,
  selectionTags,
  busy,
  onApply
}: {
  count: number;
  vaultTags: readonly string[];
  selectionTags: readonly { tag: string; count: number }[];
  busy: boolean;
  onApply: (add: string[], remove: string[]) => void;
}) {
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<ReadonlySet<string>>(new Set());
  const noun = count === 1 ? 'entry' : 'entries';

  /**
   * Marks a tag for removal or keeps it.
   * @param tag - The tag.
   * @param checked - Whether the tag should be removed.
   */
  function toggleRemove(tag: string, checked: boolean) {
    /**
     * Builds the new set of tags to remove.
     * @param current - The tags marked so far.
     */
    setRemove((current) => {
      const next = new Set(current);
      if (checked) next.add(tag);
      else next.delete(tag);
      return next;
    });
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><TagIcon className="size-4" /> Tags for {count} {noun}</DialogTitle>
        <DialogDescription>Add tags to all selected {noun} or remove tags from them. Each changed entry keeps its previous state in the history.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="bulk-tags">Add tags</Label>
          <TagInput id="bulk-tags" tags={add} suggestions={vaultTags} canWrite onChange={setAdd} />
        </div>
        {selectionTags.length > 0 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Remove tags</legend>
            {selectionTags.map(/**
             * Renders the removal checkbox of one tag.
             * @param item - A tag on the selection with how many entries have it.
             */ (item) => (
              <div key={item.tag} className="flex items-center gap-2">
                <Checkbox
                  id={`remove-tag-${item.tag}`}
                  checked={remove.has(item.tag)}
                  onCheckedChange={/**
                   * Marks the tag for removal.
                   * @param checked - The new checkbox state.
                   */ (checked) => toggleRemove(item.tag, checked === true)}
                />
                <Label htmlFor={`remove-tag-${item.tag}`} className="font-normal">
                  {item.tag} <span className="text-muted-foreground">({item.count} of {count})</span>
                </Label>
              </div>
            ))}
          </fieldset>
        )}
      </div>
      <DialogFooter>
        <Button type="button" disabled={busy || (!add.length && !remove.size)} onClick={/** Applies the changes. */ () => onApply(add, [...remove])}>
          {busy ? 'Saving…' : 'Apply'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
