import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Kdbx } from 'kdbxweb';
import { api, ApiError } from './lib/api';
import type { User, VaultFile } from './lib/api';
import {
  clearVaultCredentials,
  entryMatches,
  listEntries,
  loadVault,
  reopenVault,
  saveEntryUpdate
} from './lib/kdbx';
import type { EntryEdits, EntryView } from './lib/kdbx';
import {
  VaultChangeError,
  applyVaultChange,
  createFolder,
  deleteFolder,
  findFolder,
  folderNameError,
  listFolders,
  moveEntries,
  renameFolder
} from './lib/groups';
import type { FolderNode } from './lib/groups';
import { listTemplates, templateStartFields, type TemplateInfo } from './lib/fields';
import type { AttachmentDraft } from './lib/attachments';
import { parseOtpSecret, totpCode, totpUri } from './lib/totp';
import { getTheme, toggleTheme } from './theme';
import { cn } from '@/lib/utils';
import { ACCENTS, accentFor, type Accent } from '@shared/accent';
import {
  ChevronDownIcon,
  ClockIcon,
  HardDriveIcon,
  InfoIcon,
  CircleCheckIcon,
  Columns3Icon,
  ImageDownIcon,
  CircleXIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  DatabaseIcon,
  FolderInputIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  LockKeyholeOpenIcon,
  LogOutIcon,
  MoonIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SunIcon,
  TriangleAlertIcon,
  TagIcon,
  Trash2Icon,
  UserRoundIcon,
  XIcon
} from 'lucide-react';
import { AuthLayout } from '@/components/auth-layout';
import { EntryAttachments } from '@/components/entry-attachments';
import { CopyButton } from '@/components/copy-button';
import { EntryFields } from '@/components/entry-fields';
import { EntryHistory } from '@/components/entry-history';
import { EntryIcon } from '@/components/entry-icon';
import { TagInput } from '@/components/tag-input';
import { TagsDialog } from '@/components/tags-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { deleteVersion, requireEntry, restoreVersion } from './lib/history';
import { hasTag, listTags, setEntryTags } from './lib/tags';
import { buildReport, type SecurityIssue } from './lib/security-report';
import { checkPasswords } from './lib/breach';
import { OPTIONAL_COLUMNS, readHiddenColumns, writeHiddenColumns, type OptionalColumn } from './lib/column-prefs';
import { iconToPng } from './lib/icon-image';
import { faviconUrl, storeEntryIcon } from './lib/icons';
import type { BreachCheckState } from '@/components/security-report';
import { SecurityReportTiles } from '@/components/security-report';
import { PasswordGenerator } from '@/components/password-generator';
import { openableUrl } from './lib/icons';
import { deleteEntries, emptyRecycleBin } from './lib/entry-actions';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DeleteFolderDialog,
  FolderNameDialog,
  FolderTree,
  type FolderActions,
  type FolderNameRequest
} from '@/components/folder-tree';
import { MoveEntriesDialog } from '@/components/move-entries-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar
} from '@/components/ui/sidebar';
import { TableCell, TableRow } from '@/components/ui/table';
import { VersionBadge } from '@shared/app-version';
import { InsecureContextAlert, hasBrowserCrypto } from '@shared/secure-context';
import { DataTable, type DataTableView, type TableColumn } from '@shared/data-table';
import { Textarea } from '@/components/ui/textarea';

type Message = { kind: 'notice' | 'error'; text: string } | null;
type EntryDraft = EntryEdits & { attachments: AttachmentDraft };

const DEFAULT_AUTO_LOCK_MINUTES = 5;
/** Seconds after which copied values are cleared from the clipboard unless the user chose otherwise. */
const DEFAULT_CLIPBOARD_CLEAR_SECONDS = 30;

/** The standard inputs a template may hide, with their KDBX field name and draft key. */
const STANDARD_INPUTS = [
  { key: 'UserName', draft: 'username' },
  { key: 'Password', draft: 'password' },
  { key: 'URL', draft: 'url' },
  { key: 'Notes', draft: 'notes' },
  { key: 'otp', draft: 'otp' }
] as const;

const ENTRY_COLUMNS: readonly TableColumn<EntryView>[] = [
  /**
   * Sorts by entry title.
   * @param entry - The unlocked entry supplying this column's sort value.
   */
  { id: 'title', label: 'Title', sortValue: (entry) => entry.title },
  /**
   * Sorts by username, treating a blank username as missing.
   * @param entry - The unlocked entry supplying this column's sort value.
   */
  { id: 'username', label: 'Username', sortValue: (entry) => entry.username || null },
  /**
   * Sorts by whether a password is set, without comparing password contents.
   * @param entry - The unlocked entry supplying this column's sort value.
   */
  { id: 'password', label: 'Password', sortValue: (entry) => Number(Boolean(entry.password)), className: 'hidden sm:table-cell' },
  /**
   * Sorts by whether TOTP is configured.
   * @param entry - The unlocked entry supplying this column's sort value.
   */
  { id: 'totp', label: 'TOTP', sortValue: (entry) => Number(Boolean(entry.otp)), className: 'hidden sm:table-cell' },
  /**
   * Sorts by the time of the last change, not by the displayed text.
   * @param entry - The unlocked entry supplying this column's sort value.
   */
  { id: 'modified', label: 'Modified', sortValue: (entry) => entry.modified?.getTime() ?? null, className: 'hidden lg:table-cell' },
  /**
   * Sorts by website URL, treating a blank URL as missing.
   * @param entry - The unlocked entry supplying this column's sort value.
   */
  { id: 'website', label: 'Website', sortValue: (entry) => entry.url || null, className: 'hidden md:table-cell' }
];

/**
 * Labels a headline number with an icon on a tinted tile.
 * @param props - The icon, its accent colour and the label text.
 */
function StatLabel({ icon, accent, children }: { icon: ReactNode; accent: Accent; children: ReactNode }) {
  return (
    <CardDescription className="flex items-center gap-2.5 font-medium">
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4', accent.tile)}>{icon}</span>
      {children}
    </CardDescription>
  );
}

/**
 * Formats the encrypted file size for display.
 * @param size - The file size in bytes.
 */
function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Formats a vault timestamp or retains the original text if invalid.
 * @param value - The timestamp string to format for the current locale.
 */
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * Checks whether a click hit a control inside a table row, which handles the click itself.
 * @param target - The element that was clicked.
 */
function isInteractive(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('button, a, input, textarea, select, [role="checkbox"], [role="menuitem"]'));
}

/**
 * Describes how long ago a time was, e.g. "3 days ago" or "last year".
 * @param date - The time to describe.
 * @param now - The reference time.
 */
