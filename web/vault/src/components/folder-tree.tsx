import { useState, type FormEvent } from 'react';
import {
  CalendarX2Icon,
  ChevronRightIcon,
  EllipsisIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  LayoutTemplateIcon,
  LibraryIcon,
  PencilIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TagIcon,
  Trash2Icon
} from 'lucide-react';
import type { FolderNode } from '@/lib/groups';
import { MAX_FOLDER_NAME_LENGTH, findFolder } from '@/lib/groups';
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
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  useSidebar
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

/** What the folder tree asks the page to do; the page owns the dialogs and the saving. */
export interface FolderActions {
  /** Shows the entries of a folder, or all entries for null. */
  onSelect: (folderId: string | null) => void;
  /** Starts creating a folder inside the given parent. */
  onCreate: (parent: FolderNode) => void;
  /** Starts renaming a folder. */
  onRename: (folder: FolderNode) => void;
  /** Asks to delete an empty folder. */
  onDelete: (folder: FolderNode) => void;
}

interface FolderTreeProps extends FolderActions {
  vaultName: string;
  folders: readonly FolderNode[];
  totalEntries: number;
  selectedId: string | null;
  /** Whether "All entries" is the current view. */
  allSelected: boolean;
  /** The number of expired entries; the "Expired" view is listed only when there are some. */
  expiredCount: number;
  expiredSelected: boolean;
  onSelectExpired: () => void;
  /** The number of entries with security findings. */
  securityCount: number;
  securitySelected: boolean;
  onSelectSecurity: () => void;
  /** The tags of the vault with their counts; the "Tags" group is listed only when there are some. */
  tags: readonly { tag: string; count: number }[];
  selectedTag: string | null;
  onSelectTag: (tag: string) => void;
  canWrite: boolean;
  disabled: boolean;
}

/**
 * Returns why a folder cannot be deleted, or null when it can.
 * @param folder - The folder to check.
 */
function folderDeleteBlocker(folder: FolderNode): string | null {
  if (folder.isRoot) return 'The root folder cannot be deleted.';
  if (folder.isRecycleBin) return 'The recycle bin cannot be deleted.';
  if (folder.entryCount || folder.children.length) return 'Only empty folders can be deleted.';
  return null;
}

/**
 * Picks the icon for a folder from its role and expansion state.
 * @param props - The folder and whether its subfolders are shown.
 */
function FolderGlyph({ folder, open }: { folder: FolderNode; open: boolean }) {
  if (folder.isRecycleBin) return <Trash2Icon />;
  if (folder.isTemplates) return <LayoutTemplateIcon />;
  return open && folder.children.length ? <FolderOpenIcon /> : <FolderIcon />;
}

/**
 * Renders the folder tree of the open vault as its own sidebar group below the vault list.
 * @param props - The folders, the selection, write permission and the callbacks for folder actions.
 */
