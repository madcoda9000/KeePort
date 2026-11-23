import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Kdbx } from 'kdbxweb';
import { api, ApiError } from './lib/api';
import type { User, VaultFile } from './lib/api';
import {
  applyEntryEdits,
  clearVaultCredentials,
  createEntry,
  entryMatches,
  listEntries,
  loadVault,
  saveVault
} from './lib/kdbx';
import type { EntryEdits, EntryView } from './lib/kdbx';
import { parseOtpSecret, totpCode } from './lib/totp';
import { getTheme, toggleTheme } from './theme';
import {
  CopyIcon,
  DatabaseIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  LockKeyholeOpenIcon,
  LogOutIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  SunIcon,
  UserRoundIcon
} from 'lucide-react';
import { AuthLayout } from '@/components/auth-layout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type Message = { kind: 'notice' | 'error'; text: string } | null;

const DEFAULT_AUTO_LOCK_MINUTES = 5;

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [db, setDb] = useState<Kdbx | null>(null);
  const [entries, setEntries] = useState<EntryView[]>([]);
  const [etag, setEtag] = useState('');
  const [permission, setPermission] = useState<'read' | 'read-write'>('read');
  const [query, setQuery] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<EntryView | null>(null);
  const [edits, setEdits] = useState<EntryEdits | null>(null);
  const [totp, setTotp] = useState<{ code: string; secondsLeft: number } | null>(null);

  useEffect(() => {
    const config = edits?.otp ? parseOtpSecret(edits.otp) : null;
    if (!config) {
      setTotp(null);
      return;
    }
    let cancelled = false;
    const update = async () => {
      try {
        const result = await totpCode(config);
        if (!cancelled) setTotp(result);
      } catch {
        if (!cancelled) setTotp(null);
      }
    };
    void update();
    const timer = window.setInterval(() => void update(), 1000);
    return () => {
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

  const selectedFile = useMemo(() => files.find((file) => file.id === selectedId) ?? null, [files, selectedId]);
  const canWrite = permission === 'read-write';
  const unlocked = Boolean(db && selectedFile);
  const visibleEntries = useMemo(() => entries.filter((entry) => entryMatches(entry, query)), [entries, query]);

  async function refreshFiles() {
    const list = await api.listVaultFiles();
    setFiles(list);
  }

  function lockVault(notify = false) {
    clearVaultCredentials(db);
    setDb(null);
    setEntries([]);
    setSelectedEntry(null);
    setEdits(null);
    setQuery('');
    setTotp(null);
    setPassword('');
    setKeyFile(null);
    if (notify) setMessage({ kind: 'notice', text: 'Vault locked. Secrets were discarded from this browser tab.' });
  }

  function selectFile(file: VaultFile) {
    lockVault(false);
    setSelectedId(file.id);
    setPermission(file.permission);
    setEtag(file.etag);
    setMessage(null);
  }

  async function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) return;
    if (!password && !keyFile) {
      setMessage({ kind: 'error', text: 'Enter the master password or select a key file.' });
      return;
    }
    setBusy('unlock');
    setMessage(null);
    try {
      const content = await api.getFileBytes(selectedFile.id);
      const keyFileBytes = keyFile ? await keyFile.arrayBuffer() : null;
      const vault = await loadVault(content.bytes, password, keyFileBytes);
      const nextEntries = listEntries(vault);
      setDb(vault);
      setEntries(nextEntries);
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

  function startNewEntry() {
    setSelectedEntry(null);
    setEdits({ title: '', username: '', password: '', url: '', notes: '', otp: '' });
    setMessage(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db || !selectedFile || !edits) return;
    if (!canWrite) {
      setMessage({ kind: 'error', text: 'This vault is read-only for your account.' });
      return;
    }
    setBusy('save');
    setMessage(null);
    try {
      let entryId: string;
      if (selectedEntry) {
        applyEntryEdits(selectedEntry.entry, edits);
        entryId = selectedEntry.id;
      } else {
        entryId = createEntry(db, edits).uuid.id;
      }
      const bytes = await saveVault(db);
      const updated = await api.putFileBytes(selectedFile.id, bytes, etag);
      const nextEntries = listEntries(db);
      const refreshed = nextEntries.find((entry) => entry.id === entryId) ?? null;
      setFiles((current) => current.map((file) => (file.id === updated.id ? { ...file, ...updated } : file)));
      setEtag(updated.etag);
      setEntries(nextEntries);
      setSelectedEntry(refreshed);
      setEdits(
        refreshed
          ? {
              title: refreshed.title,
              username: refreshed.username,
              password: refreshed.password,
              url: refreshed.url,
              notes: refreshed.notes,
              otp: refreshed.otp
            }
          : null
      );
      setMessage({ kind: 'notice', text: 'Vault saved.' });
    } catch (error) {
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

  async function handleSaveAutoLock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const minutes = Number(new FormData(event.currentTarget).get('autoLockMinutes'));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setProfileMessage({ kind: 'error', text: 'Auto-lock must be between 1 and 1440 minutes.' });
      return;
    }
    setBusy('settings');
    setProfileMessage(null);
    try {
      const updated = await api.updateSettings({ autoLockMinutes: Math.round(minutes) });
      setUser(updated);
      setAutoLockMinutes(updated.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES);
      setProfileMessage({ kind: 'notice', text: 'Settings saved.' });
    } catch (error) {
      setProfileMessage({ kind: 'error', text: errorText(error, 'Unable to save settings.') });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!db) return;
    let lockTimer: number | undefined;
    const lock = () => {
      clearVaultCredentials(db);
      setDb(null);
      setEntries([]);
      setSelectedEntry(null);
      setEdits(null);
      setQuery('');
      setTotp(null);
      setPassword('');
      setKeyFile(null);
    };
    const onVisibility = () => {
      if (document.hidden) {
        lockTimer = window.setTimeout(lock, autoLockMinutes * 60 * 1000);
      } else if (lockTimer !== undefined) {
        window.clearTimeout(lockTimer);
        lockTimer = undefined;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (lockTimer !== undefined) window.clearTimeout(lockTimer);
    };
  }, [db, autoLockMinutes]);

  /** Copies a single entry value without showing it in feedback. */
  async function copyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage({ kind: 'notice', text: `${label} copied.` });
    } catch {
      setMessage({ kind: 'error', text: 'Clipboard unavailable. Use HTTPS or localhost and allow clipboard access.' });
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
        disabled={busy === 'unlock' || busy === 'save'}
        onSelect={selectFile}
      />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <SidebarTrigger />
          <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">Vault workspace</span>
          <Dialog
            open={showProfile}
            onOpenChange={(open) => {
              setShowProfile(open);
              if (open) setProfileMessage(null);
            }}
          >
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={`Open profile for ${user.username}`}>
                <UserRoundIcon />
                <span className="max-w-24 truncate max-sm:sr-only">{user.username}</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Account settings</DialogTitle>
                <DialogDescription>
                  Manage how your vault locks and how you sign in as {user.username}.
                </DialogDescription>
              </DialogHeader>
              {profileMessage && (
                <Alert variant={profileMessage.kind === 'error' ? 'destructive' : 'default'}>
                  <AlertDescription>{profileMessage.text}</AlertDescription>
                </Alert>
              )}
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
              <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
                {selectedFile?.name ?? 'Your vaults'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {selectedFile
                  ? 'Manage the entries in this KeePass file.'
                  : 'Open a shared KeePass file to view its entries.'}
              </p>
            </div>
            {selectedFile && (
              <Badge variant={unlocked ? 'secondary' : 'outline'}>
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
            <Alert variant={message.kind === 'error' ? 'destructive' : 'default'}>
              <AlertDescription>{message.text}</AlertDescription>
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
                <form className="grid gap-5" onSubmit={handleUnlock}>
                  <FieldGroup className="gap-4">
                    <Field>
                      <FieldLabel htmlFor="master-password">Master password</FieldLabel>
                      <Input
                        id="master-password"
                        type="password"
                        autoComplete="off"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="key-file">Key file</FieldLabel>
                      <Input
                        id="key-file"
                        type="file"
                        onChange={(event) => setKeyFile(event.target.files?.[0] ?? null)}
                      />
                    </Field>
                  </FieldGroup>
                  <Button type="submit" className="justify-self-start" disabled={busy === 'unlock'}>
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
                    <CardDescription>Entries</CardDescription>
                    <CardTitle className="text-xl tabular-nums">{entries.length}</CardTitle>
                  </CardHeader>
                </Card>
                <Card size="sm">
                  <CardHeader>
                    <CardDescription>Vault size</CardDescription>
                    <CardTitle className="text-xl tabular-nums">{formatBytes(selectedFile.size)}</CardTitle>
                  </CardHeader>
                </Card>
                <Card size="sm" className="col-span-2 lg:col-span-1">
                  <CardHeader>
                    <CardDescription>Last updated</CardDescription>
                    <CardTitle className="text-base">{formatDate(selectedFile.updatedAt)}</CardTitle>
                    <CardDescription>Revision {selectedFile.revision}</CardDescription>
                  </CardHeader>
                </Card>
              </div>
              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="gap-4 border-b py-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle>Vault entries</CardTitle>
                      <CardDescription>
                        {visibleEntries.length} of {entries.length} entries
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" disabled={busy === 'save'} onClick={() => lockVault(true)}>
                        <LockKeyholeIcon /> Lock vault
                      </Button>
                      {canWrite && (
                        <Button size="sm" disabled={busy === 'save'} onClick={startNewEntry}>
                          <PlusIcon /> Add entry
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="relative w-full sm:max-w-sm">
                    <SearchIcon
                      aria-hidden="true"
                      className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      className="ps-9"
                      type="search"
                      aria-label="Search entries"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search vault entries…"
                    />
                  </div>
                </CardHeader>
                <Table>
                  <TableHeader className="bg-muted/45">
                    <TableRow>
                      <TableHead className="ps-6">Title</TableHead>
                      <TableHead>Username</TableHead>
                      <TableHead className="hidden sm:table-cell">Password</TableHead>
                      <TableHead className="hidden md:table-cell">Website</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!visibleEntries.length && (
                      <TableRow>
                        <TableCell colSpan={4} className="h-28 text-center text-muted-foreground">
                          {query.trim() ? 'No entries match your search.' : 'This vault has no entries yet.'}
                        </TableCell>
                      </TableRow>
                    )}
                    {visibleEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="py-2 ps-3">
                          <Button
                            variant="ghost"
                            className="h-auto max-w-44 items-start gap-2 px-3 py-1.5 text-start sm:max-w-72"
                            onClick={() => {
                              setMessage(null);
                              setSelectedEntry(entry);
                              setEdits({
                                title: entry.title,
                                username: entry.username,
                                password: entry.password,
                                url: entry.url,
                                notes: entry.notes,
                                otp: entry.otp
                              });
                            }}
                          >
                            <KeyRoundIcon className="mt-0.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{entry.title}</span>
                              <span className="block truncate text-xs font-normal text-muted-foreground">
                                {entry.groupPath}
                              </span>
                            </span>
                          </Button>
                        </TableCell>
                        <TableCell className="max-w-32 truncate text-muted-foreground sm:max-w-52">
                          {entry.username || '—'}
                        </TableCell>
                        <TableCell className="hidden font-mono tracking-wider text-muted-foreground sm:table-cell">
                          {entry.password ? '••••••••' : '—'}
                        </TableCell>
                        <TableCell className="hidden max-w-56 truncate text-muted-foreground md:table-cell">
                          {entry.url || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

              <Sheet
                open={edits !== null}
                onOpenChange={(open) => {
                  if (!open && busy !== 'save') {
                    setSelectedEntry(null);
                    setEdits(null);
                  }
                }}
              >
                {edits && (
                  <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
                    <SheetHeader className="border-b p-6 pe-12">
                      <SheetTitle className="break-words">
                        {selectedEntry ? selectedEntry.title : 'New entry'}
                      </SheetTitle>
                      <SheetDescription>
                        {canWrite
                          ? 'Changes are encrypted in your browser before saving.'
                          : 'You can view and copy this entry, but you cannot edit it.'}
                      </SheetDescription>
                    </SheetHeader>
                    <form className="grid gap-5 p-6" onSubmit={handleSave}>
                      {message && (
                        <Alert variant={message.kind === 'error' ? 'destructive' : 'default'}>
                          <AlertDescription>{message.text}</AlertDescription>
                        </Alert>
                      )}
                      <FieldGroup className="gap-4">
                        <Field>
                          <FieldLabel htmlFor="entry-title">Title</FieldLabel>
                          <Input
                            id="entry-title"
                            value={edits.title}
                            readOnly={!canWrite}
                            onChange={(event) => setEdits({ ...edits, title: event.target.value })}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="entry-username">Username</FieldLabel>
                          <Input
                            id="entry-username"
                            value={edits.username}
                            readOnly={!canWrite}
                            onChange={(event) => setEdits({ ...edits, username: event.target.value })}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="entry-password">Password</FieldLabel>
                          <Input
                            id="entry-password"
                            type="password"
                            autoComplete="off"
                            value={edits.password}
                            readOnly={!canWrite}
                            onChange={(event) => setEdits({ ...edits, password: event.target.value })}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="entry-url">Website</FieldLabel>
                          <Input
                            id="entry-url"
                            value={edits.url}
                            readOnly={!canWrite}
                            onChange={(event) => setEdits({ ...edits, url: event.target.value })}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="entry-notes">Notes</FieldLabel>
                          <Textarea
                            id="entry-notes"
                            value={edits.notes}
                            readOnly={!canWrite}
                            onChange={(event) => setEdits({ ...edits, notes: event.target.value })}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="entry-otp">TOTP secret</FieldLabel>
                          <Input
                            id="entry-otp"
                            type="password"
                            autoComplete="off"
                            value={edits.otp}
                            readOnly={!canWrite}
                            onChange={(event) => setEdits({ ...edits, otp: event.target.value })}
                            aria-describedby="otp-help"
                          />
                          <FieldDescription id="otp-help">Use an otpauth URI or a Base32 secret.</FieldDescription>
                        </Field>
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
                            onClick={() => void copyValue(totp.code, 'TOTP code')}
                          >
                            <CopyIcon /> Copy code
                          </Button>
                        </div>
                      )}
                      <Separator />
                      <div className="flex flex-wrap gap-2">
                        {canWrite && (
                          <Button type="submit" disabled={busy === 'save'}>
                            {busy === 'save' ? 'Saving…' : selectedEntry ? 'Save entry' : 'Create entry'}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          disabled={!edits.username}
                          onClick={() => void copyValue(edits.username, 'Username')}
                        >
                          <CopyIcon /> Copy username
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          disabled={!edits.password}
                          onClick={() => void copyValue(edits.password, 'Password')}
                        >
                          <CopyIcon /> Copy password
                        </Button>
                      </div>
                    </form>
                  </SheetContent>
                )}
              </Sheet>
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** Lists the available vault files and dismisses the navigation drawer on mobile selection. */
function VaultNavigation({
  files,
  selectedId,
  disabled,
  onSelect
}: {
  files: VaultFile[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (file: VaultFile) => void;
}) {
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
            <p className="text-xs text-muted-foreground">Personal vault</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Shared vaults</SidebarGroupLabel>
          {!files.length && <p className="px-2 py-1 text-sm text-muted-foreground">No files available.</p>}
          <SidebarMenu>
            {files.map((file) => (
              <SidebarMenuItem key={file.id}>
                <SidebarMenuButton
                  type="button"
                  isActive={file.id === selectedId}
                  aria-current={file.id === selectedId ? 'true' : undefined}
                  disabled={disabled}
                  title={file.name}
                  onClick={() => {
                    if (file.id !== selectedId) onSelect(file);
                    setOpenMobile(false);
                  }}
                >
                  <DatabaseIcon />
                  <span>{file.name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t px-4 py-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheckIcon className="size-4" /> Decryption stays in this browser
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
