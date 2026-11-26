import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from './lib/api';
import type { AdminFile, DataStorage, User, WebDavCredential } from './lib/api';
import { createKdbxBytes } from './lib/kdbx';
import { getTheme, toggleTheme } from './theme';
import {
  DatabaseIcon,
  DownloadIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  ScrollTextIcon,
  MoonIcon,
  NetworkIcon,
  PlusIcon,
  RotateCcwIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SunIcon,
  UploadIcon,
  UsersIcon
} from 'lucide-react';
import { AdminProfile } from '@/components/admin-profile';
import { AuthLayout } from '@/components/auth-layout';
import { DashboardPanel } from '@/components/dashboard';
import { DataStorageBanner, DataStoragePanel } from '@/components/data-storage';
import { RateLimitSettingsPanel } from '@/components/rate-limit-settings';
import { WebDavLogsPanel } from '@/components/webdav-logs';
import { AuditLogPanel } from '@/components/audit-log';
import { AuditSettingsPanel } from '@/components/audit-settings';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar
} from '@/components/ui/sidebar';
import { TableCell, TableRow } from '@/components/ui/table';
import { VersionBadge } from '@shared/app-version';
import { InsecureContextAlert, hasBrowserCrypto } from '@shared/secure-context';
import { DataTable, type TableColumn } from '@shared/data-table';
import { matchesTableSearch, timestampSortValue } from '@shared/table-data';

type Message = { kind: 'notice' | 'error'; text: string } | null;
type Tab = 'dashboard' | 'vaults' | 'users' | 'webdav' | 'settings' | 'audit-log' | 'webdav-logs';
type PermissionValue = 'none' | 'read' | 'read-write';

const ADMIN_SECTIONS = {
  dashboard: {
    title: 'Dashboard',
    description: 'Status, version, storage and activity of this KeePort instance at a glance.',
    icon: LayoutDashboardIcon
  },
  vaults: {
    title: 'Vault files',
    description: 'Create or upload KDBX files and manage who can access them.',
    icon: DatabaseIcon
  },
  users: { title: 'Users', description: 'Manage account roles, status and passwords.', icon: UsersIcon },
  webdav: {
    title: 'WebDAV credentials',
    description: 'Manage app passwords for external KeePass clients.',
    icon: NetworkIcon
  },
  settings: {
    title: 'Settings',
    description: 'Manage server-wide settings for KeePort.',
    icon: SettingsIcon
  },
  'audit-log': {
    title: 'Audit log',
    description: 'Who signed in and who changed users, vaults, permissions and settings, and when.',
    icon: ShieldCheckIcon
  },
  'webdav-logs': {
    title: 'WebDAV logs',
    description: 'Review requests from KeePass clients to diagnose sync problems.',
    icon: NetworkIcon
  }
} as const;

/** Sections listed directly under "Manage" in the navigation. */
const MANAGE_TABS: readonly Tab[] = ['dashboard', 'vaults', 'users', 'webdav', 'settings'];
/** Sections listed below the "Logs" navigation entry; the first one opens when "Logs" is selected. */
const LOG_TABS: readonly Tab[] = ['audit-log', 'webdav-logs'];

const VAULT_COLUMNS: readonly TableColumn<AdminFile>[] = [
  /**
   * Sorts by vault filename.
   * @param file - The vault file metadata supplying this column's sort value.
   */
  { id: 'name', label: 'Name', sortValue: (file) => file.name },
  /**
   * Sorts by file size in bytes.
   * @param file - The vault file metadata supplying this column's sort value.
   */
  { id: 'size', label: 'Size', sortValue: (file) => file.size },
  /**
   * Sorts by content revision number.
   * @param file - The vault file metadata supplying this column's sort value.
   */
  { id: 'revision', label: 'Rev', sortValue: (file) => file.revision },
  /**
   * Sorts by modification time, not the formatted date.
   * @param file - The vault file metadata supplying this column's sort value.
   */
  { id: 'updated', label: 'Updated', sortValue: (file) => timestampSortValue(file.updatedAt) },
  /**
   * Sorts by the visible deletion status.
   * @param file - The vault file metadata supplying this column's sort value.
   */
  { id: 'status', label: 'Status', sortValue: (file) => file.deletedAt ? 'Deleted' : 'Active' },
  { id: 'actions', label: 'Actions' }
];

const ACCOUNT_COLUMNS: readonly TableColumn<User>[] = [
  /**
   * Sorts by account username.
   * @param account - The account row supplying the displayed fields.
   */
  { id: 'user', label: 'User', sortValue: (account) => account.username },
  /**
   * Sorts by role name.
   * @param account - The account row supplying the displayed fields.
   */
  { id: 'role', label: 'Role', sortValue: (account) => account.role },
  /**
   * Sorts enabled accounts before disabled accounts in ascending order.
   * @param account - The account row supplying the displayed fields.
   */
  { id: 'disabled', label: 'Disabled', sortValue: (account) => Number(account.disabled) },
  { id: 'newPassword', label: 'New password' },
  /**
   * Sorts by the last sign-in time, leaving missing dates distinct.
   * @param account - The account row supplying the displayed fields.
   */
  { id: 'lastLogin', label: 'Last login', sortValue: (account) => timestampSortValue(account.lastLoginAt) },
  { id: 'actions', label: 'Actions' }
];

/**
 * Prompts for confirmation before running a destructive admin action.
 * @param props - The action label, confirmation title and description, disabled state, and callback to run on acceptance.
 */
