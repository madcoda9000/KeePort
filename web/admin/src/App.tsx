import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from './lib/api';
import type { AdminFile, User, WebDavCredential } from './lib/api';
import { createKdbxBytes } from './lib/kdbx';
import { getTheme, toggleTheme } from './theme';
import {
  DatabaseIcon,
  DownloadIcon,
  KeyRoundIcon,
  LogOutIcon,
  MoonIcon,
  NetworkIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SunIcon,
  UploadIcon,
  UsersIcon
} from 'lucide-react';
import { AuthLayout } from '@/components/auth-layout';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Message = { kind: 'notice' | 'error'; text: string } | null;
type Tab = 'vaults' | 'users' | 'webdav';
type PermissionValue = 'none' | 'read' | 'read-write';

const ADMIN_SECTIONS = {
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
  }
} as const;

/** Prompts for confirmation before running a destructive admin action. */
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

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

function uint8ToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

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

  useEffect(() => {
    setRole(user.role);
    setDisabled(user.disabled);
    setPassword('');
  }, [user]);

  const changed = role !== user.role || disabled !== user.disabled || Boolean(password);

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
          onChange={(event) => setRole(event.target.value as 'admin' | 'user')}
        >
          <NativeSelectOption value="admin">Admin</NativeSelectOption>
          <NativeSelectOption value="user">User</NativeSelectOption>
        </NativeSelect>
      </TableCell>
      <TableCell>
        <Checkbox
          aria-label={`Disable ${user.username}`}
          checked={disabled}
          onCheckedChange={(checked) => setDisabled(checked === true)}
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
          onChange={(event) => setPassword(event.target.value)}
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
            onConfirm={() => {
              void remove();
            }}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

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

  /** Submits the selected file's new name after closing its dialog. */
  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (!name) return;
    setRenameOpen(false);
    if (name !== file.name) await run(() => api.renameFile(file.id, name), 'Vault renamed.');
  }

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

  async function remove() {
    await run(() => api.deleteFile(file.id), 'Vault moved to deleted vaults.');
  }

  async function restore() {
    await run(() => api.restoreFile(file.id), 'Vault restored.');
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
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenPermissions(file)}>
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
              onConfirm={() => {
                void remove();
              }}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

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
  const eligibleUsers = useMemo(() => users.filter((user) => user.role === 'user' && !user.disabled), [users]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
    return () => {
      cancelled = true;
    };
  }, [file.id, eligibleUsers]);

  async function save() {
    setBusy(true);
    setErrorMessage('');
    try {
      await api.setPermissions(
        file.id,
        Object.entries(rows).map(([userId, permission]) => ({ userId, permission }))
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
      onOpenChange={(open) => {
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
            eligibleUsers.map((user) => (
              <Field orientation="horizontal" key={user.id} className="justify-between rounded-lg border p-3">
                <FieldLabel htmlFor={`permission-${user.id}`}>{user.username}</FieldLabel>
                <NativeSelect
                  id={`permission-${user.id}`}
                  value={rows[user.id] ?? 'none'}
                  disabled={busy}
                  onChange={(event) =>
                    setRows((current) => ({ ...current, [user.id]: event.target.value as PermissionValue }))
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

export default function App() {
  const [ready, setReady] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>('vaults');
  const [users, setUsers] = useState<User[]>([]);
  const [files, setFiles] = useState<AdminFile[]>([]);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [credentials, setCredentials] = useState<WebDavCredential[]>([]);
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

  async function refreshUsers() {
    setUsers(await api.listUsers());
  }

  async function refreshFiles() {
    setFiles(await api.listFiles(includeDeleted));
  }

  async function refreshWebDav() {
    setCredentials(await api.listWebDavCredentials());
  }

  async function refreshAll() {
    await Promise.all([refreshUsers(), refreshWebDav()]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await api.setupStatus();
        if (cancelled) return;
        if (status.requiresSetup) {
          setSetupRequired(true);
          return;
        }
        const me = await api.me();
        if (cancelled) return;
        if (me.role !== 'admin') {
          setUser(me);
          setForbidden(true);
          return;
        }
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
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !user || user.role !== 'admin') return;
    let cancelled = false;
    api
      .listFiles(includeDeleted)
      .then((result) => {
        if (!cancelled) setFiles(result);
      })
      .catch((error) => {
        if (!cancelled) setMessage({ kind: 'error', text: errorText(error, 'Unable to load vault files.') });
      });
    return () => {
      cancelled = true;
    };
  }, [includeDeleted, ready, user]);

  async function afterAuth(result: { user: User }) {
    setUser(result.user);
    setSetupRequired(false);
    setForbidden(false);
    await api.csrf();
    await refreshAll();
  }

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
      if (result.user.role !== 'admin') {
        setUser(result.user);
        setForbidden(true);
        return;
      }
      await afterAuth(result);
      form.reset();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Login failed.') });
    } finally {
      setBusy(null);
    }
  }

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

  async function handleLogout() {
    setForbidden(false);
    setMessage(null);
    setNewEmail('');
    setNewPassword('');
    setNewVaultPassword('');
    setWebdavPassword('');
    setUser(null);
    setUsers([]);
    setFiles([]);
    setCredentials([]);
    setPermFile(null);
    try {
      await api.logout();
    } catch {
      /* session may already be gone */
    }
  }

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
      onClick={() => setTheme(toggleTheme())}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </Button>
  );

  if (!ready || setupRequired || !user || forbidden) {
    return (
      <AuthLayout area="Admin" themeAction={themeAction}>
        {!ready ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading admin console…
          </p>
        ) : forbidden ? (
          <div className="grid gap-5">
            <h1 className="text-3xl font-semibold tracking-tight">Access restricted</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              This account is not an administrator. Use the vault webclient to access your shared files.
            </p>
            <Button variant="outline" onClick={handleLogout}>
              <LogOutIcon /> Sign out
            </Button>
          </div>
        ) : (
          <form className="grid gap-5" onSubmit={setupRequired ? handleSetup : handleLogin}>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                {setupRequired ? 'Initial setup' : 'Admin sign in'}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {setupRequired
                  ? 'Use the one-time token from the KeePort logs to create your first administrator account.'
                  : 'Sign in to manage vault files, users and WebDAV access.'}
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

  const currentSection = ADMIN_SECTIONS[tab];
  return (
    <SidebarProvider>
      <AdminNavigation
        tab={tab}
        username={user.username}
        onSelect={(next) => {
          setTab(next);
          setPermFile(null);
          setMessage(null);
        }}
      />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <SidebarTrigger />
          <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
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
          {message && (
            <Alert variant={message.kind === 'error' ? 'destructive' : 'default'}>
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
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
                    <form
                      className="grid gap-4"
                      onSubmit={(event) => {
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
                            onChange={(event) => setNewVaultName(event.target.value)}
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
                            onChange={(event) => setNewVaultPassword(event.target.value)}
                            required
                          />
                        </Field>
                      </FieldGroup>
                      <Button type="submit" size="sm" className="justify-self-start" disabled={busy !== null}>
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
                      onCheckedChange={(checked) => setIncludeDeleted(checked === true)}
                    />
                    <FieldLabel htmlFor="show-deleted">Show deleted</FieldLabel>
                  </Field>
                </CardHeader>
                <Table>
                  <TableHeader className="bg-muted/45">
                    <TableRow>
                      <TableHead className="ps-6">Name</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Rev</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!files.length && (
                      <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                          No vault files yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {files.map((file) => (
                      <FileRow
                        key={file.id}
                        file={file}
                        onChanged={refreshFiles}
                        setMessage={setMessage}
                        onOpenPermissions={setPermFile}
                      />
                    ))}
                  </TableBody>
                </Table>
              </Card>
              {permFile && (
                <PermissionPanel
                  key={permFile.id}
                  file={permFile}
                  users={users}
                  onClose={() => setPermFile(null)}
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
                        onChange={(event) => setNewUsername(event.target.value)}
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
                        onChange={(event) => setNewEmail(event.target.value)}
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
                        onChange={(event) => setNewPassword(event.target.value)}
                        required
                      />
                    </Field>
                    <Field className="w-auto">
                      <FieldLabel htmlFor="new-role">Role</FieldLabel>
                      <NativeSelect
                        id="new-role"
                        value={newRole}
                        onChange={(event) => setNewRole(event.target.value as 'admin' | 'user')}
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
                <Table>
                  <TableHeader className="bg-muted/45">
                    <TableRow>
                      <TableHead className="ps-6">User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Disabled</TableHead>
                      <TableHead>New password</TableHead>
                      <TableHead>Last login</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((item) => (
                      <UserRow
                        key={item.id}
                        user={item}
                        currentUserId={user.id}
                        onChanged={refreshUsers}
                        setMessage={setMessage}
                      />
                    ))}
                  </TableBody>
                </Table>
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
                        onChange={(event) => setWebdavUserId(event.target.value)}
                        required
                      >
                        <NativeSelectOption value="">Select user</NativeSelectOption>
                        {users
                          .filter((item) => !item.disabled)
                          .map((item) => (
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
                        onChange={(event) => setWebdavLabel(event.target.value)}
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
                        onChange={(event) => setWebdavPassword(event.target.value)}
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
                <Table>
                  <TableHeader className="bg-muted/45">
                    <TableRow>
                      <TableHead className="ps-6">Username</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!credentials.length && (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                          No WebDAV credentials yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {credentials.map((credential) => {
                      const owner = users.find((item) => item.id === credential.userId);
                      return (
                        <TableRow key={credential.id}>
                          <TableCell className="ps-6 font-medium">{credential.username}</TableCell>
                          <TableCell>{credential.label}</TableCell>
                          <TableCell>{owner?.username ?? credential.userId}</TableCell>
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
                                onConfirm={() => {
                                  void revokeWebDav(credential.id);
                                }}
                              />
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** Shows the three admin sections and closes the mobile navigation drawer after selection. */
function AdminNavigation({ tab, username, onSelect }: { tab: Tab; username: string; onSelect: (tab: Tab) => void }) {
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar variant="inset">
      <SidebarHeader className="p-3">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <KeyRoundIcon className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">KeePort</p>
            <p className="text-xs text-muted-foreground">Administration</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarMenu>
            {(Object.keys(ADMIN_SECTIONS) as Tab[]).map((section) => {
              const { title, icon: Icon } = ADMIN_SECTIONS[section];
              return (
                <SidebarMenuItem key={section}>
                  <SidebarMenuButton
                    type="button"
                    isActive={tab === section}
                    aria-current={tab === section ? 'page' : undefined}
                    onClick={() => {
                      if (section !== tab) onSelect(section);
                      setOpenMobile(false);
                    }}
                  >
                    <Icon />
                    <span>{title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t px-4 py-4">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <ShieldCheckIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate" title={username}>
            {username}
          </span>
          <Badge variant="outline" className="ms-auto">
            Admin
          </Badge>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
