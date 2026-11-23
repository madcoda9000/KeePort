import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Kdbx } from 'kdbxweb';
import { api, ApiError } from './lib/api';
import type { User, VaultFile } from './lib/api';
import { applyEntryEdits, clearVaultCredentials, createEntry, entryMatches, listEntries, loadVault, saveVault } from './lib/kdbx';
import type { EntryEdits, EntryView } from './lib/kdbx';
import { parseOtpSecret, totpCode } from './lib/totp';
import { toggleTheme } from './theme';

type Message = { kind: 'notice' | 'error'; text: string } | null;

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
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));

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
      setEdits(refreshed ? { title: refreshed.title, username: refreshed.username, password: refreshed.password, url: refreshed.url, notes: refreshed.notes, otp: refreshed.otp } : null);
      setMessage({ kind: 'notice', text: 'Vault saved.' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setMessage({ kind: 'error', text: `${error.message} Close and reopen the vault to load the latest version.` });
        try { await refreshFiles(); } catch { /* keep the original conflict message visible */ }
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
    setSelectedId(null);
    setFiles([]);
    setUser(null);
    try { await api.logout(); } catch { /* session may already be gone */ }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.me();
        await api.csrf();
        if (cancelled) return;
        setUser(me);
        await refreshFiles();
      } catch (error) {
        if (!cancelled && !(error instanceof ApiError && error.status === 401)) {
          setMessage({ kind: 'error', text: errorText(error, 'Unable to restore session.') });
        }
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!db) return;
    const onVisibility = () => {
      if (document.hidden) {
        clearVaultCredentials(db);
        setDb(null);
        setEntries([]);
        setSelectedEntry(null);
        setEdits(null);
        setPassword('');
        setKeyFile(null);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [db]);

  if (!authChecked) {
    return <div className="login-wrap"><div className="card login"><div className="brand"><div className="logo">K</div>KeePort Vault</div><p className="muted">Restoring secure session…</p></div></div>;
  }

  if (!user) {
    return (
      <div className="login-wrap">
        <form className="card login" onSubmit={handleLogin}>
          <div className="brand"><div className="logo">K</div>KeePort Vault</div>
          <h1>Unlock your vault</h1>
          <p className="muted">Sign in to see the KeePass files shared with your account. Vault contents are decrypted only in this browser.</p>
          {message?.kind === 'error' ? <div className="error">{message.text}</div> : null}
          <div className="field"><label htmlFor="username">Username</label><input id="username" name="username" autoComplete="username" required /></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
          <button className="button primary" disabled={busy === 'login'}>{busy === 'login' ? 'Signing in…' : 'Sign in'}</button>
          <p className="muted">First run? The administrator creates the initial admin account in the admin UI.</p>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><div className="logo">K</div>KeePort Vault</div>
        <div className="topbar-actions">
          <span className="user-chip">{user.username}</span>
          <button className="button ghost small" onClick={() => { toggleTheme(); setTheme((value) => (value === 'dark' ? 'light' : 'dark')); }}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
          <button className="button ghost small" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <main className="layout">
        <aside className="card sidebar">
          <h2>Vault files</h2>
          {message ? <div className={message.kind === 'error' ? 'error' : 'notice'}>{message.text}</div> : null}
          <div className="file-list">
            {files.length === 0 ? <div className="empty">No vault files are shared with your account yet.</div> : null}
            {files.map((file) => (
              <button key={file.id} className={`file-item ${file.id === selectedId ? 'active' : ''}`} onClick={() => selectFile(file)}>
                <strong>{file.name}</strong>
                <span className="file-meta">
                  <span className="badge write">{file.permission}</span>
                  <span>{formatBytes(file.size)}</span>
                  <span>rev {file.revision}</span>
                </span>
                <span className="muted">Updated {formatDate(file.updatedAt)}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="main">
          {!selectedFile ? (
            <div className="card empty">
              <h2>Select a vault file</h2>
              <p className="muted">Choose a shared .kdbx file from the left. You will unlock it locally with your master password or key file.</p>
            </div>
          ) : !unlocked ? (
            <form className="card login" onSubmit={handleUnlock}>
              <div>
                <h1>{selectedFile.name}</h1>
                <p className="muted">{selectedFile.permission === 'read-write' ? 'Read-write access' : 'Read-only access'} · {formatBytes(selectedFile.size)} · revision {selectedFile.revision}</p>
              </div>
              {message?.kind === 'error' ? <div className="error">{message.text}</div> : message?.kind === 'notice' ? <div className="notice">{message.text}</div> : null}
              <div className="field"><label htmlFor="master-password">Master password</label><input id="master-password" type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
              <div className="field"><label htmlFor="key-file">Key file</label><input id="key-file" type="file" onChange={(event) => setKeyFile(event.target.files?.[0] ?? null)} /></div>
              <div className="row">
                <button className="button primary" disabled={busy === 'unlock'}>{busy === 'unlock' ? 'Unlocking…' : 'Unlock vault'}</button>
                <button className="button ghost" type="button" onClick={() => selectFile(selectedFile)}>Reload file list</button>
              </div>
              <p className="muted">The password and key file are used only in this browser tab. They are never sent to KeePort.</p>
            </form>
          ) : (
            <>
              <div className="card toolbar" style={{ padding: 14 }}>
                <div className="field search" style={{ margin: 0 }}>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, username, URL, notes, tags…" />
                </div>
                <span className={`badge ${canWrite ? 'write' : 'read'}`}>{canWrite ? 'read-write' : 'read-only'}</span>
                <span className="muted">{visibleEntries.length} entries</span>
                <span className="spacer" />
                {canWrite ? <button className="button primary small" onClick={startNewEntry}>Add entry</button> : null}
                <button className="button danger small" onClick={() => lockVault(true)}>Lock vault</button>
              </div>

              <div className="entries">
                {visibleEntries.length === 0 ? <div className="card empty">No entries match your search.</div> : null}
                {visibleEntries.map((entry) => (
                  <button key={entry.id} className="entry-row card" onClick={() => { setSelectedEntry(entry); setEdits({ title: entry.title, username: entry.username, password: entry.password, url: entry.url, notes: entry.notes, otp: entry.otp }); }}>
                    <span className="entry-main">
                      <span className="entry-title">{entry.title}</span>
                      <span className="entry-sub">{entry.groupPath}</span>
                    </span>
                    <span className="entry-sub">{entry.username || '—'}</span>
                    <span className="entry-sub entry-pass">{entry.password ? '••••••••' : '—'}</span>
                    <span className="entry-sub">{entry.url || '—'}</span>
                  </button>
                ))}
              </div>

              {edits ? (
                <form className="card detail" onSubmit={handleSave}>
                  <div className="row">
                    <h3>{selectedEntry ? selectedEntry.title : 'New entry'}</h3>
                    <span className="spacer" />
                    <button className="button ghost small" type="button" onClick={() => { setSelectedEntry(null); setEdits(null); }}>Close</button>
                  </div>
                  {!canWrite ? <div className="notice">Read-only access: you can view this entry but cannot save changes.</div> : null}
                  {totp ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '1.25rem', fontFamily: 'monospace', letterSpacing: '0.15em' }}>{totp.code}</span>
                      <span style={{ opacity: 0.7 }}>{totp.secondsLeft}s</span>
                      <button className="button ghost small" type="button" onClick={() => navigator.clipboard?.writeText(totp.code).then(() => setMessage({ kind: 'notice', text: 'TOTP code copied.' })).catch(() => undefined)}>Copy code</button>
                    </div>
                  ) : null}
                  <div className="form-grid">
                    <div className="field"><label>Title</label><input value={edits.title} disabled={!canWrite} onChange={(event) => setEdits({ ...edits, title: event.target.value })} /></div>
                    <div className="field"><label>Username</label><input value={edits.username} disabled={!canWrite} onChange={(event) => setEdits({ ...edits, username: event.target.value })} /></div>
                    <div className="field"><label>Password</label><input type="password" value={edits.password} disabled={!canWrite} onChange={(event) => setEdits({ ...edits, password: event.target.value })} /></div>
                    <div className="field"><label>URL</label><input value={edits.url} disabled={!canWrite} onChange={(event) => setEdits({ ...edits, url: event.target.value })} /></div>
                    <div className="field full"><label>Notes</label><textarea value={edits.notes} disabled={!canWrite} onChange={(event) => setEdits({ ...edits, notes: event.target.value })} /></div>
                    <div className="field full"><label>TOTP (otpauth URI or base32 secret)</label><input value={edits.otp} disabled={!canWrite} onChange={(event) => setEdits({ ...edits, otp: event.target.value })} placeholder="otpauth://totp/…" /></div>
                  </div>
                  <div className="row">
                    {canWrite ? <button className="button primary" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : selectedEntry ? 'Save entry' : 'Create entry'}</button> : null}
                    <button className="button ghost" type="button" onClick={() => navigator.clipboard?.writeText(edits.username).then(() => setMessage({ kind: 'notice', text: 'Username copied.' })).catch(() => undefined)}>Copy username</button>
                    <button className="button ghost" type="button" onClick={() => navigator.clipboard?.writeText(edits.password).then(() => setMessage({ kind: 'notice', text: 'Password copied.' })).catch(() => undefined)}>Copy password</button>
                  </div>
                </form>
              ) : null}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