export function FolderTree({
  vaultName,
  folders,
  totalEntries,
  selectedId,
  allSelected,
  expiredCount,
  expiredSelected,
  onSelectExpired,
  securityCount,
  securitySelected,
  onSelectSecurity,
  tags,
  selectedTag,
  onSelectTag,
  canWrite,
  disabled,
  ...actions
}: FolderTreeProps) {
  const { setOpenMobile } = useSidebar();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const root = folders[0];
  const selected = selectedId ? findFolder(folders, selectedId) : null;
  // "New folder" creates inside the selected folder, or in the root while all entries or the recycle bin are shown.
  const newFolderParent = selected && !selected.inRecycleBin ? selected : root;

  /**
   * Selects a folder and closes the sidebar sheet on small screens.
   * @param folderId - The folder to show, or null for all entries.
   */
  function select(folderId: string | null) {
    actions.onSelect(folderId);
    setOpenMobile(false);
  }

  /**
   * Shows or hides the subfolders of a folder.
   * @param folderId - The folder whose subfolders are toggled.
   * @param open - Whether the subfolders should be shown.
   */
  function setOpen(folderId: string, open: boolean) {
    /**
     * Updates the set of collapsed folders.
     * @param current - The currently collapsed folder IDs.
     */
    setCollapsed((current) => {
      const next = new Set(current);
      if (open) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  /**
   * Renders one folder with its menu and, when expanded, its subfolders.
   * @param folder - The folder to render.
   */
  function renderFolder(folder: FolderNode) {
    const open = !collapsed.has(folder.id);
    const hasChildren = folder.children.length > 0;
    const deleteBlocker = folderDeleteBlocker(folder);
    return (
      <Collapsible key={folder.id} asChild open={open} onOpenChange={/**
       * Stores the expansion state chosen with the chevron.
       * @param next - Whether the subfolders are now shown.
       */ (next) => setOpen(folder.id, next)}>
        <SidebarMenuItem>
          {hasChildren && (
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="absolute start-1 top-1.5 z-10 grid size-5 place-items-center rounded-md text-sidebar-foreground/70 outline-hidden hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
              >
                <ChevronRightIcon className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
              </button>
            </CollapsibleTrigger>
          )}
          <SidebarMenuButton
            type="button"
            className={cn('ps-7', canWrite ? 'pr-14!' : 'pr-8!')}
            isActive={folder.id === selectedId}
            aria-current={folder.id === selectedId ? 'true' : undefined}
            disabled={disabled}
            title={folder.path}
            onClick={/** Shows the entries of this folder. */ () => select(folder.id)}
          >
            <FolderGlyph folder={folder} open={open} />
            <span>{folder.name}</span>
          </SidebarMenuButton>
          <SidebarMenuBadge className={canWrite ? 'right-7!' : undefined} aria-label={`${folder.entryCount} entries`}>
            {folder.entryCount}
          </SidebarMenuBadge>
          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction showOnHover disabled={disabled} aria-label={`Actions for ${folder.name}`}>
                  <EllipsisIcon />
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-56">
                <DropdownMenuItem
                  disabled={folder.inRecycleBin}
                  onSelect={/** Starts creating a subfolder in this folder. */ () => actions.onCreate(folder)}
                >
                  <FolderPlusIcon /> New subfolder
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={folder.isRoot || folder.isRecycleBin}
                  onSelect={/** Starts renaming this folder. */ () => actions.onRename(folder)}
                >
                  <PencilIcon /> Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={deleteBlocker !== null}
                  onSelect={/** Asks to delete this empty folder. */ () => actions.onDelete(folder)}
                >
                  <Trash2Icon />
                  <span className="grid">
                    <span>Delete</span>
                    {deleteBlocker && <span className="text-xs text-muted-foreground">{deleteBlocker}</span>}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {hasChildren && (
            <CollapsibleContent>
              <SidebarMenuSub className="me-0 pe-0">
                {folder.children.map(renderFolder)}
              </SidebarMenuSub>
            </CollapsibleContent>
          )}
        </SidebarMenuItem>
      </Collapsible>
    );
  }

  return (
    <>
    <SidebarGroup role="group" aria-label={`Folders of ${vaultName}`}>
      <SidebarGroupLabel className="min-w-0 pe-8">
        <span className="truncate" title={vaultName}>Folders · {vaultName}</span>
      </SidebarGroupLabel>
      {canWrite && root && newFolderParent && (
        <SidebarGroupAction
          type="button"
          title={`New folder in ${newFolderParent.name}`}
          aria-label={`New folder in ${newFolderParent.name}`}
          disabled={disabled}
          onClick={/** Starts creating a folder in the selected folder. */ () => actions.onCreate(newFolderParent)}
        >
          <FolderPlusIcon />
        </SidebarGroupAction>
      )}
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              className="pe-8"
              isActive={allSelected}
              aria-current={allSelected ? 'true' : undefined}
              disabled={disabled}
              onClick={/** Shows the entries of all folders. */ () => select(null)}
            >
              <LibraryIcon />
              <span>All entries</span>
            </SidebarMenuButton>
            <SidebarMenuBadge aria-label={`${totalEntries} entries`}>{totalEntries}</SidebarMenuBadge>
          </SidebarMenuItem>
          {(expiredCount > 0 || expiredSelected) && (
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                className="pe-8"
                isActive={expiredSelected}
                aria-current={expiredSelected ? 'true' : undefined}
                disabled={disabled}
                onClick={/** Shows the expired entries and closes the sidebar sheet on small screens. */ () => {
                  onSelectExpired();
                  setOpenMobile(false);
                }}
              >
                <CalendarX2Icon className="text-destructive" />
                <span>Expired</span>
              </SidebarMenuButton>
              <SidebarMenuBadge className="text-destructive" aria-label={`${expiredCount} expired entries`}>{expiredCount}</SidebarMenuBadge>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              className="pe-8"
              isActive={securitySelected}
              aria-current={securitySelected ? 'true' : undefined}
              disabled={disabled}
              onClick={/** Shows the security report and closes the sidebar sheet on small screens. */ () => {
                onSelectSecurity();
                setOpenMobile(false);
              }}
            >
              {securityCount > 0 ? <ShieldAlertIcon className="text-amber-600 dark:text-amber-400" /> : <ShieldCheckIcon className="text-emerald-600 dark:text-emerald-400" />}
              <span>Security</span>
            </SidebarMenuButton>
            <SidebarMenuBadge aria-label={`${securityCount} entries with findings`}>{securityCount}</SidebarMenuBadge>
          </SidebarMenuItem>
          {folders.map(renderFolder)}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
    {tags.length > 0 && (
      <SidebarGroup role="group" aria-label={`Tags of ${vaultName}`}>
        <SidebarGroupLabel>Tags</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {tags.map(/**
             * Renders one tag as a filter.
             * @param item - A tag of the vault with its count.
             */ (item) => (
              <SidebarMenuItem key={item.tag}>
                <SidebarMenuButton
                  type="button"
                  className="pe-8"
                  isActive={selectedTag?.toLowerCase() === item.tag.toLowerCase()}
                  aria-current={selectedTag?.toLowerCase() === item.tag.toLowerCase() ? 'true' : undefined}
                  disabled={disabled}
                  onClick={/** Shows the entries with this tag and closes the sidebar sheet on small screens. */ () => {
                    onSelectTag(item.tag);
                    setOpenMobile(false);
                  }}
                >
                  <TagIcon />
                  <span>{item.tag}</span>
                </SidebarMenuButton>
                <SidebarMenuBadge aria-label={`${item.count} entries`}>{item.count}</SidebarMenuBadge>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    )}
    </>
  );
}

/** A pending folder name dialog: creating inside a parent or renaming an existing folder. */
export type FolderNameRequest = { mode: 'create'; parent: FolderNode } | { mode: 'rename'; folder: FolderNode };

/**
 * Asks for the name of a new or renamed folder and validates it while typing.
 * @param props - The pending request, the validator, the busy state and the callbacks to submit or close.
 */
export function FolderNameDialog({
  request,
  busy,
  validate,
  onSubmit,
  onClose
}: {
  request: FolderNameRequest | null;
  busy: boolean;
  validate: (request: FolderNameRequest, name: string) => string | null;
  onSubmit: (request: FolderNameRequest, name: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={/**
     * Closes the dialog unless a save is running.
     * @param open - The requested dialog state.
     */ (open) => {
      if (!open && !busy) onClose();
    }}>
      {request && (
        <FolderNameForm
          key={request.mode === 'create' ? `create:${request.parent.id}` : `rename:${request.folder.id}`}
          request={request}
          busy={busy}
          validate={validate}
          onSubmit={onSubmit}
        />
      )}
    </Dialog>
  );
}

/**
 * The form inside the folder name dialog; remounted per request so the draft starts fresh.
 * @param props - The request, the busy state, the validator and the submit callback.
 */
function FolderNameForm({
  request,
  busy,
  validate,
  onSubmit
}: {
  request: FolderNameRequest;
  busy: boolean;
  validate: (request: FolderNameRequest, name: string) => string | null;
  onSubmit: (request: FolderNameRequest, name: string) => void;
}) {
  const [name, setName] = useState(request.mode === 'rename' ? request.folder.name : '');
  const [touched, setTouched] = useState(false);
  // While saving, the vault already contains the new name, so validating it again would report a duplicate.
  const error = busy ? null : validate(request, name);
  const unchanged = request.mode === 'rename' && name.trim() === request.folder.name;

  /**
   * Submits a valid name.
   * @param event - The form submission event.
   */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!error && !unchanged && !busy) onSubmit(request, name.trim());
  }

  return (
    <DialogContent className="sm:max-w-md">
      <form className="grid gap-5" onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>{request.mode === 'create' ? 'New folder' : 'Rename folder'}</DialogTitle>
          <DialogDescription>
            {request.mode === 'create'
              ? `The folder is created in “${request.parent.path}”.`
              : `Renames “${request.folder.path}”. KeePass apps show the new name after their next sync.`}
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={touched && error ? true : undefined}>
          <FieldLabel htmlFor="folder-name">Folder name</FieldLabel>
          <Input
            id="folder-name"
            autoFocus
            autoComplete="off"
            maxLength={MAX_FOLDER_NAME_LENGTH + 10}
            value={name}
            aria-invalid={touched && error ? true : undefined}
            onChange={/**
             * Updates the name draft and starts showing validation errors.
             * @param event - The input change event.
             */ (event) => {
              setName(event.target.value);
              setTouched(true);
            }}
          />
          {touched && error ? <FieldError>{error}</FieldError> : <FieldDescription>Folder names must be unique within their parent folder.</FieldDescription>}
        </Field>
        <DialogFooter>
          <Button type="submit" disabled={busy || Boolean(error) || unchanged}>
            {busy ? 'Saving…' : request.mode === 'create' ? 'Create folder' : 'Rename folder'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/**
 * Confirms the permanent deletion of an empty folder.
 * @param props - The folder to delete, the busy state and the callbacks to confirm or close.
 */
export function DeleteFolderDialog({
  folder,
  busy,
  onConfirm,
  onClose
}: {
  folder: FolderNode | null;
  busy: boolean;
  onConfirm: (folder: FolderNode) => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={folder !== null} onOpenChange={/**
     * Closes the dialog unless a save is running.
     * @param open - The requested dialog state.
     */ (open) => {
      if (!open && !busy) onClose();
    }}>
      {folder && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder “{folder.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The empty folder {folder.path} is removed permanently. KeePass apps remove it too when they sync.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={/**
               * Deletes the folder and keeps the dialog open until the save finishes.
               * @param event - The click event, prevented so the dialog does not close before saving.
               */ (event) => {
                event.preventDefault();
                onConfirm(folder);
              }}
            >
              {busy ? 'Deleting…' : 'Delete folder'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