function formatRelative(date: Date | undefined, now: number) {
  if (!date || Number.isNaN(date.getTime())) return '—';
  const seconds = (date.getTime() - now) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeTime.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/**
 * Extracts API error details or uses the fallback message.
 * @param error - The caught error to inspect.
 * @param fallback - The message to use if the error has no useful text.
 */
function errorText(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * Creates a local draft without changing the entry or its stored attachments.
 * @param entry - The unlocked entry to edit, or null for a new entry.
 * @param template - For a new entry: the template it is created from.
 */
function entryDraft(entry: EntryView | null, template: TemplateInfo | null = null): EntryDraft {
  return {
    title: entry?.title ?? '',
    username: entry?.username ?? '',
    password: entry?.password ?? '',
    url: entry?.url ?? '',
    notes: entry?.notes ?? '',
    otp: entry?.otp ?? '',
    customFields: entry ? entry.customFields : template ? templateStartFields(template) : [],
    expires: entry?.expires ?? '',
    templateId: entry ? undefined : template?.id,
    tags: entry ? [...entry.tags] : [],
    attachments: entry?.entry.binaries ?? new Map()
  };
}

/** Manages the vault session, client-side unlocking, and entry editing. */
export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [db, setDb] = useState<Kdbx | null>(null);
  const [entries, setEntries] = useState<EntryView[]>([]);
  const [etag, setEtag] = useState('');
  const [permission, setPermission] = useState<'read' | 'read-write'>('read');
  const [selectedEntry, setSelectedEntry] = useState<EntryView | null>(null);
  const [edits, setEdits] = useState<EntryDraft | null>(null);
  const vaultGeneration = useRef(0);
  /** The encrypted bytes of the last loaded or saved revision; a failed folder change reloads the vault from them. */
  const savedBytes = useRef<Uint8Array | null>(null);
  /** The pending timer that clears copied values from the clipboard. */
  const clipboardTimer = useRef<number | undefined>(undefined);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [folderRequest, setFolderRequest] = useState<FolderNameRequest | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<FolderNode | null>(null);
  const [moving, setMoving] = useState(false);
  const [showAllFields, setShowAllFields] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [expiredView, setExpiredView] = useState(false);
  const [tagView, setTagView] = useState<string | null>(null);
  const [securityView, setSecurityView] = useState(false);
  const [securityIssue, setSecurityIssue] = useState<SecurityIssue | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<OptionalColumn>>(/** Reads the column choice of this browser. */ () => readHiddenColumns());
  const [breachResults, setBreachResults] = useState<ReadonlyMap<string, number>>(new Map());
  const [breach, setBreach] = useState<Omit<BreachCheckState, 'enabled'>>({ status: 'idle', done: 0, total: 0, error: null });
  /** When the entry list was last built; the security report and relative dates refer to it. */
  const [listedAt, setListedAt] = useState(0);
  const [tagging, setTagging] = useState(false);
  const [sheetTab, setSheetTab] = useState<'details' | 'history'>('details');
  const [deleteRequest, setDeleteRequest] = useState<{ ids: string[]; permanent: boolean; fromSheet: boolean } | null>(null);
  const [confirmEmptyBin, setConfirmEmptyBin] = useState(false);
  const [totp, setTotp] = useState<{ code: string; secondsLeft: number } | null>(null);

  /** Starts periodic TOTP updates while the current draft has a usable secret. */
  useEffect(() => {
    const config = edits?.otp ? parseOtpSecret(edits.otp) : null;
    if (!config) {
      setTotp(null);
      return;
    }
    let cancelled = false;
    /** Calculates the current code and countdown without updating a stale view. */
    const update = async () => {
      try {
        const result = await totpCode(config);
        if (!cancelled) setTotp(result);
      } catch {
        if (!cancelled) setTotp(null);
      }
    };
    void update();
    const timer = window.setInterval(/** Refreshes the code and countdown on each timer tick. */ () => void update(), 1000);
    return /** Stops TOTP updates when the secret or entry changes. */ () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [edits?.otp]);
  const [password, setPassword] = useState('');
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [theme, setTheme] = useState(getTheme);
  const [autoLockMinutes, setAutoLockMinutes] = useState(DEFAULT_AUTO_LOCK_MINUTES);
  const [showProfile, setShowProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<Message>(null);

  const selectedFile = useMemo(/** Resolves the selected vault against the available file metadata. */ () => files.find(/**
   * Matches the selected vault by ID.
   * @param file - One accessible file whose ID is compared with the current selection.
   */ (file) => file.id === selectedId) ?? null, [files, selectedId]);
  const canWrite = permission === 'read-write';
  const showFavicons = user?.showFavicons ?? false;
  const unlocked = Boolean(db && selectedFile);
  const currentFolder = folderId ? findFolder(folders, folderId) : null;
  // Templates are entries, so the list follows every change of the entries.
  const templates = useMemo(/** Lists the templates of the open vault. */ () => (db && entries.length ? listTemplates(db) : []), [db, entries]);
  const draftTemplate = selectedEntry ? selectedEntry.template : templates.find(/**
   * Finds the template of a new entry draft.
   * @param template - One template of the vault.
   */ (template) => template.id === edits?.templateId) ?? null;
  const editingTemplate = selectedEntry?.isTemplate ?? false;
  const canEditEntry = canWrite && !editingTemplate;
  /**
   * Decides whether a standard field is shown: always without a template, otherwise only if the template lists it,
   * it has a value, or the user asked for all fields — like KeePass2Android.
   * @param name - The KDBX name of the standard field.
   * @param value - The field's current draft value.
   */
  const showStandard = (name: string, value: string) => !draftTemplate || showAllFields || Boolean(value)
    || draftTemplate.fields.some(/**
     * Checks whether the template lists the field.
     * @param field - One template field.
     */ (field) => field.kind === 'standard' && field.name === name);
  const report = useMemo(/** Checks the passwords of the open vault, only in this browser. */ () => buildReport(entries, new Date(listedAt), breach.status === 'done' ? breachResults : undefined), [entries, listedAt, breach.status, breachResults]);
  const visibleColumns = useMemo(/** Lists the columns that are not hidden; the title is always shown. */ () => ENTRY_COLUMNS.filter(/**
   * Keeps the title and the columns the user did not hide.
   * @param column - One column.
   */ (column) => column.id === 'title' || !hiddenColumns.has(column.id as OptionalColumn)), [hiddenColumns]);
  /**
   * Checks whether an optional column is shown.
   * @param column - The column ID.
   */
  const showColumn = (column: OptionalColumn) => !hiddenColumns.has(column);
  // Relative dates such as "3 days ago" refer to the time the list was built.
  const renderedAt = listedAt;
  /**
   * Returns the warning for an entry's password, or null: weak, or used in several entries.
   * @param entry - One entry of the vault.
   */
  const passwordWarning = (entry: EntryView) => {
    const parts = [
      report.issues.weak.has(entry.id) ? 'Weak password' : '',
      report.reuseCounts.has(entry.id) ? `Used in ${report.reuseCounts.get(entry.id)} entries` : '',
      report.breachCounts.has(entry.id) ? `Found in data breaches (${report.breachCounts.get(entry.id)?.toLocaleString()} times)` : ''
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  };
  /**
   * Shows only the entries of the current view; a search still covers all folders.
   * @param entry - One entry of the vault.
   */
  const browseFilter = useMemo(() => (securityView
    ? (entry: EntryView) => (securityIssue ? report.issues[securityIssue].has(entry.id) : report.affected.has(entry.id))
    : tagView
    ? (entry: EntryView) => hasTag(entry.tags, tagView)
    : expiredView
      ? (entry: EntryView) => entry.expired
      : currentFolder ? (entry: EntryView) => entry.groupId === currentFolder.id : undefined), [currentFolder, expiredView, tagView, securityView, securityIssue, report]);
  /**
   * The entries the table works on: templates and recycled entries only while their own folder is selected.
   */
  const tableEntries = useMemo(/** Selects the entries shown for the current folder. */ () => entries.filter(/**
   * Keeps regular entries and the hidden ones of the selected folder.
   * @param entry - One entry of the vault.
   */ (entry) => !entry.hidden || entry.groupId === currentFolder?.id), [entries, currentFolder]);
  const expiredCount = useMemo(/** Counts expired entries outside templates and the recycle bin. */ () => entries.filter(/**
   * Keeps expired regular entries.
   * @param entry - One entry of the vault.
   */ (entry) => entry.expired && !entry.hidden).length, [entries]);
  const vaultTags = useMemo(/** Lists the tags of regular entries with their counts. */ () => listTags(entries.filter(/**
   * Keeps regular entries.
   * @param entry - One entry of the vault.
   */ (entry) => !entry.hidden)), [entries]);
  const visibleCount = useMemo(/** Counts the regular entries. */ () => entries.filter(/**
   * Counts entries that are neither templates nor in the recycle bin.
   * @param entry - One entry of the vault.
   */ (entry) => !entry.hidden).length, [entries]);
  const selectedFolderIds = useMemo(/** Collects the folders that contain the selected entries. */ () => new Set(entries.filter(/**
   * Keeps the selected entries.
   * @param entry - One entry of the vault.
   */ (entry) => selection.has(entry.id)).map(/**
   * Selects the folder of an entry.
   * @param entry - One selected entry.
   */ (entry) => entry.groupId)), [entries, selection]);
  const otpUri = useMemo(/** Prepares a provisioning URI without displaying the secret. */ () =>
    totpUri(edits?.otp ?? '', edits?.title ?? ''), [edits?.otp, edits?.title]);

  /** Refreshes the encrypted vault inventory for the current user. */
  async function refreshFiles() {
    const list = await api.listVaultFiles();
    setFiles(list);
  }

  /**
   * Re-reads entries and folders after the vault changed and drops a folder selection that no longer exists.
   * @param vault - The unlocked database to read.
   */
  function refreshView(vault: Kdbx) {
    const nextFolders = listFolders(vault);
    setEntries(listEntries(vault));
    setListedAt(Date.now());
    setFolders(nextFolders);
    /**
     * Keeps the selected folder only while it still exists.
     * @param current - The currently selected folder ID.
     */
    setFolderId((current) => (current && findFolder(nextFolders, current) ? current : null));
  }

  /** Clears the folder view state when a vault is locked or closed. */
  const resetFolderState = useCallback(() => {
    savedBytes.current = null;
    setFolders([]);
    setFolderId(null);
    setSelection(new Set());
    setFolderRequest(null);
    setFolderToDelete(null);
    setMoving(false);
    setExpiredView(false);
    setTagView(null);
    setSecurityView(false);
    setSecurityIssue(null);
    setFocusedId(null);
    setBreachResults(new Map());
    setBreach({ status: 'idle', done: 0, total: 0, error: null });
    setTagging(false);
    setDeleteRequest(null);
    setConfirmEmptyBin(false);
  }, []);

  /**
   * Locks the open database and clears its credentials and entry state.
   * @param notify - Whether to display the vault locked notice.
   */
  function lockVault(notify = false) {
    vaultGeneration.current += 1;
    if (clipboardTimer.current !== undefined) {
      window.clearTimeout(clipboardTimer.current);
      clearClipboard();
    }
    clearVaultCredentials(db);
    resetFolderState();
    setDb(null);
    setEntries([]);
    setSelectedEntry(null);
    setEdits(null);
    setTotp(null);
    setPassword('');
    setKeyFile(null);
    if (notify) setMessage({ kind: 'notice', text: 'Vault locked. Secrets were discarded from this browser tab.' });
  }

  /**
   * Locks the current vault before switching to the selected file.
   * @param file - The encrypted vault selected in the navigation.
   */
  function selectFile(file: VaultFile) {
    lockVault(false);
    setSelectedId(file.id);
    setPermission(file.permission);
    setEtag(file.etag);
    setMessage(null);
  }

  /**
   * Downloads the encrypted vault and unlocks it locally with the supplied credentials.
   * @param event - The submission event from the vault unlock form.
   */
  async function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || busy) return;
    if (!password && !keyFile) {
      setMessage({ kind: 'error', text: 'Enter the master password or select a key file.' });
      return;
    }
    setBusy('unlock');
    setMessage(null);
    try {
      const content = await api.getFileBytes(selectedFile.id);
      const keyFileBytes = keyFile ? await keyFile.arrayBuffer() : null;
      const loaded = new Uint8Array(content.bytes.slice(0));
      const vault = await loadVault(content.bytes, password, keyFileBytes);
      savedBytes.current = loaded;
      setDb(vault);
      setFolderId(null);
      setSelection(new Set());
      refreshView(vault);
      setEtag(content.etag || selectedFile.etag);
      setPermission(selectedFile.permission);
      setSelectedEntry(null);
      setEdits(null);
      setPassword('');
      setKeyFile(null);
      setMessage({ kind: 'notice', text: `Unlocked ${selectedFile.name}. Data stays in this browser only.` });
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Unable to unlock vault. Check the password and key file.') });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Downloads the latest revision of the open vault and opens it with the credentials still held in this tab, keeping
   * the selected folder and the still existing part of the selection.
   */
  async function handleReload() {
    if (!db || !selectedFile || busy) return;
    const generation = vaultGeneration.current;
    setBusy('reload');
    setMessage(null);
    try {
      const content = await api.getFileBytes(selectedFile.id);
      if (generation !== vaultGeneration.current) return;
      if (content.etag && content.etag === etag) {
        setMessage({ kind: 'notice', text: 'The vault is already up to date.' });
        return;
      }
      const loaded = new Uint8Array(content.bytes.slice(0));
      const vault = await reopenVault(content.bytes, db.credentials);
      if (generation !== vaultGeneration.current) return;
      savedBytes.current = loaded;
      setDb(vault);
      setEtag(content.etag);
      refreshView(vault);
      const ids = new Set(listEntries(vault).map(/**
       * Selects the entry ID.
       * @param entry - One entry of the reloaded vault.
       */ (entry) => entry.id));
      /**
       * Keeps only selected entries that still exist.
       * @param current - The currently selected entry IDs.
       */
      setSelection((current) => new Set([...current].filter(/**
       * Checks whether a selected entry still exists.
       * @param id - One selected entry ID.
       */ (id) => ids.has(id))));
      setMessage({ kind: 'notice', text: 'Vault reloaded. You now see the latest saved version.' });
      try {
        await refreshFiles();
      } catch {
        /* the reloaded vault is shown; the file metadata refreshes on the next save */
      }
    } catch (error) {
      if (generation !== vaultGeneration.current) return;
      setMessage({ kind: 'error', text: errorText(error, 'Unable to reload the vault.') });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Opens an existing entry in the form and marks its row.
   * @param entry - The entry to open.
   */
  function openEntry(entry: EntryView) {
    setMessage(null);
    setShowAllFields(false);
    setShowPassword(false);
    setSheetTab('details');
    setFocusedId(entry.id);
    setSelectedEntry(entry);
    setEdits(entryDraft(entry));
  }

  /**
   * Opens a draft for creating an entry in the unlocked vault, optionally from a template.
   * @param template - The template to start from, or null for an empty entry.
   */
  function startNewEntry(template: TemplateInfo | null = null) {
    setSelectedEntry(null);
    setShowAllFields(false);
    setShowPassword(false);
    setSheetTab('details');
    setEdits(entryDraft(null, template));
    setMessage(null);
  }

  /**
   * Encrypts and saves entry changes using the current ETag as a precondition.
   * @param event - The submission event from the entry editor form.
   */
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db || !selectedFile || !edits || busy) return;
    if (!canWrite) {
      setMessage({ kind: 'error', text: 'This vault is read-only for your account.' });
      return;
    }
    const generation = vaultGeneration.current;
    setBusy('save');
    setMessage(null);
    try {
      const { entryId, updated } = await saveEntryUpdate(db, selectedEntry?.entry ?? null, edits, edits.attachments, /**
       * Writes the encrypted revision only while this vault is still unlocked.
       * @param bytes - The serialized, encrypted KDBX database.
       */ async (bytes) => {
        if (generation !== vaultGeneration.current) throw new Error('The vault locked before saving.');
        const result = await api.putFileBytes(selectedFile.id, bytes, etag);
        savedBytes.current = bytes;
        return result;
      }, currentFolder && !currentFolder.inRecycleBin ? currentFolder.id : undefined);
      if (generation !== vaultGeneration.current) return;
      const nextEntries = listEntries(db);
      const refreshed = nextEntries.find(/**
       * Finds the saved entry in the refreshed list.
       * @param entry - One refreshed entry whose ID is compared with the saved entry.
       */ (entry) => entry.id === entryId) ?? null;
      /**
       * Updates the file list with the metadata returned by the save.
       * @param current - The vault metadata list currently shown to the user.
       */
      setFiles((current) => current.map(/**
       * Merges the new metadata into only the saved vault's row, keeping the permission from the file list.
       * @param file - One listed vault whose metadata may need to be refreshed.
       */ (file) => (file.id === updated.id ? { ...file, ...updated, permission: file.permission } : file)));
      setEtag(updated.etag);
      refreshView(db);
      setSelectedEntry(refreshed);
      setEdits(refreshed ? entryDraft(refreshed) : null);
      setMessage({ kind: 'notice', text: 'Vault saved.' });
    } catch (error) {
      if (generation !== vaultGeneration.current) return;
      if (error instanceof ApiError && error.status === 409) {
        setMessage({ kind: 'error', text: `${error.message} Close and reopen the vault to load the latest version.` });
        try {
          await refreshFiles();
        } catch {
          /* keep the original conflict message visible */
        }
      } else {
        setMessage({ kind: 'error', text: errorText(error, 'Unable to save vault.') });
      }
    } finally {
      setBusy(null);
    }
  }

  /**
   * Applies a folder change or a move to the open vault and saves it at once. If saving fails, the vault is reloaded
   * from the last saved revision so the view matches the server again.
   * @param change - The in-memory change; its result is passed to the success message.
   * @param success - Builds the notice shown after saving.
   */
  async function runVaultChange<R>(change: (vault: Kdbx) => R, success: (result: R) => string): Promise<boolean> {
    const saved = savedBytes.current;
    if (!db || !selectedFile || !saved || busy) return false;
    if (!canWrite) {
      setMessage({ kind: 'error', text: 'This vault is read-only for your account.' });
      return false;
    }
    const generation = vaultGeneration.current;
    setBusy('save');
    setMessage(null);
    try {
      const { result, updated, bytes } = await applyVaultChange(db, saved, change, /**
       * Writes the encrypted revision only while this vault is still unlocked.
       * @param encrypted - The serialized, encrypted KDBX database.
       */ (encrypted) => {
        if (generation !== vaultGeneration.current) throw new Error('The vault locked before saving.');
        return api.putFileBytes(selectedFile.id, encrypted, etag);
      });
      if (generation !== vaultGeneration.current) return false;
      savedBytes.current = bytes;
      /**
       * Updates the file list with the metadata returned by the save.
       * @param current - The vault metadata list currently shown to the user.
       */
      setFiles((current) => current.map(/**
       * Merges the new metadata into only the saved vault's row, keeping the permission from the file list.
       * @param file - One listed vault whose metadata may need to be refreshed.
       */ (file) => (file.id === updated.id ? { ...file, ...updated, permission: file.permission } : file)));
      setEtag(updated.etag);
      refreshView(db);
      setMessage({ kind: 'notice', text: success(result) });
      return true;
    } catch (error) {
      if (generation !== vaultGeneration.current) return false;
      const cause = error instanceof VaultChangeError ? error.cause : error;
      if (error instanceof VaultChangeError) {
        if (error.restored) {
          setDb(error.restored);
          refreshView(error.restored);
        } else {
          lockVault(false);
        }
      }
      if (cause instanceof ApiError && cause.status === 409) {
        setMessage({ kind: 'error', text: `${cause.message} Your change was not saved. Close and reopen the vault to load the latest version.` });
        try {
          await refreshFiles();
        } catch {
          /* keep the original conflict message visible */
        }
      } else {
        setMessage({ kind: 'error', text: `${errorText(cause, 'Unable to save vault.')} Your change was not saved.` });
      }
      return false;
    } finally {
      setBusy(null);
    }
  }

  /**
   * Validates a folder name against the open vault.
   * @param request - The folder being created or renamed.
   * @param name - The name typed by the user.
   */
  function validateFolderName(request: FolderNameRequest, name: string): string | null {
    if (!db) return 'The vault is locked.';
    return request.mode === 'create'
      ? folderNameError(db, request.parent.id, name)
      : folderNameError(db, request.folder.parentId ?? '', name, request.folder.id);
  }

  /**
   * Creates or renames a folder and saves the vault.
   * @param request - The folder being created or renamed.
   * @param name - The validated folder name.
   */
  async function submitFolderName(request: FolderNameRequest, name: string) {
    // The dialog closes in the same update as the saved result, so it never validates against the already changed vault.
    if (request.mode === 'create') {
      await runVaultChange(/**
         * Creates the folder and returns its ID so it can be selected.
         * @param vault - The vault to change.
         */ (vault) => createFolder(vault, request.parent.id, name).uuid.id, /**
         * Describes the created folder.
         * @param id - The ID of the new folder.
         */ (id) => {
          setFolderRequest(null);
          setFolderId(id);
          setSelection(new Set());
          return `Folder “${name}” created.`;
        });
    } else {
      await runVaultChange(/**
         * Renames the folder.
         * @param vault - The vault to change.
         */ (vault) => renameFolder(vault, request.folder.id, name), /** Closes the dialog and describes the rename. */ () => {
          setFolderRequest(null);
          return `Folder renamed to “${name}”.`;
        });
    }
  }

  /**
   * Deletes an empty folder and saves the vault.
   * @param folder - The folder to delete.
   */
  async function confirmDeleteFolder(folder: FolderNode) {
    const ok = await runVaultChange(/**
     * Deletes the folder permanently.
     * @param vault - The vault to change.
     */ (vault) => deleteFolder(vault, folder.id), /** Describes the deletion. */ () => `Folder “${folder.name}” deleted.`);
    setFolderToDelete(null);
    if (ok && folderId === folder.id) setFolderId(folder.parentId);
  }

  /**
   * Asks to delete entries. Entries go to the recycle bin; entries already in it (or all entries when the vault has no
   * recycle bin) are deleted permanently, which the confirmation says.
   * @param ids - The entries to delete.
   * @param fromSheet - Whether the request comes from the open entry form, which closes after deleting.
   */
  function requestDelete(ids: string[], fromSheet: boolean) {
    const permanent = db?.meta.recycleBinEnabled === false || ids.every(/**
     * Checks whether an entry already lies in the recycle bin.
     * @param id - One entry ID.
     */ (id) => {
      const entry = entries.find(/**
       * Finds the entry view.
       * @param item - One entry of the vault.
       */ (item) => item.id === id);
      return Boolean(entry && findFolder(folders, entry.groupId)?.inRecycleBin);
    });
    setDeleteRequest({ ids, permanent, fromSheet });
  }

  /** Deletes the confirmed entries and saves the vault. */
  async function confirmDelete() {
    const request = deleteRequest;
    if (!request) return;
    const ok = await runVaultChange(/**
     * Deletes the entries.
     * @param vault - The vault to change.
     */ (vault) => deleteEntries(vault, request.ids), /**
     * Closes the dialogs and describes the result.
     * @param result - How many entries went to the recycle bin and how many were removed permanently.
     */ (result) => {
      setDeleteRequest(null);
      setSelection(new Set());
      if (request.fromSheet) {
        setSelectedEntry(null);
        setEdits(null);
      }
      const parts = [
        result.recycled ? `${result.recycled} moved to the recycle bin` : '',
        result.removed ? `${result.removed} deleted permanently` : ''
      ].filter(Boolean);
      return `${result.recycled + result.removed === 1 ? 'Entry' : 'Entries'}: ${parts.join(', ')}.`;
    });
    if (!ok) setDeleteRequest(null);
  }

  /** Empties the recycle bin and saves the vault. */
  async function confirmEmptyRecycleBin() {
    const ok = await runVaultChange(emptyRecycleBin, /**
     * Closes the dialog and describes the result.
     * @param count - The number of entries removed.
     */ (count) => {
      setConfirmEmptyBin(false);
      setSelection(new Set());
      return `Recycle bin emptied: ${count} ${count === 1 ? 'entry' : 'entries'} deleted permanently.`;
    });
    if (!ok) setConfirmEmptyBin(false);
  }

  /**
   * Shows or hides a column of the entry list and remembers the choice in this browser.
   * @param column - The column.
   * @param shown - Whether it is shown.
   */
  function toggleColumn(column: OptionalColumn, shown: boolean) {
    const next = new Set(hiddenColumns);
    if (shown) next.delete(column);
    else next.add(column);
    setHiddenColumns(next);
    writeHiddenColumns(next);
  }

  /**
   * Checks the passwords of the open vault against "Have I Been Pwned" if the user opted in. Only the first five
   * characters of each SHA-1 hash leave the browser. Passwords already checked in this session are skipped unless
   * a full check is requested.
   * @param full - Whether to check all passwords again.
   */
  async function runBreachCheck(full = false) {
    if (!user?.checkBreaches || breach.status === 'checking') return;
    const generation = vaultGeneration.current;
    const passwords = entries.filter(/**
     * Keeps regular entries with a password that still needs checking.
     * @param entry - One entry of the vault.
     */ (entry) => !entry.hidden && entry.password && (full || !breachResults.has(entry.password))).map(/**
     * Selects the password.
     * @param entry - One entry.
     */ (entry) => entry.password);
    setBreach({ status: 'checking', done: 0, total: new Set(passwords).size, error: null });
    try {
      const results = await checkPasswords(passwords, /**
       * Shows the progress.
       * @param done - Ranges checked.
       * @param total - All ranges.
       */ (done, total) => {
        if (generation === vaultGeneration.current) setBreach({ status: 'checking', done, total, error: null });
      });
      if (generation !== vaultGeneration.current) return;
      setBreachResults(new Map([...(full ? [] : breachResults), ...results]));
      setBreach({ status: 'done', done: 0, total: 0, error: null });
    } catch (error) {
      if (generation !== vaultGeneration.current) return;
      setBreach({ status: 'error', done: 0, total: 0, error: errorText(error, 'Have I Been Pwned could not be reached.') });
    }
  }

  /**
   * Downloads the website icon of the open entry through the KeePort server, converts it to a 32×32 PNG and stores
   * it in the vault, so KeePass apps show it too.
   */
  async function saveWebsiteIcon() {
    const id = selectedEntry?.id;
    const address = faviconUrl(edits?.url ?? '');
    if (!id || !address) return;
    const host = new URL(address).hostname;
    setBusy('icon');
    setMessage(null);
    let png: Uint8Array;
    try {
      png = await iconToPng(await api.getFavicon(host));
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'The website icon could not be downloaded.') });
      setBusy(null);
      return;
    }
    setBusy(null);
    const ok = await runVaultChange(/**
     * Stores the icon on the entry.
     * @param vault - The vault to change.
     */ (vault) => storeEntryIcon(vault, requireEntry(vault, id), png, host), /** Shows the entry with its new icon. */ () => {
      const refreshed = db ? listEntries(db).find(/**
       * Finds the changed entry.
       * @param entry - One entry of the vault.
       */ (entry) => entry.id === id) ?? null : null;
      setSelectedEntry(refreshed);
      if (refreshed && edits) setEdits({ ...edits });
      return `Website icon of ${host} saved in the vault. KeePass apps show it after their next sync.`;
    });
    if (!ok) {
      setSelectedEntry(null);
      setEdits(null);
    }
  }

  /**
   * Shows the entries with a tag across all folders.
   * @param tag - The tag to filter by.
   */
  function showTag(tag: string) {
    setTagView(tag);
    setFolderId(null);
    setExpiredView(false);
    setSecurityView(false);
    setSelection(new Set());
  }

  /**
   * Restores or deletes a saved version of the open entry and saves the vault. The form shows the result afterwards;
   * if saving fails, the form closes because the vault was reloaded from the last saved state.
   * @param kind - Whether to restore or delete the version.
   * @param index - The index of the version in the entry's history.
   */
  async function changeVersion(kind: 'restore' | 'delete', index: number): Promise<boolean> {
    const id = selectedEntry?.id;
    if (!id) return false;
    const ok = await runVaultChange(/**
     * Restores or deletes the version.
     * @param vault - The vault to change.
     */ (vault) => {
      const entry = requireEntry(vault, id);
      if (kind === 'restore') restoreVersion(vault, entry, index);
      else deleteVersion(entry, index);
    }, /** Shows the changed entry in the form and describes the result. */ () => {
      const refreshed = db ? listEntries(db).find(/**
       * Finds the changed entry.
       * @param entry - One entry of the vault.
       */ (entry) => entry.id === id) ?? null : null;
      setSelectedEntry(refreshed);
      setEdits(refreshed ? entryDraft(refreshed) : null);
      if (kind === 'restore') setSheetTab('details');
      return kind === 'restore' ? 'Version restored. The previous state is kept in the history.' : 'Version deleted from the history.';
    });
    if (!ok) {
      setSelectedEntry(null);
      setEdits(null);
    }
    return ok;
  }

  /**
   * Adds and removes tags on the selected entries and saves the vault.
   * @param add - Tags to add.
   * @param remove - Tags to remove.
   */
  async function applySelectionTags(add: string[], remove: string[]) {
    const ids = [...selection];
    const ok = await runVaultChange(/**
     * Changes the tags.
     * @param vault - The vault to change.
     */ (vault) => setEntryTags(vault, ids, add, remove), /**
     * Closes the dialog and describes the result.
     * @param changed - The number of entries that changed.
     */ (changed) => {
      setTagging(false);
      return `Tags updated on ${changed} ${changed === 1 ? 'entry' : 'entries'}.`;
    });
    if (!ok) setTagging(false);
  }

  /**
   * Moves the selected entries into a folder and saves the vault.
   * @param targetId - The destination folder.
   */
  async function moveSelection(targetId: string) {
    const target = findFolder(folders, targetId);
    const ids = [...selection];
    const ok = await runVaultChange(/**
     * Moves the selected entries.
     * @param vault - The vault to change.
     */ (vault) => moveEntries(vault, ids, targetId), /**
     * Closes the dialog, clears the selection and describes the move.
     * @param moved - The number of entries that changed folders.
     */ (moved) => {
      setMoving(false);
      setSelection(new Set());
      return `Moved ${moved} ${moved === 1 ? 'entry' : 'entries'} to “${target?.name ?? 'folder'}”.`;
    });
    if (!ok) setMoving(false);
  }

  /**
   * Adds or removes entries from the selection.
   * @param ids - The entries to change.
   * @param selected - Whether they should be selected.
   */
  function setSelected(ids: Iterable<string>, selected: boolean) {
    /**
     * Builds the new selection.
     * @param current - The currently selected entry IDs.
     */
    setSelection((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const folderActions: FolderActions = {
    /**
     * Shows a folder and clears the selection, which only applies to the previous view.
     * @param id - The folder to show, or null for all entries.
     */
    onSelect: (id) => {
      setFolderId(id);
      setExpiredView(false);
      setTagView(null);
      setSecurityView(false);
      setSelection(new Set());
    },
    /**
     * Opens the dialog to create a folder.
     * @param parent - The folder that receives the new folder.
     */
    onCreate: (parent) => setFolderRequest({ mode: 'create', parent }),
    /**
     * Opens the dialog to rename a folder.
     * @param folder - The folder to rename.
     */
    onRename: (folder) => setFolderRequest({ mode: 'rename', folder }),
    /**
     * Asks to confirm the deletion of an empty folder.
     * @param folder - The folder to delete.
     */
    onDelete: (folder) => setFolderToDelete(folder)
  };

  /**
   * Renders the select-all checkbox for the current page.
   * @param view - The rows on the current page and all matching rows.
   */
  function renderSelectAll({ pageRows }: DataTableView<EntryView>) {
    const ids = pageRows.map(/**
     * Selects the entry ID.
     * @param entry - One entry on the page.
     */ (entry) => entry.id);
    const chosen = ids.filter(/**
     * Keeps the selected IDs.
     * @param id - One entry ID on the page.
     */ (id) => selection.has(id)).length;
    return (
      <Checkbox
        aria-label="Select all entries on this page"
        checked={ids.length > 0 && chosen === ids.length ? true : chosen > 0 ? 'indeterminate' : false}
        disabled={!ids.length || busy !== null}
        onCheckedChange={/**
         * Selects or clears all entries on the page.
         * @param checked - The new checkbox state.
         */ (checked) => setSelected(ids, checked === true)}
      />
    );
  }

  /**
   * Renders the action bar for the selected entries.
   * @param view - The rows on the current page and all matching rows.
   */
  function renderSelectionBar({ pageRows, results }: DataTableView<EntryView>) {
    if (!selection.size) return null;
    const pageSelected = pageRows.length > 0 && pageRows.every(/**
     * Checks whether an entry on the page is selected.
     * @param entry - One entry on the page.
     */ (entry) => selection.has(entry.id));
    const allSelected = results.every(/**
     * Checks whether a matching entry is selected.
     * @param entry - One matching entry.
     */ (entry) => selection.has(entry.id));
    return (
      <div role="region" aria-label="Selected entries" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-y bg-muted/40 px-4 py-2 text-sm sm:px-6">
        <span className="font-medium tabular-nums" aria-live="polite">{selection.size} selected</span>
        <Button size="sm" disabled={busy !== null} onClick={/** Opens the destination folder picker. */ () => setMoving(true)}>
          <FolderInputIcon /> Move to…
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={/** Opens the tags dialog for the selection. */ () => setTagging(true)}>
          <TagIcon /> Tags…
        </Button>
        <Button size="sm" variant="destructive" disabled={busy !== null} onClick={/** Asks to delete the selected entries. */ () => requestDelete([...selection], false)}>
          <Trash2Icon /> Delete
        </Button>
        {pageSelected && !allSelected && (
          <Button
            size="sm"
            variant="link"
            className="px-0"
            onClick={/** Selects every entry that matches the current folder or search. */ () => setSelected(results.map(/**
             * Selects the entry ID.
             * @param entry - One matching entry.
             */ (entry) => entry.id), true)}
          >
            Select all {results.length} results
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ms-auto" onClick={/** Clears the selection. */ () => setSelection(new Set())}>
          <XIcon /> Clear selection
        </Button>
      </div>
    );
  }

  /**
   * Signs in to the Vault API and refreshes the user's file inventory.
   * @param event - The submission event from the sign-in form.
   */
  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const username = String(data.get('username') ?? '');
    const passwordValue = String(data.get('password') ?? '');
    setBusy('login');
    setMessage(null);
    try {
      const result = await api.login({ username, password: passwordValue });
      setUser(result.user);
      setAutoLockMinutes(result.user.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES);
      await api.csrf();
      await refreshFiles();
      form.reset();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Login failed.') });
    } finally {
      setBusy(null);
    }
  }

  /** Locks the vault, clears local session state, and ends the server session. */
  async function handleLogout() {
    lockVault(false);
    setMessage(null);
    setSelectedId(null);
    setFiles([]);
    setUser(null);
    try {
      await api.logout();
    } catch {
      /* session may already be gone */
    }
  }

  /**
   * Validates the confirmation and submits the login password change.
   * @param event - The submission event from the login password change form.
   */
  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get('currentPassword') ?? '');
    const newPassword = String(data.get('newPassword') ?? '');
    const confirmPassword = String(data.get('confirmPassword') ?? '');
    if (newPassword !== confirmPassword) {
      setProfileMessage({ kind: 'error', text: 'New passwords do not match.' });
      return;
    }
    setBusy('password');
    setProfileMessage(null);
    try {
      await api.changePassword({ currentPassword, newPassword });
      form.reset();
      setProfileMessage({ kind: 'notice', text: 'Password changed.' });
    } catch (error) {
      setProfileMessage({ kind: 'error', text: errorText(error, 'Unable to change password.') });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Saves the contact address entered in the profile.
   * @param event - The submission event from the contact email form.
   */
  async function handleSaveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    setBusy('email');
    setProfileMessage(null);
    try {
      setUser(await api.updateEmail(email));
      setProfileMessage({ kind: 'notice', text: 'Email address saved.' });
    } catch (error) {
      setProfileMessage({ kind: 'error', text: errorText(error, 'Unable to save email address.') });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Validates and saves the user's auto-lock delay.
   * @param event - The submission event from the auto-lock preference form.
   */
  async function handleSaveAutoLock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const minutes = Number(data.get('autoLockMinutes'));
    const clipboardSeconds = Number(data.get('clipboardClearSeconds'));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setProfileMessage({ kind: 'error', text: 'Auto-lock must be between 1 and 1440 minutes.' });
      return;
    }
    if (!Number.isFinite(clipboardSeconds) || clipboardSeconds < 0 || clipboardSeconds > 600) {
      setProfileMessage({ kind: 'error', text: 'Clipboard clearing must be between 0 (off) and 600 seconds.' });
      return;
    }
    setBusy('settings');
    setProfileMessage(null);
    try {
      const updated = await api.updateSettings({
        autoLockMinutes: Math.round(minutes),
        clipboardClearSeconds: Math.round(clipboardSeconds),
        showFavicons: data.get('showFavicons') === 'on',
        checkBreaches: data.get('checkBreaches') === 'on'
      });
      setUser(updated);
      setAutoLockMinutes(updated.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES);
      setProfileMessage({ kind: 'notice', text: 'Settings saved.' });
    } catch (error) {
      setProfileMessage({ kind: 'error', text: errorText(error, 'Unable to save settings.') });
    } finally {
      setBusy(null);
    }
  }

  /** Checks for an existing vault session on mount. */
  useEffect(() => {
    let cancelled = false;
    (/** Restores the signed-in account, CSRF token, and file inventory. */ async () => {
      try {
        const me = await api.me();
        await api.csrf();
        if (cancelled) return;
        setUser(me);
        setAutoLockMinutes(me.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES);
        await refreshFiles();
      } catch (error) {
        if (!cancelled && !(error instanceof ApiError && error.status === 401)) {
          setMessage({ kind: 'error', text: errorText(error, 'Unable to restore session.') });
        }
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return /** Marks session initialization as obsolete when the component unmounts. */ () => {
      cancelled = true;
    };
  }, []);

  /** Schedules auto-lock while the open vault's browser tab is hidden. */
  useEffect(() => {
    if (!db) return;
    let lockTimer: number | undefined;
    /** Clears credentials and unlocked data when the auto-lock timer expires. */
    const lock = () => {
      vaultGeneration.current += 1;
      clearVaultCredentials(db);
      resetFolderState();
      setDb(null);
      setEntries([]);
      setSelectedEntry(null);
      setEdits(null);
      setTotp(null);
      setPassword('');
      setKeyFile(null);
    };
    /** Starts the lock timer on tab hide and cancels it on return. */
    const onVisibility = () => {
      if (document.hidden) {
        lockTimer = window.setTimeout(lock, autoLockMinutes * 60 * 1000);
      } else if (lockTimer !== undefined) {
        window.clearTimeout(lockTimer);
        lockTimer = undefined;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return /** Removes the visibility listener and cancels any pending auto-lock. */ () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (lockTimer !== undefined) window.clearTimeout(lockTimer);
    };
  }, [db, autoLockMinutes, resetFolderState]);

  /**
   * Overwrites a copied value in the clipboard. Browsers only allow this while the tab has focus; otherwise the value
   * stays, which the settings explain.
   */
  function clearClipboard() {
    clipboardTimer.current = undefined;
    void navigator.clipboard.writeText('').catch(/** Ignores a refused write while the tab is in the background. */ () => undefined);
  }

  /**
   * Copies a single entry value without showing it in feedback.
   * @param value - The current draft field text or generated TOTP code to copy.
   * @param label - The field name to use in the clipboard status message.
   */
  async function copyValue(value: string, label: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setMessage({ kind: 'error', text: 'Clipboard unavailable. Use HTTPS or localhost and allow clipboard access.' });
      return false;
    }
    const seconds = user?.clipboardClearSeconds ?? DEFAULT_CLIPBOARD_CLEAR_SECONDS;
    window.clearTimeout(clipboardTimer.current);
    clipboardTimer.current = seconds > 0 ? window.setTimeout(clearClipboard, seconds * 1000) : undefined;
    setMessage({ kind: 'notice', text: seconds > 0 ? `${label} copied. The clipboard is cleared in ${seconds} seconds.` : `${label} copied.` });
    return true;
  }

  const themeAction = (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      onClick={/** Switches and stores the preferred color theme. */ () => setTheme(toggleTheme())}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </Button>
  );

  if (!authChecked || !user) {
    return (
      <AuthLayout area="Vault" themeAction={themeAction}>
        {!authChecked ? (
          <p role="status" className="text-sm text-muted-foreground">
            Restoring secure session…
          </p>
        ) : (
          <form className="grid gap-5" onSubmit={handleLogin}>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Sign in to access the KeePass vaults shared with you.
              </p>
            </div>
            {!hasBrowserCrypto() && <InsecureContextAlert action="Unlocking vaults" />}
            {message?.kind === 'error' && (
              <Alert variant="destructive">
                <AlertDescription>{message.text}</AlertDescription>
              </Alert>
            )}
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="username">Username</FieldLabel>
                <Input id="username" name="username" autoComplete="username" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input id="password" name="password" type="password" autoComplete="current-password" required />
              </Field>
            </FieldGroup>
            <Button type="submit" disabled={busy === 'login'}>
              {busy === 'login' ? 'Signing in…' : 'Sign in'}
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              First run? Ask your administrator to set up KeePort and create your account.
            </p>
          </form>
        )}
      </AuthLayout>
    );
  }

  return (
    <SidebarProvider>
      <VaultNavigation
        files={files}
        selectedId={selectedId}
        openId={unlocked ? selectedId : null}
        disabled={busy === 'unlock' || busy === 'save' || busy === 'reload'}
        onSelect={selectFile}
        folderTree={unlocked && selectedFile ? (
          <FolderTree
            vaultName={selectedFile.name}
            folders={folders}
            totalEntries={visibleCount}
            selectedId={expiredView || tagView || securityView ? null : folderId}
            allSelected={!expiredView && !tagView && !securityView && folderId === null}
            expiredCount={expiredCount}
            expiredSelected={expiredView}
            onSelectExpired={/** Shows the expired entries of all folders. */ () => {
              setFolderId(null);
              setExpiredView(true);
              setTagView(null);
              setSecurityView(false);
              setSelection(new Set());
            }}
            securityCount={report.affected.size}
            securitySelected={securityView}
            onSelectSecurity={/** Shows the security report. */ () => {
              setFolderId(null);
              setExpiredView(false);
              setTagView(null);
              setSecurityView(true);
              setSecurityIssue(null);
              setSelection(new Set());
              void runBreachCheck();
            }}
            tags={vaultTags}
            selectedTag={tagView}
            onSelectTag={showTag}
            canWrite={canWrite}
            disabled={busy !== null}
            {...folderActions}
          />
        ) : null}
        user={user}
        profile={
          <Dialog
            open={showProfile}
            onOpenChange={/**
             * Tracks profile visibility and clears old messages on reopening.
             * @param open - The requested profile dialog state.
             */ (open) => {
              setShowProfile(open);
              if (open) setProfileMessage(null);
            }}
          >
            <DialogTrigger asChild>
              <SidebarMenuButton type="button" variant="outline">
                <UserRoundIcon />
                <span>Profile</span>
              </SidebarMenuButton>
            </DialogTrigger>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Account settings</DialogTitle>
                <DialogDescription>
                  Manage contact, vault and sign-in settings for {user.username}.
                </DialogDescription>
              </DialogHeader>
              {profileMessage && (
                <Alert variant={profileMessage.kind === 'error' ? 'destructive' : 'default'}>
                  <AlertDescription>{profileMessage.text}</AlertDescription>
                </Alert>
              )}
              <form className="grid gap-4" onSubmit={handleSaveEmail}>
                <h3 className="text-sm font-semibold">Contact information</h3>
                <Field>
                  <FieldLabel htmlFor="profile-email">Email address</FieldLabel>
                  <Input
                    key={user.email}
                    id="profile-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    defaultValue={user.email ?? ''}
                    required
                  />
                </Field>
                <Button type="submit" size="sm" className="justify-self-start" disabled={busy !== null}>
                  {busy === 'email' ? 'Saving…' : 'Save email address'}
                </Button>
              </form>
              <Separator />
              <form className="grid gap-4" onSubmit={handleSaveAutoLock}>
                <h3 className="text-sm font-semibold">Vault preferences</h3>
                <Field>
                  <FieldLabel htmlFor="auto-lock">Auto-lock delay (minutes)</FieldLabel>
                  <Input
                    id="auto-lock"
                    name="autoLockMinutes"
                    className="max-w-32"
                    type="number"
                    min={1}
                    max={1440}
                    defaultValue={autoLockMinutes}
                    required
                    aria-describedby="auto-lock-help"
                  />
                  <FieldDescription id="auto-lock-help">
                    How long to keep the vault unlocked after you leave this tab.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="clipboard-clear">Clear clipboard after (seconds)</FieldLabel>
                  <Input
                    id="clipboard-clear"
                    name="clipboardClearSeconds"
                    className="max-w-32"
                    type="number"
                    min={0}
                    max={600}
                    defaultValue={user.clipboardClearSeconds ?? DEFAULT_CLIPBOARD_CLEAR_SECONDS}
                    required
                    aria-describedby="clipboard-clear-help"
                  />
                  <FieldDescription id="clipboard-clear-help">
                    Copied passwords and codes are removed from the clipboard after this time; 0 turns it off. Browsers
                    only allow this while the KeePort tab is in front, so clear it yourself if you switch away.
                  </FieldDescription>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox id="show-favicons" name="showFavicons" defaultChecked={user.showFavicons} aria-describedby="show-favicons-help" />
                  <div className="grid gap-1">
                    <FieldLabel htmlFor="show-favicons" className="font-normal">Load website icons</FieldLabel>
                    <FieldDescription id="show-favicons-help">
                      Shows the favicon of each entry's website. Your browser requests it directly from that site, so
                      the site sees your IP address and may conclude that you have an account there. Icons stored in
                      the vault (e.g. by KeePassXC) are always shown.
                    </FieldDescription>
                  </div>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox id="check-breaches" name="checkBreaches" defaultChecked={user.checkBreaches} aria-describedby="check-breaches-help" />
                  <div className="grid gap-1">
                    <FieldLabel htmlFor="check-breaches" className="font-normal">Check passwords against Have I Been Pwned</FieldLabel>
                    <FieldDescription id="check-breaches-help">
                      The security report then shows passwords that appear in known data breaches. Your browser sends
                      only the first 5 characters of each password's SHA-1 hash to api.pwnedpasswords.com and compares
                      the rest locally; the password itself never leaves this browser. The service sees your IP address.
                    </FieldDescription>
                  </div>
                </Field>
                <Button type="submit" size="sm" className="justify-self-start" disabled={busy !== null}>
                  {busy === 'settings' ? 'Saving…' : 'Save preferences'}
                </Button>
              </form>
              <Separator />
              <form className="grid gap-4" onSubmit={handleChangePassword}>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">Change account password</h3>
                  <p className="text-sm text-muted-foreground">This does not change your vault master password.</p>
                </div>
                <FieldGroup className="gap-3">
                  <Field>
                    <FieldLabel htmlFor="current-password">Current password</FieldLabel>
                    <Input
                      id="current-password"
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="new-password">New password</FieldLabel>
                    <Input id="new-password" name="newPassword" type="password" autoComplete="new-password" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
                    <Input
                      id="confirm-password"
                      name="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      required
                    />
                  </Field>
                </FieldGroup>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  disabled={busy !== null}
                >
                  {busy === 'password' ? 'Changing…' : 'Change password'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <SidebarTrigger />
          <Separator orientation="vertical" className="data-vertical:h-4 data-vertical:self-center" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">Vault workspace</span>
          {themeAction}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            title="Sign out"
            disabled={busy !== null}
            onClick={handleLogout}
          >
            <LogOutIcon />
          </Button>
        </header>

        <div className="mx-auto grid w-full max-w-7xl gap-6 p-4 sm:p-6 lg:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <div className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
                {selectedFile ? 'Vault file' : 'Workspace'}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight wrap-break-word sm:text-3xl">
                {selectedFile?.name ?? 'Your vaults'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {selectedFile
                  ? 'Manage the entries in this KeePass file.'
                  : 'Open a shared KeePass file to view its entries.'}
              </p>
            </div>
            {selectedFile && (
              <Badge variant="outline" className={unlocked ? (canWrite ? ACCENTS.emerald.badge : ACCENTS.amber.badge) : undefined}>
                {unlocked ? (
                  <>
                    <ShieldCheckIcon /> {canWrite ? 'Read-write' : 'Read-only'}
                  </>
                ) : (
                  <>
                    <LockKeyholeIcon /> Locked
                  </>
                )}
              </Badge>
            )}
          </div>
          {message && !edits && (
            <Alert
              variant={message.kind === 'error' ? 'destructive' : 'default'}
              className={message.kind === 'error' ? undefined : 'border-primary/25 bg-accent text-accent-foreground'}
            >
              {message.kind === 'error' ? <TriangleAlertIcon /> : <InfoIcon />}
              <AlertDescription className={message.kind === 'error' ? undefined : 'text-accent-foreground'}>{message.text}</AlertDescription>
            </Alert>
          )}

          {!selectedFile ? (
            <Card className="min-h-64 justify-center text-center">
              <CardHeader className="justify-items-center gap-2">
                <div className="mb-2 grid size-11 place-items-center rounded-lg border bg-muted">
                  <DatabaseIcon className="size-5 text-muted-foreground" />
                </div>
                <CardTitle>{files.length ? 'Select a vault file' : 'No shared vaults yet'}</CardTitle>
                <CardDescription>
                  {files.length
                    ? 'Choose a vault from the sidebar to unlock it.'
                    : 'Vaults appear here after an administrator grants you access.'}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : !unlocked ? (
            <Card key={selectedFile.id} className="w-full max-w-lg">
              <CardHeader>
                <CardTitle>Unlock vault</CardTitle>
                <CardDescription>
                  Use the master password, a key file or both. They stay in this browser.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!hasBrowserCrypto() && (
                  <div className="mb-5">
                    <InsecureContextAlert action="Unlocking a vault" />
                  </div>
                )}
                <form className="grid gap-5" onSubmit={handleUnlock}>
                  <FieldGroup className="gap-4">
                    <Field>
                      <FieldLabel htmlFor="master-password">Master password</FieldLabel>
                      <Input
                        id="master-password"
                        type="password"
                        autoComplete="off"
                        value={password}
                        onChange={/**
                         * Updates the master password draft for unlocking the selected vault.
                         * @param event - The master password input change event.
                         */ (event) => setPassword(event.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="key-file">Key file</FieldLabel>
                      <Input
                        id="key-file"
                        type="file"
                        onChange={/**
                         * Stores the optional key file selected for local unlocking.
                         * @param event - The file input event containing the optional key file.
                         */ (event) => setKeyFile(event.target.files?.[0] ?? null)}
                      />
                    </Field>
                  </FieldGroup>
                  <Button type="submit" className="justify-self-start" disabled={busy !== null || !hasBrowserCrypto()}>
                    <LockKeyholeOpenIcon />
                    {busy === 'unlock' ? 'Unlocking…' : 'Unlock vault'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <Card size="sm">
                  <CardHeader>
                    <StatLabel icon={<KeyRoundIcon />} accent={ACCENTS.sky}>Entries</StatLabel>
                    <CardTitle className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{visibleCount}</CardTitle>
                  </CardHeader>
                </Card>
                <Card size="sm">
                  <CardHeader>
                    <StatLabel icon={<HardDriveIcon />} accent={ACCENTS.violet}>Vault size</StatLabel>
                    <CardTitle className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{formatBytes(selectedFile.size)}</CardTitle>
                  </CardHeader>
                </Card>
                <Card size="sm" className="col-span-2 lg:col-span-1">
                  <CardHeader>
                    <StatLabel icon={<ClockIcon />} accent={ACCENTS.amber}>Last updated</StatLabel>
                    <CardTitle className="mt-1 text-base font-semibold">{formatDate(selectedFile.updatedAt)}</CardTitle>
                    <CardDescription>Revision {selectedFile.revision}</CardDescription>
                  </CardHeader>
                </Card>
              </div>
              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="gap-4 border-b py-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="wrap-break-word">{securityView ? 'Security report' : tagView ? `Tag: ${tagView}` : expiredView ? 'Expired entries' : currentFolder ? currentFolder.name : 'All entries'}</CardTitle>
                      <CardDescription className="wrap-break-word">
                        {securityView
                          ? 'Checked in this browser only; nothing is sent or stored. Select a check to see its entries.'
                          : tagView
                          ? 'Entries with this tag in all folders'
                          : expiredView
                          ? `${expiredCount} ${expiredCount === 1 ? 'entry has' : 'entries have'} passed their expiry date`
                          : currentFolder
                          ? `${currentFolder.path} · ${currentFolder.entryCount} ${currentFolder.entryCount === 1 ? 'entry' : 'entries'}`
                          : `${visibleCount} ${visibleCount === 1 ? 'entry' : 'entries'} in all folders, without templates and recycle bin`}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        title="Load the latest version from the server, e.g. after a KeePass app synced"
                        onClick={/** Reloads the open vault from the server. */ () => void handleReload()}
                      >
                        <RefreshCwIcon className={busy === 'reload' ? 'animate-spin' : undefined} />
                        {busy === 'reload' ? 'Reloading…' : 'Reload'}
                      </Button>
                      {canWrite && currentFolder?.isRecycleBin && currentFolder.totalEntryCount > 0 && (
                        <Button variant="outline" size="sm" disabled={busy !== null} onClick={/** Asks to empty the recycle bin. */ () => setConfirmEmptyBin(true)}>
                          <Trash2Icon /> Empty recycle bin
                        </Button>
                      )}
                      <Button variant="outline" size="sm" disabled={busy === 'save' || busy === 'reload'} onClick={/** Locks the vault and notifies the user. */ () => lockVault(true)}>
                        <LockKeyholeIcon /> Lock vault
                      </Button>
                      {canWrite && (
                        <div className="flex">
                          <Button
                            size="sm"
                            className={templates.length ? 'rounded-e-none' : undefined}
                            disabled={busy === 'save' || busy === 'reload'}
                            onClick={/** Opens an empty entry draft. */ () => startNewEntry()}
                          >
                            <PlusIcon /> Add entry
                          </Button>
                          {templates.length > 0 && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="sm"
                                  className="rounded-s-none border-s border-s-primary-foreground/25 px-2"
                                  aria-label="Add entry from a template"
                                  disabled={busy === 'save' || busy === 'reload'}
                                >
                                  <ChevronDownIcon />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel>New entry from template</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {templates.map(/**
                                 * Renders one template as a menu item.
                                 * @param template - A template of the vault.
                                 */ (template) => (
                                  <DropdownMenuItem key={template.id} onSelect={/** Opens a draft from this template. */ () => startNewEntry(template)}>
                                    {template.title}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {securityView && (
                  <SecurityReportTiles
                    report={report}
                    breach={{ ...breach, enabled: user.checkBreaches }}
                    onCheckBreaches={/** Checks all passwords again. */ () => void runBreachCheck(true)}
                    onOpenSettings={/** Opens the account settings. */ () => setShowProfile(true)}
                    active={securityIssue}
                    onSelect={/**
                     * Filters the list by a check.
                     * @param issue - The check, or null for all findings.
                     */ (issue) => {
                      setSecurityIssue(issue);
                      setSelection(new Set());
                    }}
                  />
                )}
                <DataTable
                  key={`${selectedFile.id}:${securityView ? `security:${securityIssue ?? 'all'}` : tagView ? `tag:${tagView}` : expiredView ? 'expired' : folderId ?? 'all'}`}
                  label={securityView ? 'Entries with security findings' : tagView ? `Entries tagged ${tagView}` : expiredView ? 'Expired entries' : currentFolder ? `Entries in ${currentFolder.name}` : 'Vault entries'}
                  rows={tableEntries}
                  columns={visibleColumns}
                  searchActions={
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm">
                          <Columns3Icon /> Columns
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {OPTIONAL_COLUMNS.map(/**
                         * Renders the toggle of one column.
                         * @param column - One optional column.
                         */ (column) => (
                          <DropdownMenuCheckboxItem
                            key={column}
                            checked={!hiddenColumns.has(column)}
                            onSelect={/**
                             * Keeps the menu open so several columns can be changed.
                             * @param event - The select event.
                             */ (event) => event.preventDefault()}
                            onCheckedChange={/**
                             * Shows or hides the column and remembers the choice in this browser.
                             * @param checked - Whether the column is shown.
                             */ (checked) => toggleColumn(column, checked === true)}
                          >
                            {ENTRY_COLUMNS.find(/**
                             * Finds the column label.
                             * @param item - One column.
                             */ (item) => item.id === column)?.label}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  }
                  searchLabel="Search all folders"
                  matches={entryMatches}
                  emptyMessage={securityView ? 'No findings. Well done!' : tagView ? 'No entry has this tag.' : expiredView ? 'No entry has expired.' : currentFolder ? 'This folder has no entries.' : 'This vault has no entries yet.'}
                  browseFilter={browseFilter}
                  leadingHeader={canWrite ? renderSelectAll : undefined}
                  toolbar={canWrite ? renderSelectionBar : undefined}
                  renderRow={/**
                   * Renders entry metadata with an action to open its details.
                   * @param entry - The unlocked entry to display in the table and open from the row.
                   */ (entry) => (
                    <TableRow
                      key={entry.id}
                      data-state={selection.has(entry.id) ? 'selected' : undefined}
                      aria-current={focusedId === entry.id ? 'true' : undefined}
                      title="Double-click to open"
                      className={cn('cursor-default', focusedId === entry.id && 'bg-accent/60 hover:bg-accent/60')}
                      onClick={/**
                       * Marks the row, unless a button, link or checkbox in it was clicked.
                       * @param event - The click event.
                       */ (event) => {
                        if (!isInteractive(event.target)) setFocusedId(entry.id);
                      }}
                      onDoubleClick={/**
                       * Opens the entry, unless a button, link or checkbox in the row was double-clicked.
                       * @param event - The double-click event.
                       */ (event) => {
                        if (!isInteractive(event.target)) openEntry(entry);
                      }}
                    >
                      {canWrite && (
                        <TableCell className="w-10 ps-6 pe-0">
                          <Checkbox
                            aria-label={`Select ${entry.title}`}
                            checked={selection.has(entry.id)}
                            disabled={busy !== null}
                            onCheckedChange={/**
                             * Adds the entry to or removes it from the selection.
                             * @param checked - The new checkbox state.
                             */ (checked) => setSelected([entry.id], checked === true)}
                          />
                        </TableCell>
                      )}
                      <TableCell className={canWrite ? 'py-2 ps-1' : 'py-2 ps-3'}>
                        <Button
                          variant="ghost"
                          className="group/title h-auto max-w-44 items-start gap-2 px-3 py-1.5 text-start sm:max-w-72"
                          title={`Open ${entry.title}`}
                          onClick={/** Opens the entry. */ () => openEntry(entry)}
                        >
                          <EntryIcon iconUrl={entry.iconUrl} url={entry.url} showFavicons={showFavicons} title={entry.title} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-primary underline-offset-4 group-hover/title:underline group-focus-visible/title:underline">{entry.title}</span>
                            <span className="flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground">
                              {entry.expired && (
                                <Badge variant="destructive" className="h-4 shrink-0 px-1.5 text-[0.65rem]">Expired</Badge>
                              )}
                              {(entry.template || entry.isTemplate) && (
                                <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[0.65rem]">
                                  {entry.isTemplate ? 'Template' : entry.template?.title}
                                </Badge>
                              )}
                              <span className="truncate">{entry.groupPath}</span>
                            </span>
                          </span>
                        </Button>
                        {entry.tags.length > 0 && (
                          <span className="flex max-w-44 flex-wrap gap-1 ps-13 pb-1 sm:max-w-72">
                            {entry.tags.slice(0, 3).map(/**
                             * Renders one tag as a filter button.
                             * @param tag - One tag of the entry.
                             */ (tag) => (
                              <Badge key={tag} asChild variant="outline" className={cn('h-4 px-1.5 text-[0.65rem]', accentFor(tag).badge)}>
                                <button type="button" title={`Show entries tagged ${tag}`} onClick={/** Filters the list by this tag. */ () => showTag(tag)}>
                                  {tag}
                                </button>
                              </Badge>
                            ))}
                            {entry.tags.length > 3 && (
                              <span className="text-[0.65rem] text-muted-foreground" title={entry.tags.slice(3).join(', ')}>+{entry.tags.length - 3}</span>
                            )}
                          </span>
                        )}
                      </TableCell>
                      {showColumn('username') && (
                        <TableCell className="text-muted-foreground">
                          <span className="flex max-w-36 min-w-0 items-center gap-1 sm:max-w-56">
                            {entry.username && (
                              <CopyButton
                                label={`Copy username of ${entry.title}`}
                                tooltip="Copy username"
                                getValue={/** Returns the username. */ () => entry.username}
                                onCopy={/**
                                 * Copies the username.
                                 * @param value - The username.
                                 */ (value) => copyValue(value, 'Username')}
                              />
                            )}
                            <span className="truncate">{entry.username || '—'}</span>
                          </span>
                        </TableCell>
                      )}
                      {showColumn('password') && (
                        <TableCell className="hidden text-muted-foreground sm:table-cell">
                          <span className="flex items-center gap-1">
                            {entry.password && (
                              <CopyButton
                                label={`Copy password of ${entry.title}`}
                                tooltip="Copy password"
                                getValue={/** Returns the password. */ () => entry.password}
                                onCopy={/**
                                 * Copies the password.
                                 * @param value - The password.
                                 */ (value) => copyValue(value, 'Password')}
                              />
                            )}
                            <span className="font-mono tracking-wider">{entry.password ? '••••••••' : '—'}</span>
                            {passwordWarning(entry) && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span tabIndex={0} aria-label={passwordWarning(entry) ?? undefined} className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    <TriangleAlertIcon className="size-4 text-amber-600 dark:text-amber-400" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>{passwordWarning(entry)}</TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        </TableCell>
                      )}
                      {showColumn('totp') && (
                        <TableCell className="hidden sm:table-cell">
                          <span className="flex items-center gap-1">
                            {entry.otp && parseOtpSecret(entry.otp) && (
                              <CopyButton
                                label={`Copy TOTP code of ${entry.title}`}
                                tooltip="Copy TOTP code"
                                getValue={/** Calculates the current TOTP code at the moment of copying. */ async () => {
                                  const config = parseOtpSecret(entry.otp);
                                  if (!config) throw new Error('The TOTP setting of this entry is not valid.');
                                  return (await totpCode(config)).code;
                                }}
                                onCopy={/**
                                 * Copies the TOTP code.
                                 * @param value - The current code.
                                 */ (value) => copyValue(value, 'TOTP code')}
                              />
                            )}
                            {entry.otp ? (
                              <CircleCheckIcon aria-label="TOTP configured" className="size-4 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <CircleXIcon aria-label="No TOTP" className="size-4 text-muted-foreground/60" />
                            )}
                          </span>
                        </TableCell>
                      )}
                      {showColumn('modified') && (
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                          <span title={entry.modified ? entry.modified.toLocaleString() : undefined}>{formatRelative(entry.modified, renderedAt)}</span>
                        </TableCell>
                      )}
                      {showColumn('website') && (
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          <span className="flex max-w-56 min-w-0 items-center gap-1">
                            {openableUrl(entry.url) && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button asChild variant="ghost" size="icon-sm" className="size-7 shrink-0 text-muted-foreground hover:text-foreground">
                                    <a
                                      href={openableUrl(entry.url) ?? undefined}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      aria-label={`Open website of ${entry.title}`}
                                    >
                                      <ExternalLinkIcon />
                                    </a>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Open website</TooltipContent>
                              </Tooltip>
                            )}
                            <span className="truncate">{entry.url || '—'}</span>
                          </span>
                        </TableCell>
                      )}
                    </TableRow>
                  )}
                />
              </Card>

              <Sheet
                open={edits !== null}
                onOpenChange={/**
                 * Discards the entry draft when the sheet closes outside a save.
                 * @param open - The requested entry sheet visibility.
                 */ (open) => {
                  if (!open && busy !== 'save') {
                    setSelectedEntry(null);
                    setEdits(null);
                  }
                }}
              >
                {edits && (
                  <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
                    <SheetHeader className="border-b p-6 pe-12">
                      <SheetTitle className="flex items-center gap-2 wrap-break-word">
                        {selectedEntry && <EntryIcon iconUrl={selectedEntry.iconUrl} url={selectedEntry.url} showFavicons={showFavicons} className="size-5" />}
                        {selectedEntry ? selectedEntry.title : draftTemplate ? `New ${draftTemplate.title}` : 'New entry'}
                      </SheetTitle>
                      <SheetDescription>
                        {editingTemplate
                          ? 'This is a template for new entries. Edit templates in KeePass2Android.'
                          : canWrite
                            ? 'Changes are encrypted in your browser before saving.'
                            : 'You can view and copy this entry, but you cannot edit it.'}
                      </SheetDescription>
                      {selectedEntry && (
                        <p className="text-xs text-muted-foreground">
                          Created {selectedEntry.created ? selectedEntry.created.toLocaleString() : 'unknown'} · Modified{' '}
                          {selectedEntry.modified ? selectedEntry.modified.toLocaleString() : 'unknown'}
                        </p>
                      )}
                    </SheetHeader>
                    <Tabs
                      value={selectedEntry ? sheetTab : 'details'}
                      onValueChange={/**
                       * Switches between the entry details and its history.
                       * @param value - The chosen tab.
                       */ (value) => setSheetTab(value === 'history' ? 'history' : 'details')}
                      className="gap-0"
                    >
                    {message && (
                      <Alert variant={message.kind === 'error' ? 'destructive' : 'default'} className="mx-6 mt-4 w-auto">
                        <AlertDescription>{message.text}</AlertDescription>
                      </Alert>
                    )}
                    {selectedEntry && (
                      <TabsList className="mx-6 mt-4">
                        <TabsTrigger value="details">Details</TabsTrigger>
                        <TabsTrigger value="history">History ({selectedEntry.entry.history.length})</TabsTrigger>
                      </TabsList>
                    )}
                    <TabsContent value="details">
                    <form className="grid gap-5 p-6" onSubmit={handleSave}>
                      <FieldGroup className="gap-4">
                        <Field>
                          <FieldLabel htmlFor="entry-title">Title</FieldLabel>
                          <Input
                            id="entry-title"
                            value={edits.title}
                            readOnly={!canEditEntry || busy === 'save'}
                            onChange={/**
                             * Updates the draft entry title.
                             * @param event - The entry title input change event.
                             */ (event) => setEdits({ ...edits, title: event.target.value })}
                          />
                        </Field>
                        {showStandard('UserName', edits.username) && (
                          <Field>
                            <FieldLabel htmlFor="entry-username">Username</FieldLabel>
                            <Input
                              id="entry-username"
                              value={edits.username}
                              readOnly={!canEditEntry || busy === 'save'}
                              onChange={/**
                               * Updates the draft entry username.
                               * @param event - The entry username input change event.
                               */ (event) => setEdits({ ...edits, username: event.target.value })}
                            />
                          </Field>
                        )}
                        {showStandard('Password', edits.password) && (
                          <Field>
                            <FieldLabel htmlFor="entry-password">Password</FieldLabel>
                            <div className="flex gap-2">
                              <Input
                                id="entry-password"
                                type={showPassword ? 'text' : 'password'}
                                autoComplete="off"
                                className="font-mono"
                                value={edits.password}
                                readOnly={!canEditEntry || busy === 'save'}
                                onChange={/**
                                 * Updates the draft entry password.
                                 * @param event - The entry password input change event.
                                 */ (event) => setEdits({ ...edits, password: event.target.value })}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                title={showPassword ? 'Hide password' : 'Show password'}
                                onClick={/** Shows or hides the password. */ () => setShowPassword(!showPassword)}
                              >
                                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                              </Button>
                              {canEditEntry && (
                                <PasswordGenerator
                                  disabled={busy === 'save'}
                                  onUse={/**
                                   * Puts the generated password into the draft and shows it once.
                                   * @param password - The generated password.
                                   */ (password) => {
                                    setEdits({ ...edits, password });
                                    setShowPassword(true);
                                  }}
                                />
                              )}
                            </div>
                          </Field>
                        )}
                        {showStandard('URL', edits.url) && (
                          <Field>
                            <FieldLabel htmlFor="entry-url">Website</FieldLabel>
                            <div className="flex gap-2">
                              <Input
                                id="entry-url"
                                value={edits.url}
                                readOnly={!canEditEntry || busy === 'save'}
                                onChange={/**
                                 * Updates the draft website URL.
                                 * @param event - The website URL input change event.
                                 */ (event) => setEdits({ ...edits, url: event.target.value })}
                              />
                              {showFavicons && canEditEntry && selectedEntry && faviconUrl(edits.url) && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      aria-label="Save website icon"
                                      disabled={busy !== null}
                                      onClick={/** Downloads the website icon and stores it in the vault. */ () => void saveWebsiteIcon()}
                                    >
                                      <ImageDownIcon className={busy === 'icon' ? 'animate-pulse' : undefined} />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-64">
                                    Save website icon: KeePort fetches it from {new URL(faviconUrl(edits.url) ?? 'https://example.com').hostname} once and stores it in the vault. The KeePort server sees the host name for this.
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              {openableUrl(edits.url) && (
                                <Button asChild variant="outline" size="icon">
                                  <a href={openableUrl(edits.url) ?? undefined} target="_blank" rel="noopener noreferrer" aria-label="Open website" title="Open website">
                                    <ExternalLinkIcon />
                                  </a>
                                </Button>
                              )}
                            </div>
                          </Field>
                        )}
                        {showStandard('Notes', edits.notes) && (
                          <Field>
                            <FieldLabel htmlFor="entry-notes">Notes</FieldLabel>
                            <Textarea
                              id="entry-notes"
                              value={edits.notes}
                              readOnly={!canEditEntry || busy === 'save'}
                              onChange={/**
                               * Updates the draft notes.
                               * @param event - The entry notes input change event.
                               */ (event) => setEdits({ ...edits, notes: event.target.value })}
                            />
                          </Field>
                        )}
                        <Field>
                          <FieldLabel htmlFor="entry-tags">Tags</FieldLabel>
                          <TagInput
                            id="entry-tags"
                            tags={edits.tags ?? []}
                            suggestions={vaultTags.map(/**
                             * Selects the tag name.
                             * @param item - One tag of the vault.
                             */ (item) => item.tag)}
                            canWrite={canEditEntry && busy !== 'save'}
                            onChange={/**
                             * Updates the tags in the draft.
                             * @param tags - The new list of tags.
                             */ (tags) => setEdits({ ...edits, tags })}
                          />
                        </Field>
                        {showStandard('otp', edits.otp) && (
                          <Field>
                            <FieldLabel htmlFor="entry-otp">TOTP secret</FieldLabel>
                            <Input
                              id="entry-otp"
                              type="password"
                              autoComplete="off"
                              value={edits.otp}
                              readOnly={!canEditEntry || busy === 'save'}
                              onChange={/**
                               * Updates the draft TOTP secret or provisioning URI.
                               * @param event - The TOTP field change event containing a secret or provisioning URI.
                               */ (event) => setEdits({ ...edits, otp: event.target.value })}
                              aria-describedby="otp-help"
                            />
                            <FieldDescription id="otp-help">Use an otpauth URI or a Base32 secret. A Base32 secret is saved as an otpauth URI so KeePass apps such as KeePass2Android and KeePassXC show it as TOTP.</FieldDescription>
                          </Field>
                        )}
                      </FieldGroup>
                      {totp && (
                        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3">
                          <span className="font-mono text-lg tracking-widest">{totp.code}</span>
                          <Badge variant="secondary">{totp.secondsLeft}s</Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            className="ms-auto"
                            type="button"
                            onClick={/** Copies the current TOTP code to the clipboard. */ () => void copyValue(totp.code, 'TOTP code')}
                          >
                            <CopyIcon /> Copy code
                          </Button>
                          {otpUri && (
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              title="Copy the provisioning URI, including the secret"
                              onClick={/** Copies the provisioning URI without displaying its secret. */ () => void copyValue(otpUri, 'TOTP URI')}
                            >
                              <CopyIcon /> Copy TOTP URI
                            </Button>
                          )}
                        </div>
                      )}
                      {draftTemplate && !showAllFields && STANDARD_INPUTS.some(/**
                       * Checks whether a standard field is hidden by the template.
                       * @param item - One standard input.
                       */ (item) => !showStandard(item.key, edits[item.draft])) && (
                        <Button type="button" variant="link" size="sm" className="justify-self-start px-0" onClick={/** Shows the standard fields the template hides. */ () => setShowAllFields(true)}>
                          Show all fields
                        </Button>
                      )}
                      <EntryFields
                        key={selectedEntry?.id ?? `new:${edits.templateId ?? ''}`}
                        fields={edits.customFields ?? []}
                        template={draftTemplate}
                        canWrite={canEditEntry}
                        disabled={busy === 'save'}
                        onChange={/**
                         * Updates the custom fields in the draft.
                         * @param customFields - The complete new list of custom fields.
                         */ (customFields) => setEdits({ ...edits, customFields })}
                        onCopy={/**
                         * Copies a custom field value.
                         * @param value - The value to copy.
                         * @param label - The field label for the status message.
                         */ (value, label) => void copyValue(value, label)}
                      />
                      <Field>
                        <FieldLabel htmlFor="entry-expires">Expires</FieldLabel>
                        <Input
                          id="entry-expires"
                          type="date"
                          className="max-w-48"
                          value={edits.expires ?? ''}
                          readOnly={!canEditEntry || busy === 'save'}
                          onChange={/**
                           * Updates the draft expiry date; an empty value means the entry does not expire.
                           * @param event - The date input change event.
                           */ (event) => setEdits({ ...edits, expires: event.target.value })}
                          aria-describedby="expires-help"
                        />
                        <FieldDescription id="expires-help">Optional. KeePass apps show the entry as expired after this date.</FieldDescription>
                      </Field>
                      <EntryAttachments
                        draft={edits.attachments}
                        canWrite={canEditEntry}
                        disabled={busy === 'save'}
                        onChange={/**
                         * Updates only the attachments in the open draft.
                         * @param attachments - The updated attachment list for the current entry.
                         */ (attachments) => {
                          setMessage(null);
                          setEdits({ ...edits, attachments });
                        }}
                        onError={/**
                         * Reports an attachment validation failure inside the entry editor.
                         * @param text - The reason the selected file could not be attached.
                         */ (text) => setMessage({ kind: 'error', text })}
                      />
                      <Separator />
                      <div className="flex flex-wrap gap-2">
                        {canEditEntry && (
                          <Button type="submit" disabled={busy === 'save'}>
                            {busy === 'save' ? 'Saving…' : selectedEntry ? 'Save entry' : 'Create entry'}
                          </Button>
                        )}
                        {canEditEntry && selectedEntry && (
                          <Button
                            type="button"
                            variant="destructive"
                            disabled={busy === 'save'}
                            onClick={/** Asks to delete the open entry. */ () => requestDelete([selectedEntry.id], true)}
                          >
                            <Trash2Icon /> Delete
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          disabled={!edits.username}
                          onClick={/** Copies the draft username to the clipboard. */ () => void copyValue(edits.username, 'Username')}
                        >
                          <CopyIcon /> Copy username
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          disabled={!edits.password}
                          onClick={/** Copies the draft password to the clipboard. */ () => void copyValue(edits.password, 'Password')}
                        >
                          <CopyIcon /> Copy password
                        </Button>
                      </div>
                    </form>
                    </TabsContent>
                    {selectedEntry && db && (
                      <TabsContent value="history" className="p-6">
                        <EntryHistory
                          key={`${selectedEntry.id}:${selectedEntry.entry.history.length}`}
                          entry={selectedEntry.entry}
                          maxVersions={db.meta.historyMaxItems}
                          canWrite={canEditEntry}
                          busy={busy === 'save'}
                          onRestore={/**
                           * Restores a version.
                           * @param index - The version's index in the history.
                           */ (index) => changeVersion('restore', index)}
                          onDelete={/**
                           * Deletes a version.
                           * @param index - The version's index in the history.
                           */ (index) => changeVersion('delete', index)}
                          onCopy={/**
                           * Copies a value of an old version.
                           * @param value - The value to copy.
                           * @param label - The field name for the status message.
                           */ (value, label) => void copyValue(value, label)}
                        />
                      </TabsContent>
                    )}
                    </Tabs>
                  </SheetContent>
                )}
              </Sheet>
              <FolderNameDialog
                request={folderRequest}
                busy={busy === 'save'}
                validate={validateFolderName}
                onSubmit={/**
                 * Saves the new or renamed folder.
                 * @param request - The folder being created or renamed.
                 * @param name - The validated name.
                 */ (request, name) => void submitFolderName(request, name)}
                onClose={/** Closes the folder name dialog. */ () => setFolderRequest(null)}
              />
              <DeleteFolderDialog
                folder={folderToDelete}
                busy={busy === 'save'}
                onConfirm={/**
                 * Deletes the confirmed folder.
                 * @param folder - The empty folder to delete.
                 */ (folder) => void confirmDeleteFolder(folder)}
                onClose={/** Closes the delete confirmation. */ () => setFolderToDelete(null)}
              />
              <MoveEntriesDialog
                open={moving}
                folders={folders}
                count={selection.size}
                sourceFolderIds={selectedFolderIds}
                busy={busy === 'save'}
                onMove={/**
                 * Moves the selection to the chosen folder.
                 * @param targetId - The destination folder.
                 */ (targetId) => void moveSelection(targetId)}
                onClose={/** Closes the move dialog. */ () => setMoving(false)}
              />
              <TagsDialog
                open={tagging}
                count={selection.size}
                vaultTags={vaultTags.map(/**
                 * Selects the tag name.
                 * @param item - One tag of the vault.
                 */ (item) => item.tag)}
                selectionTags={listTags(entries.filter(/**
                 * Keeps the selected entries.
                 * @param entry - One entry of the vault.
                 */ (entry) => selection.has(entry.id)))}
                busy={busy === 'save'}
                onApply={/**
                 * Applies the tag changes to the selection.
                 * @param add - Tags to add.
                 * @param remove - Tags to remove.
                 */ (add, remove) => void applySelectionTags(add, remove)}
                onClose={/** Closes the tags dialog. */ () => setTagging(false)}
              />
              <AlertDialog open={deleteRequest !== null} onOpenChange={/**
               * Closes the confirmation unless a save is running.
               * @param open - The requested dialog state.
               */ (open) => {
                if (!open && busy !== 'save') setDeleteRequest(null);
              }}>
                {deleteRequest && (
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {deleteRequest.permanent ? 'Delete permanently' : 'Move to recycle bin'}: {deleteRequest.ids.length} {deleteRequest.ids.length === 1 ? 'entry' : 'entries'}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {deleteRequest.permanent
                          ? 'The entries are removed for good. KeePass apps remove them too when they sync.'
                          : 'The entries move to the recycle bin, where you can restore them with “Move to…” or delete them permanently. Entries already in the recycle bin are deleted permanently.'}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={busy === 'save'}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        disabled={busy === 'save'}
                        onClick={/**
                         * Deletes the entries and keeps the dialog open until the save finishes.
                         * @param event - The click event, prevented so the dialog does not close early.
                         */ (event) => {
                          event.preventDefault();
                          void confirmDelete();
                        }}
                      >
                        {busy === 'save' ? 'Deleting…' : deleteRequest.permanent ? 'Delete permanently' : 'Move to recycle bin'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                )}
              </AlertDialog>
              <AlertDialog open={confirmEmptyBin} onOpenChange={/**
               * Closes the confirmation unless a save is running.
               * @param open - The requested dialog state.
               */ (open) => {
                if (!open && busy !== 'save') setConfirmEmptyBin(false);
              }}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Empty the recycle bin?</AlertDialogTitle>
                    <AlertDialogDescription>
                      All entries and folders in the recycle bin are deleted permanently. KeePass apps remove them too when they sync.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy === 'save'}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={busy === 'save'}
                      onClick={/**
                       * Empties the recycle bin and keeps the dialog open until the save finishes.
                       * @param event - The click event, prevented so the dialog does not close early.
                       */ (event) => {
                        event.preventDefault();
                        void confirmEmptyRecycleBin();
                      }}
                    >
                      {busy === 'save' ? 'Deleting…' : 'Empty recycle bin'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * Renders vault navigation, the open vault's folder tree and the signed-in account's profile action.
 * @param props - The available files, active and unlocked file IDs, disabled state, selection callback, folder tree, signed-in account, and profile control.
 */
function VaultNavigation({
  files,
  selectedId,
  openId,
  disabled,
  onSelect,
  folderTree,
  user,
  profile
}: {
  files: VaultFile[];
  selectedId: string | null;
  /** The vault that is currently unlocked; it is highlighted in green with an open lock. */
  openId: string | null;
  disabled: boolean;
  folderTree: ReactNode;
  onSelect: (file: VaultFile) => void;
  user: Pick<User, 'username' | 'email'>;
  profile: ReactNode;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar variant="inset">
      <SidebarHeader className="h-14 shrink-0 justify-center border-b px-5 py-0">
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-gradient text-white shadow-sm">
            <KeyRoundIcon className="size-4" />
          </span>
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              KeePort <VersionBadge />
            </p>
            <p className="text-xs text-muted-foreground">Personal vault</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Shared vaults</SidebarGroupLabel>
          {!files.length && <p className="px-2 py-1 text-sm text-muted-foreground">No files available.</p>}
          <SidebarMenu>
            {files.map(/**
             * Renders a sidebar item for each accessible vault file.
             * @param file - The accessible vault to render as a navigation item.
             */ (file) => (
              <SidebarMenuItem key={file.id}>
                <SidebarMenuButton
                  type="button"
                  isActive={file.id === selectedId}
                  aria-current={file.id === selectedId ? 'true' : undefined}
                  disabled={disabled}
                  title={file.id === openId ? `${file.name} (unlocked)` : file.name}
                  className={file.id === openId
                    ? 'bg-emerald-500/10 font-medium text-emerald-700 ring-1 ring-emerald-500/40 hover:bg-emerald-500/15 hover:text-emerald-800 data-active:bg-emerald-500/10 data-active:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-200 dark:data-active:text-emerald-300'
                    : undefined}
                  onClick={/** Selects the vault only when it is not already active. */ () => {
                    if (file.id !== selectedId) onSelect(file);
                    setOpenMobile(false);
                  }}
                >
                  {file.id === openId ? <LockKeyholeOpenIcon /> : <DatabaseIcon />}
                  <span>
                    {file.name}
                    {file.id === openId && <span className="sr-only"> (unlocked)</span>}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        {folderTree && (
          <>
            <SidebarSeparator className="mx-2" />
            {folderTree}
          </>
        )}
      </SidebarContent>
      <SidebarFooter className="gap-3 border-t px-4 py-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheckIcon className="size-4 shrink-0" /> Decryption stays in this browser
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar aria-hidden="true">
            <AvatarFallback className="bg-primary font-medium text-primary-foreground">
              {user.username.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={user.username}>
              {user.username}
            </p>
            {user.email && (
              <p className="truncate text-xs text-muted-foreground" title={user.email}>
                {user.email}
              </p>
            )}
          </div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>{profile}</SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
