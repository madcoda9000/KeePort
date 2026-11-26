import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError, mfaApi, setCsrfToken } from './lib/api';
import type { AdminFile, AuthResponse, DataStorage, User, WebDavCredential } from './lib/api';
import { isMfaChallenge, type MfaChallenge } from '@shared/two-factor-api';
import { MfaChallengeForm, MfaSetupRequired, PasskeySignIn } from '@shared/two-factor';
import { EmailConfirmation } from '@shared/email-account';
import { createKdbxBytes } from './lib/kdbx';
import { getTheme, toggleTheme } from './theme';
import {
  DatabaseIcon,
  DownloadIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MailCheckIcon,
  MailWarningIcon,
  ScrollTextIcon,
  SendIcon,
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
import { EmailSettingsPanel } from '@/components/email-settings';
import { MfaSettingsPanel } from '@/components/mfa-settings';
import { WebDavLogsPanel } from '@/components/webdav-logs';
import { AuditLogPanel } from '@/components/audit-log';
import { AuditSettingsPanel } from '@/components/audit-settings';
import { VaultVersionsButton } from '@/components/vault-versions';
import { VersionSettingsPanel } from '@/components/version-settings';
import { applyAccountLanguage } from '@shared/i18n/language-select';
import { formatDateTime, formatNumber, translate } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';
import authText from '@/i18n/app-auth';
import commonText from '@/i18n/app-common';
import permissionsText from '@/i18n/app-permissions';
import sidebarText from '@/i18n/app-sidebar';
import usersText from '@/i18n/app-users';
import vaultsText from '@/i18n/app-vaults';
import webdavText from '@/i18n/app-webdav';
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
import { ACCENTS } from '@shared/accent';
import { cn } from '@/lib/utils';
import { InsecureContextAlert, hasBrowserCrypto } from '@shared/secure-context';
import { DataTable, type TableColumn } from '@shared/data-table';
import { matchesTableSearch, timestampSortValue } from '@shared/table-data';

type Message = { kind: 'notice' | 'error'; text: string } | null;
type Tab = 'dashboard' | 'vaults' | 'users' | 'webdav' | 'settings' | 'audit-log' | 'webdav-logs';
type PermissionValue = 'none' | 'read' | 'read-write';

/** Each section's icon and the catalog keys (app-sidebar) of its title and description, translated at render time. */
const ADMIN_SECTIONS = {
  dashboard: { title: 'dashboard', description: 'dashboardDescription', icon: LayoutDashboardIcon },
  vaults: { title: 'vaults', description: 'vaultsDescription', icon: DatabaseIcon },
  users: { title: 'users', description: 'usersDescription', icon: UsersIcon },
  webdav: { title: 'webdav', description: 'webdavDescription', icon: NetworkIcon },
  settings: { title: 'settings', description: 'settingsDescription', icon: SettingsIcon },
  'audit-log': { title: 'auditLog', description: 'auditLogDescription', icon: ShieldCheckIcon },
  'webdav-logs': { title: 'webdavLogs', description: 'webdavLogsDescription', icon: NetworkIcon }
} as const;

/** Sections listed directly under "Manage" in the navigation. */
const MANAGE_TABS: readonly Tab[] = ['dashboard', 'vaults', 'users', 'webdav', 'settings'];
/** Sections listed below the "Logs" navigation entry; the first one opens when "Logs" is selected. */
const LOG_TABS: readonly Tab[] = ['audit-log', 'webdav-logs'];

/**
 * Returns the visible deletion status of a vault in the current language.
 * @param file - The vault file metadata whose deletion status is shown.
 */
function fileStatus(file: AdminFile) {
  return file.deletedAt ? translate(vaultsText, 'deleted') : translate(commonText, 'active');
}

/** Builds the vault table's columns with headers in the current language. */
function vaultColumns(): readonly TableColumn<AdminFile>[] {
  return [
    /**
     * Sorts by vault filename.
     * @param file - The vault file metadata supplying this column's sort value.
     */
    { id: 'name', label: translate(vaultsText, 'name'), sortValue: (file) => file.name },
    /**
     * Sorts by file size in bytes.
     * @param file - The vault file metadata supplying this column's sort value.
     */
    { id: 'size', label: translate(vaultsText, 'size'), sortValue: (file) => file.size },
    /**
     * Sorts by content revision number.
     * @param file - The vault file metadata supplying this column's sort value.
     */
    { id: 'revision', label: translate(vaultsText, 'revision'), sortValue: (file) => file.revision },
    /**
     * Sorts by modification time, not the formatted date.
     * @param file - The vault file metadata supplying this column's sort value.
     */
    { id: 'updated', label: translate(vaultsText, 'updated'), sortValue: (file) => timestampSortValue(file.updatedAt) },
    /**
     * Sorts by the visible deletion status.
     * @param file - The vault file metadata supplying this column's sort value.
     */
    { id: 'status', label: translate(commonText, 'status'), sortValue: (file) => fileStatus(file) },
    { id: 'actions', label: translate(commonText, 'actions') }
  ];
}

/** Builds the account table's columns with headers in the current language. */
function accountColumns(): readonly TableColumn<User>[] {
  return [
    /**
     * Sorts by account username.
     * @param account - The account row supplying the displayed fields.
     */
    { id: 'user', label: translate(usersText, 'user'), sortValue: (account) => account.username },
    /**
     * Sorts by role name.
     * @param account - The account row supplying the displayed fields.
     */
    { id: 'role', label: translate(usersText, 'role'), sortValue: (account) => account.role },
    /**
     * Sorts enabled accounts before disabled accounts in ascending order.
     * @param account - The account row supplying the displayed fields.
     */
    { id: 'disabled', label: translate(usersText, 'disabled'), sortValue: (account) => Number(account.disabled) },
    /**
     * Sorts accounts without a second factor first in ascending order.
     * @param account - The account row supplying the displayed fields.
     */
    { id: 'twoFactor', label: translate(usersText, 'twoFactor'), sortValue: (account) => Number(account.twoFactor) },
    { id: 'newPassword', label: translate(usersText, 'newPassword') },
    /**
     * Sorts by the last sign-in time, leaving missing dates distinct.
     * @param account - The account row supplying the displayed fields.
     */
    { id: 'lastLogin', label: translate(usersText, 'lastLogin'), sortValue: (account) => timestampSortValue(account.lastLoginAt) },
    { id: 'actions', label: translate(commonText, 'actions') }
  ];
}

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
  const t = useT(commonText);
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
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
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
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  if (size < 1024) return translate(commonText, 'bytes', { size: formatNumber(size) });
  if (size < 1024 * 1024) return translate(commonText, 'kilobytes', { size: formatNumber(size / 1024, oneDecimal) });
  return translate(commonText, 'megabytes', { size: formatNumber(size / (1024 * 1024), oneDecimal) });
}