function ConfirmAction({
  label,
  title,
  description,
  disabled,
  onConfirm
}: {
  label: string;
  title: string;
  description: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-destructive" disabled={disabled}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Formats a file size in bytes, kilobytes, or megabytes.
 * @param size - The file size in bytes.
 */
function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Formats a timestamp for display or shows a placeholder if missing.
 * @param value - The timestamp string to format for the current locale.
 */
function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Shows API error details when available and otherwise uses the fallback.
 * @param error - The caught error to inspect.
 * @param fallback - The message to use if the error has no useful text.
 */
function errorText(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * Copies only the bytes represented by the view into an ArrayBuffer.
 * @param bytes - The byte view whose selected range should be copied.
 */
function uint8ToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Renders account details and controls for editing or deleting that account.
 * @param props - The managed account, signed-in account ID, and callbacks for refreshing data and reporting outcomes.
 */
function UserRow({
  user,
  currentUserId,
  onChanged,
  setMessage
}: {
  user: User;
  currentUserId: string;
  onChanged: () => Promise<void>;
  setMessage: (message: Message) => void;
}) {
  const [role, setRole] = useState<'admin' | 'user'>(user.role);
  const [disabled, setDisabled] = useState(user.disabled);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  /** Resets account edits when the server-provided account changes. */
  useEffect(() => {
    setRole(user.role);
    setDisabled(user.disabled);
    setPassword('');
  }, [user]);

  const changed = role !== user.role || disabled !== user.disabled || Boolean(password);

  /** Saves the account changes, sending a new password only when entered. */
  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await api.updateUser(user.id, { role, disabled, ...(password ? { password } : {}) });
      setPassword('');
      setMessage({ kind: 'notice', text: `Updated ${user.username}.` });
      await onChanged();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Unable to update user.') });
    } finally {
      setBusy(false);
    }
  }

  /** Deletes the account and refreshes the relevant lists. */
  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      await api.deleteUser(user.id);
      setMessage({ kind: 'notice', text: `Deleted ${user.username}.` });
      await onChanged();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Unable to delete user.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="max-w-48 truncate ps-6 font-medium" title={user.id}>
        {user.username}
        {user.email && (
          <div className="truncate text-xs font-normal text-muted-foreground" title={user.email}>
            {user.email}
          </div>
        )}
      </TableCell>
      <TableCell>
        <NativeSelect
          aria-label={`Role for ${user.username}`}
          value={role}
          onChange={/**
           * Updates the draft account role.
           * @param event - The account role selector change event.
           */ (event) => setRole(event.target.value as 'admin' | 'user')}
        >
          <NativeSelectOption value="admin">Admin</NativeSelectOption>
          <NativeSelectOption value="user">User</NativeSelectOption>
        </NativeSelect>
      </TableCell>
      <TableCell>
        <Checkbox
          aria-label={`Disable ${user.username}`}
          checked={disabled}
          onCheckedChange={/**
           * Updates whether the draft account is disabled.
           * @param checked - The checkbox state indicating whether to disable the account.
           */ (checked) => setDisabled(checked === true)}
        />
      </TableCell>
      <TableCell>
        <Input
          className="min-w-32"
          aria-label={`New password for ${user.username}`}
          type="password"
          autoComplete="new-password"
          placeholder="Unchanged"
          value={password}
          onChange={/**
           * Stores the draft replacement password until save.
           * @param event - The replacement password input change event.
           */ (event) => setPassword(event.target.value)}
        />
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDate(user.lastLoginAt)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!changed || busy} onClick={save}>
            Save
          </Button>
          <ConfirmAction
            label="Delete"
            title={`Delete ${user.username}?`}
            description="This permanently removes the account and its access to vaults."
            disabled={user.id === currentUserId || busy}
            onConfirm={/** Deletes the account after confirmation. */ () => {
              void remove();
            }}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Renders vault metadata and actions appropriate to the file's deletion status.
 * @param props - The vault metadata and callbacks to refresh the list, report outcomes, and open its permissions.
 */
function FileRow({
  file,
  onChanged,
  setMessage,
  onOpenPermissions
}: {
  file: AdminFile;
  onChanged: () => Promise<void>;
  setMessage: (message: Message) => void;
  onOpenPermissions: (file: AdminFile) => void;
}) {
  const [busy, setBusy] = useState(false);

  /**
   * Runs a vault mutation with shared busy, notification, and refresh handling.
   * @param action - The API operation for the selected vault.
   * @param success - The notice to display after the operation succeeds.
   */
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ kind: 'notice', text: success });
      await onChanged();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Vault action failed.') });
    } finally {
      setBusy(false);
    }
  }

  const [renameOpen, setRenameOpen] = useState(false);

  /**
   * Submits the selected file's new name after closing its dialog.
   * @param event - The submission event from the vault rename form.
   */
  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (!name) return;
    setRenameOpen(false);
    if (name !== file.name) await run(/** Submits the new name for the selected vault. */ () => api.renameFile(file.id, name), 'Vault renamed.');
  }

  /** Downloads the encrypted vault through a temporary browser object URL. */
  async function download() {
    setBusy(true);
    setMessage(null);
    try {
      const blob = await api.downloadFile(file.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage({ kind: 'notice', text: 'Vault download started.' });
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Unable to download vault.') });
    } finally {
      setBusy(false);
    }
  }

  /** Moves the selected vault to the deleted files list. */
  async function remove() {
    await run(/** Requests a soft deletion of the selected vault. */ () => api.deleteFile(file.id), 'Vault moved to deleted vaults.');
  }

  /** Restores the selected vault to the active files list. */
  async function restore() {
    await run(/** Requests restoration of the selected vault. */ () => api.restoreFile(file.id), 'Vault restored.');
  }

  return (
    <TableRow>
      <TableCell className="max-w-64 truncate ps-6 font-medium" title={file.id}>
        {file.name}
      </TableCell>
      <TableCell>{formatBytes(file.size)}</TableCell>
      <TableCell>{file.revision}</TableCell>
      <TableCell className="text-muted-foreground">{formatDate(file.updatedAt)}</TableCell>
      <TableCell>
        <Badge variant={file.deletedAt ? 'outline' : 'secondary'}>{file.deletedAt ? 'Deleted' : 'Active'}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {!file.deletedAt && (
            <Button variant="outline" size="sm" disabled={busy} onClick={/** Opens the permissions editor for this vault. */ () => onOpenPermissions(file)}>
              Permissions
            </Button>
          )}
          {!file.deletedAt && (
            <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy}>
                  Rename
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Rename vault</DialogTitle>
                  <DialogDescription>Changing the filename does not change the encrypted contents.</DialogDescription>
                </DialogHeader>
                <form className="grid gap-4" onSubmit={rename}>
                  <Field>
                    <FieldLabel htmlFor={`rename-${file.id}`}>File name</FieldLabel>
                    <Input id={`rename-${file.id}`} name="name" defaultValue={file.name} required />
                  </Field>
                  <Button type="submit" className="justify-self-end">
                    Save name
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Download ${file.name}`}
            title="Download"
            disabled={busy}
            onClick={download}
          >
            <DownloadIcon />
          </Button>
          {file.deletedAt ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={restore}>
              <RotateCcwIcon /> Restore
            </Button>
          ) : (
            <ConfirmAction
              label="Delete"
              title="Move this vault to deleted files?"
              description={`You can restore ${file.name} from the deleted files list.`}
              disabled={busy}
              onConfirm={/** Soft-deletes the vault after confirmation. */ () => {
                void remove();
              }}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Loads and edits the complete access list for a vault.
 * @param props - The target vault, candidate accounts, and callbacks to close the panel and report outcomes.
 */
function PermissionPanel({
  file,
  users,
  onClose,
  setMessage
}: {
  file: AdminFile;
  users: User[];
  onClose: () => void;
  setMessage: (message: Message) => void;
}) {
  const [rows, setRows] = useState<Record<string, PermissionValue>>({});
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const eligibleUsers = useMemo(/** Derives the accounts that can receive vault grants. */ () => users.filter(/**
   * Includes only enabled non-admin user accounts.
   * @param user - The candidate account whose role and disabled state are checked.
   */ (user) => user.role === 'user' && !user.disabled), [users]);

  /** Reloads permissions when the selected vault or eligible accounts change. */
  useEffect(() => {
    let cancelled = false;
    (/** Loads persisted grants and initializes unassigned accounts to no access. */ async () => {
      setBusy(true);
      setLoaded(false);
      setErrorMessage('');
      try {
        const permissions = await api.getPermissions(file.id);
        if (cancelled) return;
        const next: Record<string, PermissionValue> = {};
        for (const user of eligibleUsers) next[user.id] = 'none';
        for (const permission of permissions) {
          if (permission.permission === 'read' || permission.permission === 'read-write')
            next[permission.userId] = permission.permission;
        }
        setRows(next);
        setLoaded(true);
      } catch (error) {
        if (!cancelled) setErrorMessage(errorText(error, 'Unable to load permissions.'));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return /** Prevents stale permission requests from updating a closed or changed panel. */ () => {
      cancelled = true;
    };
  }, [file.id, eligibleUsers]);

  /** Saves the edited grants as a complete replacement access list. */
  async function save() {
    setBusy(true);
    setErrorMessage('');
    try {
      await api.setPermissions(
        file.id,
        Object.entries(rows).map(/**
         * Converts each draft entry into the API's grant shape.
         * @param entry - The draft pair containing a user ID and its selected access level.
         */ ([userId, permission]) => ({ userId, permission }))
      );
      setMessage({ kind: 'notice', text: `Permissions updated for ${file.name}.` });
      onClose();
    } catch (error) {
      setErrorMessage(errorText(error, 'Unable to save permissions.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={/**
       * Closes the permissions panel on dismissal.
       * @param open - The access panel's next open state.
       */ (open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b p-6 pe-12">
          <SheetTitle>Vault permissions</SheetTitle>
          <SheetDescription>{file.name} · Administrators always have read-write access.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 p-6">
          {errorMessage && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
          {busy && !loaded && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading permissions…
            </p>
          )}
          {loaded && !eligibleUsers.length && (
            <Alert>
              <AlertDescription>No active non-admin accounts exist yet.</AlertDescription>
            </Alert>
          )}
          {loaded &&
            eligibleUsers.map(/**
             * Renders one permission selector for each eligible account.
             * @param user - The eligible account that receives a permission selector.
             */ (user) => (
              <Field orientation="horizontal" key={user.id} className="justify-between rounded-lg border p-3">
                <FieldLabel htmlFor={`permission-${user.id}`}>{user.username}</FieldLabel>
                <NativeSelect
                  id={`permission-${user.id}`}
                  value={rows[user.id] ?? 'none'}
                  disabled={busy}
                  onChange={/**
                   * Applies a changed permission to the account's draft grant.
                   * @param event - The selected account's permission selector change event.
                   */ (event) =>
                    setRows(/**
                     * Merges the selected grant without replacing the other unsaved edits.
                     * @param current - The current draft grant for each account ID.
                     */ (current) => ({ ...current, [user.id]: event.target.value as PermissionValue }))
                  }
                >
                  <NativeSelectOption value="none">No access</NativeSelectOption>
                  <NativeSelectOption value="read">Read only</NativeSelectOption>
                  <NativeSelectOption value="read-write">Read and write</NativeSelectOption>
                </NativeSelect>
              </Field>
            ))}
          {loaded && eligibleUsers.length > 0 && (
            <Button className="justify-self-start" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save permissions'}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Manages the admin session and renders the selected administration view. */
export default function App() {
  const [ready, setReady] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [users, setUsers] = useState<User[]>([]);
  const [files, setFiles] = useState<AdminFile[]>([]);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [credentials, setCredentials] = useState<WebDavCredential[]>([]);
  const [storage, setStorage] = useState<DataStorage | null>(null);
  const usernamesById = useMemo(/** Builds a lookup of account names for credential rows. */ () => new Map(users.map(/**
   * Pairs each account ID with its display username.
   * @param item - One account whose ID is mapped to its username.
   */ (item) => [item.id, item.username])), [users]);
  const [permFile, setPermFile] = useState<AdminFile | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [theme, setTheme] = useState(getTheme);

  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');

  const [newVaultName, setNewVaultName] = useState('');
  const [newVaultPassword, setNewVaultPassword] = useState('');

  const [webdavUserId, setWebdavUserId] = useState('');
  const [webdavLabel, setWebdavLabel] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');

  /** Reloads the managed accounts from the Admin API. */
  async function refreshUsers() {
    setUsers(await api.listUsers());
  }

  /** Reloads vault metadata using the current deletion filter. */
  async function refreshFiles() {
    setFiles(await api.listFiles(includeDeleted));
  }

  /** Loads where KeePort keeps its data; a failure only hides the storage warning. */
  async function refreshStorage() {
    setStorage(await api.getDataStorage().catch(/** Ignores a failed storage check. */ () => null));
  }

  /** Reloads the WebDAV credential inventory. */
  async function refreshWebDav() {
    setCredentials(await api.listWebDavCredentials());
  }

  /** Refreshes accounts and WebDAV credentials in parallel. */
  async function refreshAll() {
    await Promise.all([refreshUsers(), refreshWebDav(), refreshStorage()]);
  }

  /** Initializes the admin console and ignores responses after unmount. */
  useEffect(() => {
    let cancelled = false;
    (/** Checks first-run setup before restoring an existing administrator session. */ async () => {
      try {
        const status = await api.setupStatus();
        if (cancelled) return;
        if (status.requiresSetup) {
          setSetupRequired(true);
          return;
        }
        const me = await api.me();
        if (cancelled) return;
        await api.csrf();
        setUser(me);
        await refreshAll();
      } catch (error) {
        if (!cancelled && !(error instanceof ApiError && error.status === 401)) {
          setMessage({ kind: 'error', text: errorText(error, 'Unable to load admin console.') });
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return /** Invalidates the pending initialization task when the effect ends. */ () => {
      cancelled = true;
    };
  }, []);

  /** Refreshes files when a signed-in administrator changes the deletion filter. */
  useEffect(() => {
    if (!ready || !user || user.role !== 'admin') return;
    let cancelled = false;
    /**
     * Reports file-list failures only while the request is current.
     * @param error - The reason why fetching the vault file list failed.
     */
    api
      .listFiles(includeDeleted)
      .then(/**
       * Publishes the new file list only while the request is current.
       * @param result - The vault file list returned for the current deletion filter.
       */ (result) => {
        if (!cancelled) setFiles(result);
      })
      .catch((error) => {
        if (!cancelled) setMessage({ kind: 'error', text: errorText(error, 'Unable to load vault files.') });
      });
    return /** Invalidates a pending file query when its dependencies change. */ () => {
      cancelled = true;
    };
  }, [includeDeleted, ready, user]);

  /**
   * Enters the admin workspace and loads management data after authentication.
   * @param result - The successful setup or login result containing the administrator account.
   */
  async function afterAuth(result: { user: User }) {
    setTab('dashboard');
    setUser(result.user);
    setSetupRequired(false);
    await refreshAll();
  }

  /**
   * Submits admin credentials and clears the form on successful sign-in.
   * @param event - The submission event from the sign-in form.
   */
  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy('login');
    setMessage(null);
    try {
      const result = await api.login({
        username: String(data.get('username') ?? ''),
        password: String(data.get('password') ?? '')
      });
      await afterAuth(result);
      form.reset();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Login failed.') });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Submits the setup token and first administrator's account details.
   * @param event - The submission event from the first-run setup form.
   */
  async function handleSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy('setup');
    setMessage(null);
    try {
      const result = await api.setup({
        setupToken: String(data.get('setupToken') ?? ''),
        username: String(data.get('username') ?? ''),
        email: String(data.get('email') ?? '').trim(),
        password: String(data.get('password') ?? '')
      });
      await afterAuth(result);
      form.reset();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Setup failed.') });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Updates the profile and the matching account row after an email change.
   * @param updated - The account returned by the profile update.
   */
  function handleProfileUpdate(updated: User) {
    /**
     * Replaces the active profile only when the updated account is signed in.
     * @param current - The account currently signed in, or null when signed out.
     */
    setUser((current) => current?.id === updated.id ? updated : current);
    /**
     * Updates the account table without reloading the inventory.
     * @param items - The account records currently displayed in the table.
     */
    setUsers((items) => items.map(/**
     * Replaces only the row matching the updated account ID.
     * @param item - One current account row to compare with the updated account ID.
     */ (item) => item.id === updated.id ? updated : item));
  }

  /** Clears local admin state and ends the server session if it still exists. */
  async function handleLogout() {
    setMessage(null);
    setNewEmail('');
    setNewPassword('');
    setNewVaultPassword('');
    setWebdavPassword('');
    setUser(null);
    setUsers([]);
    setFiles([]);
    setCredentials([]);
    setStorage(null);
    setPermFile(null);
    try {
      await api.logout();
    } catch {
      /* session may already be gone */
    }
  }

  /**
   * Creates an account from the form and refreshes the account list.
   * @param event - The submission event from the account creation form.
   */
  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('create-user');
    setMessage(null);
    try {
      await api.createUser({ username: newUsername, email: newEmail, password: newPassword, role: newRole });
      setNewUsername('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('user');
      setMessage({ kind: 'notice', text: 'User created.' });
      await refreshUsers();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Unable to create user.') });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Uploads the selected encrypted file and refreshes the vault list.
   * @param event - The selection change from the file input containing the selected encrypted vault.
   */
  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('upload');
    setMessage(null);
    try {
      await api.uploadFile(file);
      setMessage({ kind: 'notice', text: `Uploaded ${file.name}.` });
      await refreshFiles();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Unable to upload vault.') });
    } finally {
      setBusy(null);
    }
  }

  /** Creates an encrypted KDBX in the browser and uploads the resulting file. */
  async function handleCreateVault() {
    if (!newVaultName.trim() || !newVaultPassword) {
      setMessage({ kind: 'error', text: 'Vault name and master password are required.' });
      return;
    }
    setBusy('create-vault');
    setMessage(null);
    try {
      const bytes = await createKdbxBytes(newVaultName.trim(), newVaultPassword);
      const arrayBuffer = uint8ToArrayBuffer(bytes);
      const fileName = newVaultName.trim().toLowerCase().endsWith('.kdbx')
        ? newVaultName.trim()
        : `${newVaultName.trim()}.kdbx`;
      const file = new File([arrayBuffer], fileName, { type: 'application/octet-stream' });
      await api.uploadFile(file, fileName);
      setNewVaultName('');
      setNewVaultPassword('');
      setMessage({ kind: 'notice', text: 'Vault created in the browser and uploaded.' });
      await refreshFiles();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Unable to create vault.') });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Creates a WebDAV credential for the selected user account.
   * @param event - The submission event from the WebDAV credential creation form.
   */
  async function handleCreateWebDav(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!webdavUserId || !webdavLabel.trim() || !webdavPassword) {
      setMessage({ kind: 'error', text: 'User, label and app password are required.' });
      return;
    }
    setBusy('create-webdav');
    setMessage(null);
    try {
      await api.createWebDavCredential({ userId: webdavUserId, label: webdavLabel.trim(), password: webdavPassword });
      setWebdavLabel('');
      setWebdavPassword('');
      setMessage({
        kind: 'notice',
        text: 'WebDAV credential created. Give the user the WebDAV username and app password.'
      });
      await refreshWebDav();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Unable to create WebDAV credential.') });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Revokes the credential and refreshes the credential list.
   * @param id - The ID of the WebDAV credential to revoke.
   */
  async function revokeWebDav(id: string) {
    setBusy('revoke-webdav');
    setMessage(null);
    try {
      await api.revokeWebDavCredential(id);
      setMessage({ kind: 'notice', text: 'WebDAV credential revoked.' });
      await refreshWebDav();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Unable to revoke WebDAV credential.') });
    } finally {
      setBusy(null);
    }
  }

  const themeAction = (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      onClick={/** Toggles the theme and updates the workspace controls. */ () => setTheme(toggleTheme())}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </Button>
  );

  if (!ready || setupRequired || !user) {
    return (
      <AuthLayout area="Admin" themeAction={themeAction}>
        {!ready ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading admin console…
          </p>
        ) : (
          <form className="grid gap-5" onSubmit={setupRequired ? handleSetup : handleLogin}>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                {setupRequired ? 'Initial setup' : 'Admin sign in'}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {setupRequired
                  ? 'Use the one-time token from the KeePort logs to create your first administrator account.'
                  : 'Sign in with an administrator account to manage vault files, users and WebDAV access.'}
              </p>
            </div>
            {message?.kind === 'error' && (
              <Alert variant="destructive">
                <AlertDescription>{message.text}</AlertDescription>
              </Alert>
            )}
            <FieldGroup className="gap-4">
              {setupRequired && (
                <Field>
                  <FieldLabel htmlFor="setupToken">Setup token</FieldLabel>
                  <Input id="setupToken" name="setupToken" autoComplete="off" required />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="username">Username</FieldLabel>
                <Input id="username" name="username" autoComplete="username" required />
              </Field>
              {setupRequired && (
                <Field>
                  <FieldLabel htmlFor="setup-email">Email address</FieldLabel>
                  <Input id="setup-email" name="email" type="email" autoComplete="email" maxLength={254} required />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={setupRequired ? 'new-password' : 'current-password'}
                  required
                />
              </Field>
            </FieldGroup>
            <Button type="submit" disabled={busy === 'setup' || busy === 'login'}>
              {setupRequired
                ? busy === 'setup'
                  ? 'Creating…'
                  : 'Create admin'
                : busy === 'login'
                  ? 'Signing in…'
                  : 'Sign in'}
            </Button>
          </form>
        )}
      </AuthLayout>
    );
  }

  // Browsers only offer the Web Crypto API needed for KDBX encryption over HTTPS or on localhost.
  const browserCrypto = hasBrowserCrypto();
  const currentSection = ADMIN_SECTIONS[tab];
  return (
    <SidebarProvider>
      <AdminNavigation
        tab={tab}
        user={user}
        onProfileUpdate={handleProfileUpdate}
        onSelect={/**
         * Switches admin sections and clears the previous selection and message.
         * @param next - The section selected in the administration navigation.
         */ (next) => {
          setTab(next);
          setPermFile(null);
          setMessage(null);
        }}
      />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <SidebarTrigger />
          <Separator orientation="vertical" className="data-vertical:h-4 data-vertical:self-center" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">Admin console</span>
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
          <div className="space-y-1">
            <div className="text-xs font-medium tracking-widest text-muted-foreground uppercase">Administration</div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{currentSection.title}</h1>
            <p className="text-sm text-muted-foreground">{currentSection.description}</p>
          </div>
          {storage?.needsAttention && (
            <DataStorageBanner
              storage={storage}
              onOpenSettings={/** Opens the settings page with the storage details. */ () => {
                setTab('settings');
                setPermFile(null);
                setMessage(null);
              }}
            />
          )}
          {message && (
            <Alert variant={message.kind === 'error' ? 'destructive' : 'default'}>
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          )}

          {tab === 'settings' && (
            <>
              <RateLimitSettingsPanel />
              <AuditSettingsPanel />
              <DataStoragePanel storage={storage} />
            </>
          )}

          {tab === 'audit-log' && <AuditLogPanel />}
          {tab === 'webdav-logs' && <WebDavLogsPanel />}

          {tab === 'dashboard' && (
            <DashboardPanel
              onNavigate={/**
               * Opens the admin section a dashboard card links to.
               * @param target - The section to open.
               */ (target) => {
                setTab(target);
                setPermFile(null);
                setMessage(null);
              }}
            />
          )}

          {tab === 'vaults' && (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Create a vault</CardTitle>
                    <CardDescription>New vaults are encrypted in your browser before upload.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!browserCrypto && (
                      <div className="mb-4">
                        <InsecureContextAlert action="Creating a vault" />
                      </div>
                    )}
                    <form
                      className="grid gap-4"
                      onSubmit={/**
                       * Creates the vault without navigating away from the admin workspace.
                       * @param event - The new-vault form submission event.
                       */ (event) => {
                        event.preventDefault();
                        void handleCreateVault();
                      }}
                    >
                      <FieldGroup className="grid gap-3 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor="vault-name">Vault name</FieldLabel>
                          <Input
                            id="vault-name"
                            value={newVaultName}
                            onChange={/**
                             * Updates the new vault's draft filename.
                             * @param event - The vault filename input change event.
                             */ (event) => setNewVaultName(event.target.value)}
                            placeholder="family.kdbx"
                            required
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="vault-master-password">Master password</FieldLabel>
                          <Input
                            id="vault-master-password"
                            type="password"
                            autoComplete="off"
                            value={newVaultPassword}
                            onChange={/**
                             * Updates the master password used for local KDBX creation.
                             * @param event - The new vault master password input change event.
                             */ (event) => setNewVaultPassword(event.target.value)}
                            required
                          />
                        </Field>
                      </FieldGroup>
                      <Button type="submit" size="sm" className="justify-self-start" disabled={busy !== null || !browserCrypto}>
                        <PlusIcon />
                        {busy === 'create-vault' ? 'Creating…' : 'Create KDBX'}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Upload a vault</CardTitle>
                    <CardDescription>Add an existing encrypted KeePass file.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Field className="max-w-sm">
                      <FieldLabel htmlFor="vault-upload">
                        <UploadIcon className="size-4" /> KDBX file
                      </FieldLabel>
                      <Input
                        type="file"
                        id="vault-upload"
                        accept=".kdbx"
                        onChange={handleUpload}
                        disabled={busy !== null}
                      />
                      <FieldDescription>
                        {busy === 'upload' ? 'Uploading…' : 'The file uploads as soon as you select it.'}
                      </FieldDescription>
                    </Field>
                  </CardContent>
                </Card>
              </div>
              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="flex flex-wrap items-center justify-between gap-3 border-b py-5">
                  <div className="space-y-1">
                    <CardTitle>Stored vaults</CardTitle>
                    <CardDescription>
                      {files.length} {files.length === 1 ? 'file' : 'files'}
                    </CardDescription>
                  </div>
                  <Field orientation="horizontal" className="w-auto gap-2">
                    <Checkbox
                      id="show-deleted"
                      checked={includeDeleted}
                      onCheckedChange={/**
                       * Changes whether the file list includes deleted vaults.
                       * @param checked - The checkbox state for including soft-deleted files.
                       */ (checked) => setIncludeDeleted(checked === true)}
                    />
                    <FieldLabel htmlFor="show-deleted">Show deleted</FieldLabel>
                  </Field>
                </CardHeader>
                <DataTable
                  label="Stored vaults"
                  rows={files}
                  columns={VAULT_COLUMNS}
                  searchLabel="Search vault files"
                  emptyMessage="No vault files yet."
                  matches={/**
                   * Searches the visible filename, size, revision, date, and status fields.
                   * @param file - The vault row whose displayed metadata is searched.
                   * @param query - The search text to match against the row.
                   */ (file, query) => matchesTableSearch(
                    query, file.name, formatBytes(file.size), file.revision, formatDate(file.updatedAt), file.deletedAt ? 'Deleted' : 'Active'
                  )}
                  renderRow={/**
                   * Renders a vault row with its management actions.
                   * @param file - The vault metadata row to render with its actions.
                   */ (file) => (
                    <FileRow
                      key={file.id}
                      file={file}
                      onChanged={refreshFiles}
                      setMessage={setMessage}
                      onOpenPermissions={setPermFile}
                    />
                  )}
                />
              </Card>
              {permFile && (
                <PermissionPanel
                  key={permFile.id}
                  file={permFile}
                  users={users}
                  onClose={/** Clears the permissions selection when the panel closes. */ () => setPermFile(null)}
                  setMessage={setMessage}
                />
              )}
            </>
          )}

          {tab === 'users' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Create a user</CardTitle>
                  <CardDescription>
                    Choose an account role; grant access to individual vaults separately.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="flex flex-wrap items-end gap-4" onSubmit={handleCreateUser}>
                    <Field className="w-full sm:w-48">
                      <FieldLabel htmlFor="new-username">Username</FieldLabel>
                      <Input
                        id="new-username"
                        value={newUsername}
                        onChange={/**
                         * Updates the draft username for the new account.
                         * @param event - The new account username input change event.
                         */ (event) => setNewUsername(event.target.value)}
                        required
                      />
                    </Field>
                    <Field className="w-full sm:w-60">
                      <FieldLabel htmlFor="new-user-email">Email address</FieldLabel>
                      <Input
                        id="new-user-email"
                        type="email"
                        autoComplete="off"
                        maxLength={254}
                        value={newEmail}
                        onChange={/**
                         * Updates the draft email for the new account.
                         * @param event - The new account email input change event.
                         */ (event) => setNewEmail(event.target.value)}
                        required
                      />
                    </Field>
                    <Field className="w-full sm:w-48">
                      <FieldLabel htmlFor="new-user-password">Password</FieldLabel>
                      <Input
                        id="new-user-password"
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={/**
                         * Updates the draft login password for the new account.
                         * @param event - The new account password input change event.
                         */ (event) => setNewPassword(event.target.value)}
                        required
                      />
                    </Field>
                    <Field className="w-auto">
                      <FieldLabel htmlFor="new-role">Role</FieldLabel>
                      <NativeSelect
                        id="new-role"
                        value={newRole}
                        onChange={/**
                         * Updates the initial role for the new account.
                         * @param event - The new account role selector change event.
                         */ (event) => setNewRole(event.target.value as 'admin' | 'user')}
                      >
                        <NativeSelectOption value="user">User</NativeSelectOption>
                        <NativeSelectOption value="admin">Admin</NativeSelectOption>
                      </NativeSelect>
                    </Field>
                    <Button type="submit" disabled={busy === 'create-user'}>
                      <PlusIcon />
                      {busy === 'create-user' ? 'Creating…' : 'Create user'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="gap-1 border-b py-5">
                  <CardTitle>Accounts</CardTitle>
                  <CardDescription>
                    {users.length} {users.length === 1 ? 'account' : 'accounts'}
                  </CardDescription>
                </CardHeader>
                <DataTable
                  label="Accounts"
                  rows={users}
                  columns={ACCOUNT_COLUMNS}
                  searchLabel="Search accounts"
                  emptyMessage="No accounts yet."
                  matches={/**
                   * Searches the displayed account details.
                   * @param account - The account row supplying the displayed fields.
                   * @param query - The search text to match against the row.
                   */ (account, query) => matchesTableSearch(
                    query, account.username, account.email, account.role, account.disabled ? 'Disabled' : 'Enabled', formatDate(account.lastLoginAt)
                  )}
                  renderRow={/**
                   * Renders an editable row for the account.
                   * @param account - The account row supplying the displayed fields.
                   */ (account) => (
                    <UserRow
                      key={account.id}
                      user={account}
                      currentUserId={user.id}
                      onChanged={refreshUsers}
                      setMessage={setMessage}
                    />
                  )}
                />
              </Card>
            </>
          )}

          {tab === 'webdav' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Create a WebDAV credential</CardTitle>
                  <CardDescription>
                    Use a separate app password for each KeePass-compatible device or client.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="flex flex-wrap items-end gap-4" onSubmit={handleCreateWebDav}>
                    <Field className="w-full sm:w-44">
                      <FieldLabel htmlFor="webdav-user">User</FieldLabel>
                      <NativeSelect
                        id="webdav-user"
                        value={webdavUserId}
                        className="w-full"
                        onChange={/**
                         * Selects the account that will own the new WebDAV credential.
                         * @param event - The WebDAV owner account selector change event.
                         */ (event) => setWebdavUserId(event.target.value)}
                        required
                      >
                        <NativeSelectOption value="">Select user</NativeSelectOption>
                        {users
                          .filter(/**
                           * Offers WebDAV credentials only for enabled non-admin accounts.
                           * @param item - One candidate account to test for WebDAV eligibility.
                           */ (item) => item.role === 'user' && !item.disabled)
                          .map(/**
                           * Displays an eligible account as a credential-owner option.
                           * @param item - The eligible account shown as a WebDAV owner option.
                           */ (item) => (
                            <NativeSelectOption key={item.id} value={item.id}>
                              {item.username}
                            </NativeSelectOption>
                          ))}
                      </NativeSelect>
                    </Field>
                    <Field className="w-full sm:w-44">
                      <FieldLabel htmlFor="webdav-label">Label</FieldLabel>
                      <Input
                        id="webdav-label"
                        value={webdavLabel}
                        onChange={/**
                         * Updates the draft WebDAV credential label.
                         * @param event - The WebDAV credential label input change event.
                         */ (event) => setWebdavLabel(event.target.value)}
                        placeholder="iPhone KeePassium"
                        required
                      />
                    </Field>
                    <Field className="w-full sm:w-44">
                      <FieldLabel htmlFor="webdav-password">App password</FieldLabel>
                      <Input
                        id="webdav-password"
                        type="password"
                        autoComplete="new-password"
                        value={webdavPassword}
                        onChange={/**
                         * Updates the draft WebDAV password.
                         * @param event - The WebDAV password input change event.
                         */ (event) => setWebdavPassword(event.target.value)}
                        required
                      />
                    </Field>
                    <Button type="submit" disabled={busy === 'create-webdav'}>
                      <PlusIcon />
                      {busy === 'create-webdav' ? 'Creating…' : 'Create credential'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="gap-1 border-b py-5">
                  <CardTitle>App credentials</CardTitle>
                  <CardDescription>Revoke credentials independently from the web login.</CardDescription>
                </CardHeader>
                <DataTable
                  label="App credentials"
                  rows={credentials}
                  columns={[
                    /**
                     * Sorts by the WebDAV login name.
                     * @param item - The WebDAV credential supplying this column's sort value.
                     */
                    { id: 'username', label: 'Username', sortValue: (item) => item.username },
                    /**
                     * Sorts by the credential label.
                     * @param item - The WebDAV credential supplying this column's sort value.
                     */
                    { id: 'label', label: 'Label', sortValue: (item) => item.label },
                    /**
                     * Sorts by the owner's displayed name, falling back to the owner ID.
                     * @param item - The WebDAV credential supplying this column's sort value.
                     */
                    { id: 'user', label: 'User', sortValue: (item) => usernamesById.get(item.userId) ?? item.userId },
                    /**
                     * Sorts by credential creation time.
                     * @param item - The WebDAV credential supplying this column's sort value.
                     */
                    { id: 'created', label: 'Created', sortValue: (item) => timestampSortValue(item.createdAt) },
                    /**
                     * Sorts by the last use time, leaving unused credentials distinct.
                     * @param item - The WebDAV credential supplying this column's sort value.
                     */
                    { id: 'lastUsed', label: 'Last used', sortValue: (item) => timestampSortValue(item.lastUsedAt) },
                    /**
                     * Sorts by the visible revocation status.
                     * @param item - The WebDAV credential supplying this column's sort value.
                     */
                    { id: 'status', label: 'Status', sortValue: (item) => item.revokedAt ? 'Revoked' : 'Active' },
                    { id: 'actions', label: 'Actions' }
                  ]}
                  searchLabel="Search WebDAV credentials"
                  emptyMessage="No WebDAV credentials yet."
                  matches={/**
                   * Searches visible credential metadata without using its password.
                   * @param item - The credential whose displayed metadata is searched.
                   * @param query - The search text to match against the row.
                   */ (item, query) => matchesTableSearch(
                    query, item.username, item.label, usernamesById.get(item.userId) ?? item.userId,
                    formatDate(item.createdAt), formatDate(item.lastUsedAt), item.revokedAt ? 'Revoked' : 'Active'
                  )}
                  renderRow={/**
                   * Renders the credential details and its revocation action.
                   * @param credential - The WebDAV credential whose metadata and revocation action are rendered.
                   */ (credential) => (
                    <TableRow key={credential.id}>
                      <TableCell className="ps-6 font-medium">{credential.username}</TableCell>
                      <TableCell>{credential.label}</TableCell>
                      <TableCell>{usernamesById.get(credential.userId) ?? credential.userId}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(credential.createdAt)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(credential.lastUsedAt)}</TableCell>
                      <TableCell>
                        <Badge variant={credential.revokedAt ? 'outline' : 'secondary'}>
                          {credential.revokedAt ? 'Revoked' : 'Active'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {!credential.revokedAt && (
                          <ConfirmAction
                            label="Revoke"
                            title="Revoke WebDAV access?"
                            description={`The client using ${credential.username} will no longer be able to connect.`}
                            disabled={busy === 'revoke-webdav'}
                            onConfirm={/** Revokes this credential after confirmation. */ () => {
                              void revokeWebDav(credential.id);
                            }}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                />
              </Card>
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * Shows the admin sections and closes the mobile navigation drawer after selection.
 * @param props - The active section, signed-in administrator, and callbacks for profile updates and section changes.
 */
function AdminNavigation({ tab, user, onProfileUpdate, onSelect }: {
  tab: Tab;
  user: User;
  onProfileUpdate: (user: User) => void;
  onSelect: (tab: Tab) => void;
}) {
  const { setOpenMobile } = useSidebar();

  /**
   * Opens a section unless it is already active and closes the mobile navigation drawer.
   * @param section - The admin section selected in the navigation.
   */
  function select(section: Tab) {
    if (section !== tab) onSelect(section);
    setOpenMobile(false);
  }

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
            <p className="text-xs text-muted-foreground">Administration</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarMenu>
            {MANAGE_TABS.map(/**
             * Renders one navigation button for each management section.
             * @param section - The admin section identifier used to select its label and icon.
             */ (section) => {
              const { title, icon: Icon } = ADMIN_SECTIONS[section];
              return (
                <SidebarMenuItem key={section}>
                  <SidebarMenuButton
                    type="button"
                    isActive={tab === section}
                    aria-current={tab === section ? 'page' : undefined}
                    onClick={/** Opens this management section. */ () => select(section)}
                  >
                    <Icon />
                    <span>{title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                isActive={LOG_TABS.includes(tab)}
                onClick={/** Opens the first log section. */ () => select(LOG_TABS[0])}
              >
                <ScrollTextIcon />
                <span>Logs</span>
              </SidebarMenuButton>
              <SidebarMenuSub>
                {LOG_TABS.map(/**
                 * Renders one sub-navigation entry for each log section.
                 * @param section - The log section identifier used to select its label.
                 */ (section) => (
                  <SidebarMenuSubItem key={section}>
                    <SidebarMenuSubButton asChild isActive={tab === section}>
                      <button
                        type="button"
                        className="w-full"
                        aria-current={tab === section ? 'page' : undefined}
                        onClick={/** Opens this log section. */ () => select(section)}
                      >
                        <span>{ADMIN_SECTIONS[section].title}</span>
                      </button>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <AdminProfile user={user} onUpdate={onProfileUpdate} />
    </Sidebar>
  );
}
