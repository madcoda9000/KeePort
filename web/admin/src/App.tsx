import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from './lib/api';
import type { AdminFile, User, WebDavCredential } from './lib/api';
import { createKdbxBytes } from './lib/kdbx';
import { toggleTheme } from './theme';

type Message = { kind: 'notice' | 'error'; text: string } | null;
type Tab = 'vaults' | 'users' | 'webdav';
type PermissionValue = 'none' | 'read' | 'read-write';

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

function UserRow({ user, currentUserId, onChanged, setMessage }: { user: User; currentUserId: string; onChanged: () => Promise<void>; setMessage: (message: Message) => void }) {
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
    if (!window.confirm(`Delete user ${user.username}?`)) return;
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
    <tr>
      <td><strong>{user.username}</strong><div className="muted">{user.id}</div></td>
      <td>
        <select value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'user')}>
          <option value="admin">admin</option>
          <option value="user">user</option>
        </select>
      </td>
      <td><input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} /></td>
      <td><input type="password" placeholder="New password" value={password} onChange={(event) => setPassword(event.target.value)} /></td>
      <td className="muted">{formatDate(user.lastLoginAt)}</td>
      <td>
        <div className="actions">
          <button className="button small" disabled={!changed || busy} onClick={save}>Save</button>
          <button className="button danger small" disabled={user.id === currentUserId || busy} onClick={remove}>Delete</button>
        </div>
      </td>
    </tr>
  );
}

function FileRow({ file, onChanged, setMessage, onOpenPermissions }: { file: AdminFile; onChanged: () => Promise<void>; setMessage: (message: Message) => void; onOpenPermissions: (file: AdminFile) => void }) {
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

  async function rename() {
    const name = window.prompt('Rename vault file', file.name);
    if (!name || name === file.name) return;
    await run(() => api.renameFile(file.id, name), 'Vault renamed.');
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
    if (!window.confirm(`Move ${file.name} to deleted vaults?`)) return;
    await run(() => api.deleteFile(file.id), 'Vault moved to deleted vaults.');
  }

  async function restore() {
    await run(() => api.restoreFile(file.id), 'Vault restored.');
  }

  return (
    <tr>
      <td><strong>{file.name}</strong><div className="muted">{file.id}</div></td>
      <td>{formatBytes(file.size)}</td>
      <td>{file.revision}</td>
      <td>{formatDate(file.updatedAt)}</td>
      <td>{file.deletedAt ? <span className="badge read">deleted</span> : <span className="badge write">active</span>}</td>
      <td>
        <div className="actions">
          {!file.deletedAt ? <button className="button small" disabled={busy} onClick={() => onOpenPermissions(file)}>ACL</button> : null}
          {!file.deletedAt ? <button className="button small" disabled={busy} onClick={rename}>Rename</button> : null}
          <button className="button small" disabled={busy} onClick={download}>Download</button>
          {!file.deletedAt ? <button className="button danger small" disabled={busy} onClick={remove}>Delete</button> : <button className="button small" disabled={busy} onClick={restore}>Restore</button>}
        </div>
      </td>
    </tr>
  );
}