/**
 * Formats a timestamp for display or shows a placeholder if missing.
 * @param value - The timestamp string to format for the current locale.
 */
function formatDate(value: string | null) {
  if (!value) return '—';
  return formatDateTime(value, { dateStyle: 'short', timeStyle: 'medium' });
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
  const t = useT(usersText);
  const tc = useT(commonText);

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
      setMessage({ kind: 'notice', text: t('updated', { name: user.username }) });
      await onChanged();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, t('updateFailed')) });
    } finally {
      setBusy(false);
    }
  }

  /** Sends the user a new invitation link by e-mail. */
  async function invite() {
    setBusy(true);
    setMessage(null);
    try {
      await api.inviteUser(user.id);
      setMessage({ kind: 'notice', text: t('invitationSent', { email: user.email ?? '' }) });
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, t('inviteFailed')) });
    } finally {
      setBusy(false);
    }
  }

  /** Turns off the account's second factors and refreshes the list. */
  async function resetMfa() {
    setBusy(true);
    setMessage(null);
    try {
      await api.resetUserMfa(user.id);
      setMessage({ kind: 'notice', text: t('mfaReset', { name: user.username }) });
      await onChanged();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, t('resetMfaFailed')) });
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
      setMessage({ kind: 'notice', text: t('deleted', { name: user.username }) });
      await onChanged();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, t('deleteFailed')) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="max-w-48 truncate ps-6 font-medium" title={user.id}>
        {user.username}
        {user.email && (
          <div className="flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground">
            <span className="truncate" title={user.email}>{user.email}</span>
            {user.emailVerified ? (
              <Badge variant="outline" className={cn('shrink-0 gap-1 px-1.5 py-0 text-[0.7rem]', ACCENTS.emerald.badge)}>
                <MailCheckIcon /> {t('emailConfirmed')}
              </Badge>
            ) : (
              <Badge variant="outline" className={cn('shrink-0 gap-1 px-1.5 py-0 text-[0.7rem]', ACCENTS.amber.badge)}>
                <MailWarningIcon /> {t('emailNotConfirmed')}
              </Badge>
            )}
          </div>
        )}
      </TableCell>
      <TableCell>
        <NativeSelect
          aria-label={t('roleFor', { name: user.username })}
          value={role}
          onChange={/**
           * Updates the draft account role.
           * @param event - The account role selector change event.
           */ (event) => setRole(event.target.value as 'admin' | 'user')}
        >
          <NativeSelectOption value="admin">{t('roleAdmin')}</NativeSelectOption>
          <NativeSelectOption value="user">{t('roleUser')}</NativeSelectOption>
        </NativeSelect>
      </TableCell>
      <TableCell>
        <Checkbox
          aria-label={t('disableUser', { name: user.username })}
          checked={disabled}
          onCheckedChange={/**
           * Updates whether the draft account is disabled.
           * @param checked - The checkbox state indicating whether to disable the account.
           */ (checked) => setDisabled(checked === true)}
        />
      </TableCell>
      <TableCell>
        {user.twoFactor ? (
          <div className="flex items-center gap-1">
            <Badge variant="outline" className={cn('gap-1', ACCENTS.emerald.badge)}>
              <ShieldCheckIcon /> {t('twoFactorOn')}
            </Badge>
            <ConfirmAction
              label={t('resetMfa')}
              title={t('resetMfaTitle', { name: user.username })}
              description={t('resetMfaDescription')}
              disabled={busy}
              onConfirm={/** Resets the second factors after confirmation. */ () => {
                void resetMfa();
              }}
            />
          </div>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">{t('twoFactorOff')}</Badge>
        )}
      </TableCell>
      <TableCell>
        <Input
          className="min-w-32"
          aria-label={t('newPasswordFor', { name: user.username })}
          type="password"
          autoComplete="new-password"
          placeholder={t('unchanged')}
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
            {tc('save')}
          </Button>
          {user.role === 'user' && user.email && (
            <Button
              size="sm"
              variant="outline"
              title={t('sendInvitationTo', { email: user.email })}
              disabled={busy}
              onClick={/** Sends the user a new invitation link. */ () => void invite()}
            >
              <SendIcon />
              {t('sendInvitation')}
            </Button>
          )}
          <ConfirmAction
            label={tc('delete')}
            title={t('deleteTitle', { name: user.username })}
            description={t('deleteDescription')}
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
  const t = useT(vaultsText);
  const tc = useT(commonText);

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
      setMessage({ kind: 'error', text: errorText(error, t('actionFailed')) });
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
    if (name !== file.name) await run(/** Submits the new name for the selected vault. */ () => api.renameFile(file.id, name), t('renamed'));
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
      setMessage({ kind: 'notice', text: t('downloadStarted') });
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, t('downloadFailed')) });
    } finally {
      setBusy(false);
    }
  }

  /** Moves the selected vault to the deleted files list. */
  async function remove() {
    await run(/** Requests a soft deletion of the selected vault. */ () => api.deleteFile(file.id), t('movedToDeleted'));
  }

  /** Restores the selected vault to the active files list. */
  async function restore() {
    await run(/** Requests restoration of the selected vault. */ () => api.restoreFile(file.id), t('restored'));
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
        <Badge variant={file.deletedAt ? 'outline' : 'secondary'}>{fileStatus(file)}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {!file.deletedAt && (
            <Button variant="outline" size="sm" disabled={busy} onClick={/** Opens the permissions editor for this vault. */ () => onOpenPermissions(file)}>
              {t('permissions')}
            </Button>
          )}
          <VaultVersionsButton file={file} onChanged={onChanged} onMessage={setMessage} disabled={busy} />
          {!file.deletedAt && (
            <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy}>
                  {t('rename')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('renameTitle')}</DialogTitle>
                  <DialogDescription>{t('renameDescription')}</DialogDescription>
                </DialogHeader>
                <form className="grid gap-4" onSubmit={rename}>
                  <Field>
                    <FieldLabel htmlFor={`rename-${file.id}`}>{t('fileName')}</FieldLabel>
                    <Input id={`rename-${file.id}`} name="name" defaultValue={file.name} required />
                  </Field>
                  <Button type="submit" className="justify-self-end">
                    {t('saveName')}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('downloadFile', { name: file.name })}
            title={t('download')}
            disabled={busy}
            onClick={download}
          >
            <DownloadIcon />
          </Button>
          {file.deletedAt ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={restore}>
              <RotateCcwIcon /> {t('restore')}
            </Button>
          ) : (
            <ConfirmAction
              label={tc('delete')}
              title={t('deleteTitle')}
              description={t('deleteDescription', { name: file.name })}
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
  const t = useT(permissionsText);
  const tc = useT(commonText);
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
        if (!cancelled) setErrorMessage(errorText(error, translate(permissionsText, 'loadFailed')));
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
      setMessage({ kind: 'notice', text: t('updated', { name: file.name }) });
      onClose();
    } catch (error) {
      setErrorMessage(errorText(error, t('saveFailed')));
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
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description', { name: file.name })}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 p-6">
          {errorMessage && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
          {busy && !loaded && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('loading')}
            </p>
          )}
          {loaded && !eligibleUsers.length && (
            <Alert>
              <AlertDescription>{t('noAccounts')}</AlertDescription>
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
                  <NativeSelectOption value="none">{t('none')}</NativeSelectOption>
                  <NativeSelectOption value="read">{t('read')}</NativeSelectOption>
                  <NativeSelectOption value="read-write">{t('readWrite')}</NativeSelectOption>
                </NativeSelect>
              </Field>
            ))}
          {loaded && eligibleUsers.length > 0 && (
            <Button className="justify-self-start" disabled={busy} onClick={save}>
              {busy ? tc('saving') : t('save')}
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
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [mfaSetup, setMfaSetup] = useState(false);
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
  const t = useT(sidebarText);
  const ta = useT(authText);
  const tc = useT(commonText);
  const tv = useT(vaultsText);
  const tu = useT(usersText);
  const tw = useT(webdavText);

  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [newInvite, setNewInvite] = useState(false);

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
        applyAccountLanguage(me.language);
        if (me.mfaSetupRequired) {
          setMfaSetup(true);
          return;
        }
        await refreshAll();
      } catch (error) {
        if (!cancelled && !(error instanceof ApiError && error.status === 401)) {
          setMessage({ kind: 'error', text: errorText(error, translate(sidebarText, 'loadFailed')) });
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
        if (!cancelled) setMessage({ kind: 'error', text: errorText(error, translate(vaultsText, 'loadFailed')) });
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
    applyAccountLanguage(result.user.language);
    setSetupRequired(false);
    setChallenge(null);
    if (result.user.mfaSetupRequired) {
      // Until a second factor is set up, the server only answers the setup requests.
      setMfaSetup(true);
      return;
    }
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
      form.reset();
      if (isMfaChallenge(result)) {
        setChallenge(result);
        return;
      }
      await afterAuth(result);
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, ta('loginFailed')) });
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
      setMessage({ kind: 'error', text: errorText(error, ta('setupFailed')) });
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

  /**
   * Continues after the second factor was accepted.
   * @param result - The session's account and CSRF token.
   */
  async function afterMfa(result: AuthResponse) {
    setCsrfToken(result.csrfToken);
    await afterAuth(result);
  }

  /** Clears local admin state and ends the server session if it still exists. */
  async function handleLogout() {
    setMfaSetup(false);
    setChallenge(null);
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
      const invite = newInvite && newRole === 'user';
      const email = newEmail.trim();
      await api.createUser(invite
        ? { username: newUsername, email, role: newRole, invite: true }
        : { username: newUsername, email, password: newPassword, role: newRole });
      setNewUsername('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('user');
      setNewInvite(false);
      setMessage({ kind: 'notice', text: invite ? tu('invitationSent', { email }) : tu('created') });
      await refreshUsers();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, tu('createFailed')) });
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
      setMessage({ kind: 'notice', text: tv('uploaded', { name: file.name }) });
      await refreshFiles();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, tv('uploadFailed')) });
    } finally {
      setBusy(null);
    }
  }

  /** Creates an encrypted KDBX in the browser and uploads the resulting file. */
  async function handleCreateVault() {
    if (!newVaultName.trim() || !newVaultPassword) {
      setMessage({ kind: 'error', text: tv('nameAndPasswordRequired') });
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
      setMessage({ kind: 'notice', text: tv('created') });
      await refreshFiles();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, tv('createFailed')) });
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
      setMessage({ kind: 'error', text: tw('required') });
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
        text: tw('createdNotice')
      });
      await refreshWebDav();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, tw('createFailed')) });
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
      setMessage({ kind: 'notice', text: tw('revokedNotice') });
      await refreshWebDav();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, tw('revokeFailed')) });
    } finally {
      setBusy(null);
    }
  }

  const themeAction = (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={theme === 'dark' ? t('switchToLight') : t('switchToDark')}
      title={theme === 'dark' ? t('lightMode') : t('darkMode')}
      onClick={/** Toggles the theme and updates the workspace controls. */ () => setTheme(toggleTheme())}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </Button>
  );

  if (challenge && !user) {
    return (
      <AuthLayout area="Admin" themeAction={themeAction}>
        <MfaChallengeForm<AuthResponse>
          challenge={challenge}
          api={mfaApi}
          onSignedIn={afterMfa}
          onCancel={/** Returns to the sign-in form. */ () => setChallenge(null)}
        />
      </AuthLayout>
    );
  }

  if (user && mfaSetup) {
    return (
      <AuthLayout area="Admin" themeAction={themeAction}>
        <MfaSetupRequired
          username={user.username}
          api={mfaApi}
          onDone={/** Opens the console now that a second factor is set up. */ () => {
            setMfaSetup(false);
            setUser({ ...user, twoFactor: true, mfaSetupRequired: false });
            void refreshAll();
          }}
          onSignOut={/** Signs out instead. */ () => void handleLogout()}
          emailVerified={user.emailVerified}
          emailConfirmation={
            <EmailConfirmation
              email={user.email}
              verified={user.emailVerified}
              onRequestCode={/** Sends a confirmation code to the admin's address. */ () => api.requestEmailVerification()}
              onVerify={/**
               * Confirms the address and shows the updated account.
               * @param code - The 6-digit code.
               */ async (code) => setUser(await api.verifyEmail(code))}
            />
          }
        />
      </AuthLayout>
    );
  }

  if (!ready || setupRequired || !user) {
    return (
      <AuthLayout area="Admin" themeAction={themeAction}>
        {!ready ? (
          <p role="status" className="text-sm text-muted-foreground">
            {ta('loading')}
          </p>
        ) : (
          <form className="grid gap-5" onSubmit={setupRequired ? handleSetup : handleLogin}>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                {setupRequired ? ta('initialSetup') : ta('adminSignIn')}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {setupRequired
                  ? ta('setupIntro')
                  : ta('signInIntro')}
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
                  <FieldLabel htmlFor="setupToken">{ta('setupToken')}</FieldLabel>
                  <Input id="setupToken" name="setupToken" autoComplete="off" required />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="username">{ta('username')}</FieldLabel>
                <Input id="username" name="username" autoComplete="username" required />
              </Field>
              {setupRequired && (
                <Field>
                  <FieldLabel htmlFor="setup-email">{ta('email')}</FieldLabel>
                  <Input id="setup-email" name="email" type="email" autoComplete="email" maxLength={254} required />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="password">{ta('password')}</FieldLabel>
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
                  ? ta('creating')
                  : ta('createAdmin')
                : busy === 'login'
                  ? ta('signingIn')
                  : ta('signIn')}
            </Button>
            {!setupRequired && (
              <PasskeySignIn<AuthResponse>
                api={mfaApi}
                onSignedIn={afterMfa}
                onError={/**
                 * Shows why the passkey sign-in failed.
                 * @param text - The message.
                 */ (text) => setMessage({ kind: 'error', text })}
              />
            )}
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
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{t('adminConsole')}</span>
          {themeAction}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('signOut')}
            title={t('signOut')}
            disabled={busy !== null}
            onClick={handleLogout}
          >
            <LogOutIcon />
          </Button>
        </header>
        <div className="mx-auto grid w-full max-w-7xl gap-6 p-4 sm:p-6 lg:p-8">
          <div className="space-y-1">
            <div className="text-xs font-medium tracking-widest text-muted-foreground uppercase">{t('administration')}</div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t(currentSection.title)}</h1>
            <p className="text-sm text-muted-foreground">{t(currentSection.description)}</p>
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
              <EmailSettingsPanel />
              <MfaSettingsPanel />
              <RateLimitSettingsPanel />
              <VersionSettingsPanel />
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
                    <CardTitle>{tv('createTitle')}</CardTitle>
                    <CardDescription>{tv('createDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!browserCrypto && (
                      <div className="mb-4">
                        <InsecureContextAlert action={tv('creatingAction')} />
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
                          <FieldLabel htmlFor="vault-name">{tv('vaultName')}</FieldLabel>
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
                          <FieldLabel htmlFor="vault-master-password">{tv('masterPassword')}</FieldLabel>
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
                        {busy === 'create-vault' ? tc('creating') : tv('createKdbx')}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{tv('uploadTitle')}</CardTitle>
                    <CardDescription>{tv('uploadDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Field className="max-w-sm">
                      <FieldLabel htmlFor="vault-upload">
                        <UploadIcon className="size-4" /> {tv('kdbxFile')}
                      </FieldLabel>
                      <Input
                        type="file"
                        id="vault-upload"
                        accept=".kdbx"
                        onChange={handleUpload}
                        disabled={busy !== null}
                      />
                      <FieldDescription>
                        {busy === 'upload' ? tv('uploading') : tv('uploadHint')}
                      </FieldDescription>
                    </Field>
                  </CardContent>
                </Card>
              </div>
              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="flex flex-wrap items-center justify-between gap-3 border-b py-5">
                  <div className="space-y-1">
                    <CardTitle>{tv('storedVaults')}</CardTitle>
                    <CardDescription>{tv('fileCount', { count: files.length })}</CardDescription>
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
                    <FieldLabel htmlFor="show-deleted">{tv('showDeleted')}</FieldLabel>
                  </Field>
                </CardHeader>
                <DataTable
                  label={tv('storedVaults')}
                  rows={files}
                  columns={vaultColumns()}
                  searchLabel={tv('search')}
                  emptyMessage={tv('empty')}
                  matches={/**
                   * Searches the visible filename, size, revision, date, and status fields.
                   * @param file - The vault row whose displayed metadata is searched.
                   * @param query - The search text to match against the row.
                   */ (file, query) => matchesTableSearch(
                    query, file.name, formatBytes(file.size), file.revision, formatDate(file.updatedAt), fileStatus(file)
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
                  <CardTitle>{tu('createTitle')}</CardTitle>
                  <CardDescription>
                    {tu('createDescription')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="flex flex-wrap items-end gap-4" onSubmit={handleCreateUser}>
                    <Field className="w-full sm:w-48">
                      <FieldLabel htmlFor="new-username">{tu('username')}</FieldLabel>
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
                      <FieldLabel htmlFor="new-user-email">{tu('email')}</FieldLabel>
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
                    {!(newInvite && newRole === 'user') && (
                      <Field className="w-full sm:w-48">
                        <FieldLabel htmlFor="new-user-password">{tu('password')}</FieldLabel>
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
                    )}
                    <Field className="w-auto">
                      <FieldLabel htmlFor="new-role">{tu('role')}</FieldLabel>
                      <NativeSelect
                        id="new-role"
                        value={newRole}
                        onChange={/**
                         * Updates the initial role for the new account.
                         * @param event - The new account role selector change event.
                         */ (event) => setNewRole(event.target.value as 'admin' | 'user')}
                      >
                        <NativeSelectOption value="user">{tu('roleUser')}</NativeSelectOption>
                        <NativeSelectOption value="admin">{tu('roleAdmin')}</NativeSelectOption>
                      </NativeSelect>
                    </Field>
                    {newRole === 'user' && (
                      <Field orientation="horizontal" className="w-full">
                        <Checkbox
                          id="new-user-invite"
                          checked={newInvite}
                          onCheckedChange={/**
                           * Chooses between an e-mail invitation and an initial password.
                           * @param checked - The checkbox state; true sends an invitation.
                           */ (checked) => setNewInvite(checked === true)}
                        />
                        <FieldLabel htmlFor="new-user-invite" className="font-normal">{tu('inviteInstead')}</FieldLabel>
                      </Field>
                    )}
                    <Button type="submit" disabled={busy === 'create-user'}>
                      <PlusIcon />
                      {busy === 'create-user' ? tc('creating') : tu('createUser')}
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="gap-1 border-b py-5">
                  <CardTitle>{tu('accounts')}</CardTitle>
                  <CardDescription>{tu('accountCount', { count: users.length })}</CardDescription>
                </CardHeader>
                <DataTable
                  label={tu('accounts')}
                  rows={users}
                  columns={accountColumns()}
                  searchLabel={tu('search')}
                  emptyMessage={tu('empty')}
                  matches={/**
                   * Searches the displayed account details.
                   * @param account - The account row supplying the displayed fields.
                   * @param query - The search text to match against the row.
                   */ (account, query) => matchesTableSearch(
                    query, account.username, account.email, account.role, account.disabled ? tu('disabled') : tu('enabled'), formatDate(account.lastLoginAt)
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
                  <CardTitle>{tw('createTitle')}</CardTitle>
                  <CardDescription>
                    {tw('createDescription')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="flex flex-wrap items-end gap-4" onSubmit={handleCreateWebDav}>
                    <Field className="w-full sm:w-44">
                      <FieldLabel htmlFor="webdav-user">{tw('user')}</FieldLabel>
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
                        <NativeSelectOption value="">{tw('selectUser')}</NativeSelectOption>
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
                      <FieldLabel htmlFor="webdav-label">{tw('label')}</FieldLabel>
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
                      <FieldLabel htmlFor="webdav-password">{tw('appPassword')}</FieldLabel>
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
                      {busy === 'create-webdav' ? tc('creating') : tw('createCredential')}
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="gap-1 border-b py-5">
                  <CardTitle>{tw('listTitle')}</CardTitle>
                  <CardDescription>{tw('listDescription')}</CardDescription>
                </CardHeader>
                <DataTable
                  label={tw('listTitle')}
                  rows={credentials}
                  columns={[
                    /**
                     * Sorts by the WebDAV login name.
                     * @param item - The WebDAV credential supplying this column's sort value.
                     */
                    { id: 'username', label: tw('username'), sortValue: (item) => item.username },
                    /**
                     * Sorts by the credential label.
                     * @param item - The WebDAV credential supplying this column's sort value.
                     */
                    { id: 'label', label: tw('label'), sortValue: (item) => item.label },
                    /**
                     * Sorts by the owner's displayed name, falling back to the owner ID.
                     * @param item - The WebDAV credential supplying this column's sort value.
                     */
                    { id: 'user', label: tw('user'), sortValue: (item) => usernamesById.get(item.userId) ?? item.userId },
                    /**
                     * Sorts by credential creation time.
                     * @param item - The WebDAV credential supplying this column's sort value.
                     */
                    { id: 'created', label: tw('created'), sortValue: (item) => timestampSortValue(item.createdAt) },
                    /**
                     * Sorts by the last use time, leaving unused credentials distinct.
                     * @param item - The WebDAV credential supplying this column's sort value.
                     */
                    { id: 'lastUsed', label: tw('lastUsed'), sortValue: (item) => timestampSortValue(item.lastUsedAt) },
                    /**
                     * Sorts by the visible revocation status.
                     * @param item - The WebDAV credential supplying this column's sort value.
                     */
                    { id: 'status', label: tc('status'), sortValue: (item) => item.revokedAt ? tw('revoked') : tc('active') },
                    { id: 'actions', label: tc('actions') }
                  ]}
                  searchLabel={tw('search')}
                  emptyMessage={tw('empty')}
                  matches={/**
                   * Searches visible credential metadata without using its password.
                   * @param item - The credential whose displayed metadata is searched.
                   * @param query - The search text to match against the row.
                   */ (item, query) => matchesTableSearch(
                    query, item.username, item.label, usernamesById.get(item.userId) ?? item.userId,
                    formatDate(item.createdAt), formatDate(item.lastUsedAt), item.revokedAt ? tw('revoked') : tc('active')
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
                          {credential.revokedAt ? tw('revoked') : tc('active')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {!credential.revokedAt && (
                          <ConfirmAction
                            label={tw('revoke')}
                            title={tw('revokeTitle')}
                            description={tw('revokeDescription', { name: credential.username })}
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
  const t = useT(sidebarText);

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
            <p className="text-xs text-muted-foreground">{t('administration')}</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('manage')}</SidebarGroupLabel>
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
                    <span>{t(title)}</span>
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
                <span>{t('logs')}</span>
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
                        <span>{t(ADMIN_SECTIONS[section].title)}</span>
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
