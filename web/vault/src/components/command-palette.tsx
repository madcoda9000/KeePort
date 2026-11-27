import { useMemo, useState } from 'react';
import { FolderIcon, type LucideIcon } from 'lucide-react';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { EntryIcon } from '@/components/entry-icon';
import messages from '@/i18n/shortcuts';
import { entryMatches, type EntryView } from '@/lib/kdbx';
import { flattenFolders, type FolderNode } from '@/lib/groups';
import { useT } from '@shared/i18n/react';
import { ShortcutKeys } from '@shared/shortcut-help';

/** How many entries and folders the palette lists at most; typing narrows them down. */
const MAX_RESULTS = 8;

/** One action of the palette, such as "Lock vault". */
export interface PaletteAction {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The keyboard shortcut that does the same, shown at the end of the line. */
  shortcut?: string;
  run: () => void;
}

/**
 * The command palette (Ctrl+K / ⌘K): searches the entries, folders and actions of the open vault. Entries are
 * matched like the search box of the list; nothing is sent anywhere.
 * @param props - Whether it is open, the change handler, the entries, folders and actions, and what choosing does.
 */
export function CommandPalette({
  open,
  onOpenChange,
  entries,
  folders,
  actions,
  showFavicons,
  onOpenEntry,
  onOpenFolder
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: readonly EntryView[];
  folders: readonly FolderNode[];
  actions: readonly PaletteAction[];
  showFavicons: boolean;
  onOpenEntry: (entry: EntryView) => void;
  onOpenFolder: (id: string) => void;
}) {
  const t = useT(messages);
  const [query, setQuery] = useState('');
  const text = query.trim().toLowerCase();
  const allFolders = useMemo(/** Lists all folders below the root, outside the recycle bin. */ () => flattenFolders(folders).filter(/**
   * Keeps ordinary folders.
   * @param folder - One folder.
   */ (folder) => !folder.isRoot && !folder.inRecycleBin), [folders]);
  const foundEntries = useMemo(/** Finds the entries that match the search. */ () => (text
    ? entries.filter(/**
       * Checks one entry against the search.
       * @param entry - One entry.
       */ (entry) => entryMatches(entry, text)).slice(0, MAX_RESULTS)
    : []), [entries, text]);
  const foundFolders = allFolders.filter(/**
   * Checks one folder against the search.
   * @param folder - One folder.
   */ (folder) => text && folder.path.toLowerCase().includes(text)).slice(0, MAX_RESULTS);
  const foundActions = actions.filter(/**
   * Checks one action against the search.
   * @param action - One action.
   */ (action) => !text || action.label.toLowerCase().includes(text));

  /**
   * Closes the palette and runs the choice.
   * @param run - What the choice does.
   */
  function choose(run: () => void) {
    onOpenChange(false);
    setQuery('');
    run();
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={/**
       * Forgets the search when the palette closes.
       * @param next - The requested visibility.
       */ (next) => {
        if (!next) setQuery('');
        onOpenChange(next);
      }}
      title={t('paletteTitle')}
      description={t('paletteDescription')}
      className="sm:max-w-xl"
    >
      <Command shouldFilter={false}>
      <CommandInput placeholder={t('palettePlaceholder')} value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{t('paletteEmpty')}</CommandEmpty>
        {foundEntries.length > 0 && (
          <CommandGroup heading={t('paletteEntries')}>
            {foundEntries.map(/**
             * Lists one entry.
             * @param entry - The entry.
             */ (entry) => (
              <CommandItem key={entry.id} value={`entry:${entry.id}`} onSelect={/** Opens the entry. */ () => choose(() => onOpenEntry(entry))}>
                <EntryIcon iconUrl={entry.iconUrl} url={entry.url} showFavicons={showFavicons} title={entry.title} className="size-4" />
                <span className="min-w-0 truncate">{entry.title}</span>
                <span className="ms-auto min-w-0 truncate text-xs text-muted-foreground">{entry.username || entry.groupPath}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {foundFolders.length > 0 && (
          <CommandGroup heading={t('paletteFolders')}>
            {foundFolders.map(/**
             * Lists one folder.
             * @param folder - The folder.
             */ (folder) => (
              <CommandItem key={folder.id} value={`folder:${folder.id}`} onSelect={/** Shows the folder. */ () => choose(() => onOpenFolder(folder.id))}>
                <FolderIcon />
                <span className="min-w-0 truncate">{folder.path}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {foundActions.length > 0 && (
          <CommandGroup heading={t('paletteActions')}>
            {foundActions.map(/**
             * Lists one action.
             * @param action - The action.
             */ (action) => {
              const Icon = action.icon;
              return (
                <CommandItem key={action.id} value={`action:${action.id}`} onSelect={/** Runs the action. */ () => choose(action.run)}>
                  <Icon />
                  <span>{action.label}</span>
                  {action.shortcut && (
                    <CommandShortcut>
                      <ShortcutKeys shortcut={action.shortcut} />
                    </CommandShortcut>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