function PermissionPanel({ file, users, onClose, setMessage }: { file: AdminFile; users: User[]; onClose: () => void; setMessage: (message: Message) => void }) {
  const [rows, setRows] = useState<Record<string, PermissionValue>>({});
  const [busy, setBusy] = useState(false);
  const eligibleUsers = useMemo(() => users.filter((user) => user.role === 'user' && !user.disabled), [users]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const permissions = await api.getPermissions(file.id);
        if (cancelled) return;
        const next: Record<string, PermissionValue> = {};
        for (const user of eligibleUsers) next[user.id] = 'none';
        for (const permission of permissions) {
          if (permission.permission === 'read' || permission.permission === 'read-write') next[permission.userId] = permission.permission;
        }
        setRows(next);
      } catch (error) {
        if (!cancelled) setMessage({ kind: 'error', text: errorText(error, 'Unable to load permissions.') });
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file.id, eligibleUsers, setMessage]);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await api.setPermissions(file.id, Object.entries(rows).map(([userId, permission]) => ({ userId, permission })));
      setMessage({ kind: 'notice', text: `Permissions updated for ${file.name}.` });
      onClose();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Unable to save permissions.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card panel">
      <div className="row">
        <h3>ACL for {file.name}</h3>
        <span className="spacer" />
        <button className="button ghost small" onClick={onClose}>Close</button>
      </div>
      <p className="muted">Admins always have read-write access. Normal users only see vault files with an explicit permission.</p>
      {eligibleUsers.length === 0 ? <div className="empty">No active normal users exist yet.</div> : null}
      <div className="permission-grid">
        {eligibleUsers.map((user) => (
          <div className="permission-row" key={user.id}>
            <strong>{user.username}</strong>
            <select value={rows[user.id] ?? 'none'} disabled={busy} onChange={(event) => setRows((current) => ({ ...current, [user.id]: event.target.value as PermissionValue }))}>
              <option value="none">none</option>
              <option value="read">read</option>
              <option value="read-write">read-write</option>
            </select>
          </div>
        ))}
      </div>
      <div className="row">
        <button className="button primary" disabled={busy || eligibleUsers.length === 0} onClick={save}>{busy ? 'Saving…' : 'Save permissions'}</button>
      </div>
    </div>
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
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));

  const [newUsername, setNewUsername] = useState('');
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
    await Promise.all([refreshUsers(), refreshFiles(), refreshWebDav()]);
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
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!includeDeleted) return;
    refreshFiles().catch((error) => setMessage({ kind: 'error', text: errorText(error, 'Unable to load vault files.') }));
  }, [includeDeleted]);

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
      const result = await api.login({ username: String(data.get('username') ?? ''), password: String(data.get('password') ?? '') });
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
    setUser(null);
    setUsers([]);
    setFiles([]);
    setCredentials([]);
    setPermFile(null);
    try { await api.logout(); } catch { /* session may already be gone */ }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('create-user');
    setMessage(null);
    try {
      await api.createUser({ username: newUsername, password: newPassword, role: newRole });
      setNewUsername('');
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
      const fileName = newVaultName.trim().toLowerCase().endsWith('.kdbx') ? newVaultName.trim() : `${newVaultName.trim()}.kdbx`;
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
      setMessage({ kind: 'notice', text: 'WebDAV credential created. Give the user the WebDAV username and app password.' });
      await refreshWebDav();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error, 'Unable to create WebDAV credential.') });
    } finally {
      setBusy(null);
    }
  }

  async function revokeWebDav(id: string) {
    if (!window.confirm('Revoke this WebDAV credential?')) return;
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

  if (!ready) {
    return <div className="login-wrap"><div className="card login"><div className="brand"><div className="logo">K</div>KeePort Admin</div><p className="muted">Loading…</p></div></div>;
  }

  if (setupRequired) {
    return (
      <div className="login-wrap">
        <form className="card login" onSubmit={handleSetup}>
          <div className="brand"><div className="logo">K</div>KeePort Admin</div>
          <h1>Initial setup</h1>
          <p className="muted">Enter the one-time setup token from the KeePort logs, then create the first admin account.</p>
          {message?.kind === 'error' ? <div className="error">{message.text}</div> : null}
          <div className="field"><label htmlFor="setupToken">Setup token</label><input id="setupToken" name="setupToken" required /></div>
          <div className="field"><label htmlFor="username">Admin username</label><input id="username" name="username" autoComplete="username" required /></div>
          <div className="field"><label htmlFor="password">Admin password</label><input id="password" name="password" type="password" autoComplete="new-password" required /></div>
          <button className="button primary" disabled={busy === 'setup'}>{busy === 'setup' ? 'Creating…' : 'Create admin'}</button>
        </form>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-wrap">
        <form className="card login" onSubmit={handleLogin}>
          <div className="brand"><div className="logo">K</div>KeePort Admin</div>
          <h1>Admin sign in</h1>
          <p className="muted">This area is for administrators only. Keep it on LAN/VPN or behind a protected reverse proxy.</p>
          {message?.kind === 'error' ? <div className="error">{message.text}</div> : null}
          <div className="field"><label htmlFor="username">Username</label><input id="username" name="username" autoComplete="username" required /></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
          <button className="button primary" disabled={busy === 'login'}>{busy === 'login' ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="login-wrap">
        <div className="card login">
          <div className="brand"><div className="logo">K</div>KeePort Admin</div>
          <h1>Forbidden</h1>
          <p className="muted">Your account does not have the admin role. Use the vault webclient instead.</p>
          <button className="button" onClick={handleLogout}>Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><div className="logo">K</div>KeePort Admin</div>
        <div className="topbar-actions">
          <span className="user-chip">{user.username} · admin</span>
          <button className="button ghost small" onClick={() => { toggleTheme(); setTheme((value) => (value === 'dark' ? 'light' : 'dark')); }}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
          <button className="button ghost small" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <main className="layout" style={{ gridTemplateColumns: '1fr' }}>
        <section className="main" style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          {message ? <div className={message.kind === 'error' ? 'error' : 'notice'}>{message.text}</div> : null}
          <div className="tabs">
            <button className={`tab ${tab === 'vaults' ? 'active' : ''}`} onClick={() => setTab('vaults')}>Vault files</button>
            <button className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>Users</button>
            <button className={`tab ${tab === 'webdav' ? 'active' : ''}`} onClick={() => setTab('webdav')}>WebDAV credentials</button>
          </div>

          {tab === 'vaults' ? (
            <>
              <div className="card panel">
                <h2>Vault files</h2>
                <div className="inline-form">
                  <div className="field"><label>New vault name</label><input value={newVaultName} onChange={(event) => setNewVaultName(event.target.value)} placeholder="family.kdbx" /></div>
                  <div className="field"><label>Master password</label><input type="password" value={newVaultPassword} onChange={(event) => setNewVaultPassword(event.target.value)} /></div>
                  <button className="button primary" disabled={busy === 'create-vault'} onClick={handleCreateVault}>{busy === 'create-vault' ? 'Creating…' : 'Create KDBX'}</button>
                  <label className="button">Upload .kdbx<input type="file" accept=".kdbx" hidden onChange={handleUpload} /></label>
                  <label className="row muted"><input type="checkbox" checked={includeDeleted} onChange={(event) => setIncludeDeleted(event.target.checked)} style={{ width: 'auto' }} /> Show deleted</label>
                </div>
                <p className="muted">New vaults are created locally in your browser with kdbxweb and uploaded encrypted. KeePort never sees the master password.</p>
              </div>

              <div className="card panel">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Name</th><th>Size</th><th>Rev</th><th>Updated</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {files.length === 0 ? <tr><td colSpan={6}><div className="empty">No vault files yet.</div></td></tr> : null}
                      {files.map((file) => <FileRow key={file.id} file={file} onChanged={refreshFiles} setMessage={setMessage} onOpenPermissions={(selected) => setPermFile(selected)} />)}
                    </tbody>
                  </table>
                </div>
              </div>

              {permFile ? <PermissionPanel file={permFile} users={users} onClose={() => setPermFile(null)} setMessage={setMessage} /> : null}
            </>
          ) : null}

          {tab === 'users' ? (
            <>
              <div className="card panel">
                <h2>Create user</h2>
                <form className="inline-form" onSubmit={handleCreateUser}>
                  <div className="field"><label>Username</label><input value={newUsername} onChange={(event) => setNewUsername(event.target.value)} required /></div>
                  <div className="field"><label>Password</label><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></div>
                  <div className="field"><label>Role</label><select value={newRole} onChange={(event) => setNewRole(event.target.value as 'admin' | 'user')}><option value="user">user</option><option value="admin">admin</option></select></div>
                  <button className="button primary" disabled={busy === 'create-user'}>{busy === 'create-user' ? 'Creating…' : 'Create user'}</button>
                </form>
              </div>
              <div className="card panel">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>User</th><th>Role</th><th>Disabled</th><th>New password</th><th>Last login</th><th>Actions</th></tr></thead>
                    <tbody>
                      {users.map((item) => <UserRow key={item.id} user={item} currentUserId={user.id} onChanged={refreshUsers} setMessage={setMessage} />)}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'webdav' ? (
            <>
              <div className="card panel">
                <h2>Create WebDAV credential</h2>
                <form className="inline-form" onSubmit={handleCreateWebDav}>
                  <div className="field"><label>User</label><select value={webdavUserId} onChange={(event) => setWebdavUserId(event.target.value)}><option value="">Select user</option>{users.filter((item) => !item.disabled).map((item) => <option key={item.id} value={item.id}>{item.username}</option>)}</select></div>
                  <div className="field"><label>Label</label><input value={webdavLabel} onChange={(event) => setWebdavLabel(event.target.value)} placeholder="iPhone KeePassium" /></div>
                  <div className="field"><label>App password</label><input type="password" value={webdavPassword} onChange={(event) => setWebdavPassword(event.target.value)} /></div>
                  <button className="button primary" disabled={busy === 'create-webdav'}>{busy === 'create-webdav' ? 'Creating…' : 'Create credential'}</button>
                </form>
                <p className="muted">WebDAV uses separate app passwords. They are hashed with Argon2id and can be revoked independently from the web login.</p>
              </div>
              <div className="card panel">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Username</th><th>Label</th><th>User</th><th>Created</th><th>Last used</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {credentials.length === 0 ? <tr><td colSpan={7}><div className="empty">No WebDAV credentials yet.</div></td></tr> : null}
                      {credentials.map((credential) => {
                        const owner = users.find((item) => item.id === credential.userId);
                        return (
                          <tr key={credential.id}>
                            <td><strong>{credential.username}</strong><div className="muted">{credential.id}</div></td>
                            <td>{credential.label}</td>
                            <td>{owner?.username ?? credential.userId}</td>
                            <td>{formatDate(credential.createdAt)}</td>
                            <td>{formatDate(credential.lastUsedAt)}</td>
                            <td>{credential.revokedAt ? <span className="badge read">revoked</span> : <span className="badge write">active</span>}</td>
                            <td><div className="actions">{!credential.revokedAt ? <button className="button danger small" disabled={busy === 'revoke-webdav'} onClick={() => revokeWebDav(credential.id)}>Revoke</button> : null}</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
