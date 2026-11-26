import { translateServerMessage } from '@shared/i18n/messages/server-errors';
export interface User {
  id: string;
  username: string;
  email: string | null;
  role: 'admin' | 'user';
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** The interface language stored on the account, or null to follow the browser. */
  language?: 'de' | 'en' | 'fr' | null;
  /** Whether the account's e-mail address has been confirmed with a code. */
  emailVerified: boolean;
  /** Whether the account gets an e-mail on sign-ins from a new browser. */
  notifySignIn: boolean;
  /** Whether the account gets an e-mail when an app password is created for it. */
  notifyAppPassword: boolean;
}

/** How KeePort sends e-mail and which admin warnings it sends. */
export interface EmailSettings {
  host: string | null;
  port: number;
  security: 'starttls' | 'ssl' | 'none';
  username: string | null;
  /** Always null from the server; on save null keeps the stored password, '' removes it, a string replaces it. */
  password: string | null;
  hasPassword: boolean;
  fromAddress: string | null;
  fromName: string | null;
  publicUrl: string | null;
  warnFailedSignIns: boolean;
  warnCertificate: boolean;
  warnStorage: boolean;
  warnDiskSpace: boolean;
}

/** The e-mail settings together with whether they are complete and the state of the outgoing queue. */
export interface EmailSettingsResponse {
  settings: EmailSettings;
  configured: boolean;
  queue: {
    waiting: number;
    sentLast7Days: number;
    failedLast7Days: number;
    lastSentAt: string | null;
    lastError: string | null;
  };
}

export interface AuthResponse {
  user: User;
  csrfToken: string;
}

export interface AdminFile {
  id: string;
  name: string;
  size: number;
  revision: number;
  etag: string;
  createdAt: string;
  updatedAt: string;
  permission: string;
  deletedAt: string | null;
}

export interface FilePermission {
  userId: string;
  username: string;
  permission: 'read' | 'read-write';
  updatedAt: string;
}

export interface RateLimitSettings {
  authPerMinute: number;
  webDavPerMinute: number;
}

export interface DataStorage {
  kind: 'hostFolder' | 'dockerVolume' | 'notMounted' | 'unknown';
  dataDir: string;
  source: string | null;
  volumeName: string | null;
  needsAttention: boolean;
}

export interface LoginCounts {
  success: number;
  failure: number;
}

export interface DashboardData {
  generatedAt: string;
  server: {
    version: string;
    commit: string | null;
    runtime: string;
    operatingSystem: string;
    inDocker: boolean;
    startedAt: string;
    uptimeSeconds: number;
    addresses: string[];
    vaultPorts: number[];
    adminPorts: number[];
    adminHttps: boolean;
    adminCertificateFingerprint: string | null;
    adminCertificateNotAfter: string | null;
    trustedProxies: string;
  };
  storage: DataStorage;
  counts: {
    vaults: number;
    deletedVaults: number;
    conflictCopies: number;
    users: number;
    disabledUsers: number;
    admins: number;
    disabledAdmins: number;
    activeWebDavCredentials: number;
    webDavRequestsLast24Hours: number;
    webDavErrorsLast24Hours: number;
    webDavStaleWritesLast24Hours: number;
    lastWebDavRequestAt: string | null;
  } | null;
  logins: {
    since: string;
    adminLast24Hours: LoginCounts;
    adminLast7Days: LoginCounts;
    vaultLast24Hours: LoginCounts;
    vaultLast7Days: LoginCounts;
  } | null;
  errors: string[];
}

/** One revision of a vault: the current one or a kept earlier version. */
export interface VaultVersion {
  revision: number;
  size: number;
  savedAt: string;
  savedBy: string | null;
  source: string | null;
}

/** The current revision and the kept earlier versions of a vault, newest first. */
export interface VaultVersions {
  current: VaultVersion;
  versions: VaultVersion[];
}

/** How many earlier versions are kept per vault, for how many days, and the space they use. */
export interface VersionSettings {
  maxCount: number;
  maxDays: number;
  usedBytes: number;
}

/** The area an audit log entry belongs to. */
export type AuditCategory = 'auth' | 'account' | 'user' | 'vault' | 'webdav' | 'settings';

/** One audit log entry: who did what, to which object, with which result. */
export interface AuditEntry {
  id: number;
  occurredAt: string;
  category: AuditCategory;
  action: string;
  success: boolean;
  actorId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  details: string | null;
  remoteIp: string | null;
  userAgent: string | null;
}

/** Filters for listing or exporting the audit log; empty values do not filter. */
export interface AuditFilter {
  actor?: string;
  action?: string;
  category?: string;
  from?: string;
  to?: string;
  failedOnly?: boolean;
  search?: string;
}

/** One page of the audit log with headline counts and the known action tags. */
export interface AuditPage {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  stats: { total: number; last24Hours: number; last7Days: number; failedSignIns24Hours: number };
  actions: { action: string; category: AuditCategory }[];
}

export interface WebDavRequestLogEntry {
  id: number;
  occurredAt: string;
  method: string;
  path: string;
  status: number;
  credential: string | null;
  remoteIp: string | null;
  durationMs: number;
  contentLength: number | null;
  ifMatch: boolean;
  depth: string | null;
  destination: string | null;
  overwrite: string | null;
}

export interface WebDavCredential {
  id: string;
  userId: string;
  username: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export class ApiError extends Error {
  status: number;

  /**
   * Creates an API error carrying the server's HTTP status.
   * @param message - The message extracted from the failed response.
   * @param status - The failure HTTP status code.
   */
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let csrfToken = '';

/**
 * Stores the admin session's CSRF token for later mutations.
 * @param token - The current session's CSRF token, or an empty string to clear it.
 */
export function setCsrfToken(token: string) {
  csrfToken = token;
}

/**
 * Adds the admin CSRF token to mutating requests when one is available.
 * @param init - The fetch options, including headers, method, and body where applicable.
 */
function buildHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const method = (init.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  return headers;
}

/**
 * Extracts the server's error message and HTTP status from a failed response.
 * @param response - The non-success HTTP response to decode.
 */
async function parseError(response: Response): Promise<ApiError> {
  const text = await response.text();
  let message = response.statusText || 'Request failed';
  if (text) {
    try {
      const data = JSON.parse(text) as { message?: string; error?: string };
      message = data.message || data.error || message;
    } catch {
      message = text.slice(0, 200) || message;
    }
  }
  return new ApiError(translateServerMessage(message), response.status);
}

/**
 * Sends a same-origin admin request, handles errors, and reads JSON when present.
 * @param path - The same-origin API path to request.
 * @param init - The fetch options, including headers, method, and body where applicable.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include', headers: buildHeaders(init) });
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const AUTH_PATH = '/api/admin/auth';
const RATE_LIMITS_PATH = '/api/admin/settings/rate-limits';
const EMAIL_SETTINGS_PATH = '/api/admin/settings/email';

export const api = {
  /** Checks whether an administrator needs to complete first-run setup. */
  async setupStatus() {
    return request<{ requiresSetup: boolean; hasUsers: boolean }>(`${AUTH_PATH}/setup-status`);
  },
  /**
   * Creates the first admin account and stores the issued CSRF token.
   * @param payload - The setup token and new administrator's username, contact email, and password.
   */
  async setup(payload: { setupToken: string; username: string; email: string; password: string }) {
    const result = await request<AuthResponse>(`${AUTH_PATH}/setup`, { method: 'POST', body: JSON.stringify(payload) });
    setCsrfToken(result.csrfToken);
    return result;
  },
  /**
   * Signs in to the Admin API and stores the issued CSRF token.
   * @param payload - The username and password to verify for this application.
   */
  async login(payload: { username: string; password: string }) {
    const result = await request<AuthResponse>(`${AUTH_PATH}/login`, { method: 'POST', body: JSON.stringify(payload) });
    setCsrfToken(result.csrfToken);
    return result;
  },
  /** Ends the administrator session and clears the stored CSRF token. */
  async logout() {
    await request<void>(`${AUTH_PATH}/logout`, { method: 'POST' });
    setCsrfToken('');
  },
  /** Fetches the currently signed-in administrator. */
  async me() {
    return request<User>(`${AUTH_PATH}/me`);
  },
  /** Fetches and stores the CSRF token for an existing admin session. */
  async csrf() {
    const result = await request<{ csrfToken: string }>(`${AUTH_PATH}/csrf`);
    setCsrfToken(result.csrfToken);
    return result.csrfToken;
  },

  /**
   * Changes the signed-in admin's login password.
   * @param payload - The current login password and the requested replacement.
   */
  async changePassword(payload: { currentPassword: string; newPassword: string }) {
    await request<void>(`${AUTH_PATH}/change-password`, { method: 'POST', body: JSON.stringify(payload) });
  },
  /**
   * Saves the signed-in admin's contact email.
   * @param email - The new contact email for the signed-in account.
   */
  async updateLanguage(language: 'de' | 'en' | 'fr' | null) {
    return request<User>(`${AUTH_PATH}/language`, { method: 'PUT', body: JSON.stringify({ language }) });
  },
  async updateEmail(email: string) {
    return request<User>(`${AUTH_PATH}/email`, { method: 'PUT', body: JSON.stringify({ email }) });
  },
  /** Asks the server to send a confirmation code to the signed-in admin's e-mail address. */
  async requestEmailVerification() {
    await request<void>(`${AUTH_PATH}/email/verification`, { method: 'POST' });
  },
  /**
   * Confirms the signed-in admin's e-mail address with the code from the e-mail.
   * @param code - The 6-digit code.
   */
  async verifyEmail(code: string) {
    return request<User>(`${AUTH_PATH}/email/verify`, { method: 'POST', body: JSON.stringify({ code }) });
  },
  /**
   * Saves which security notifications the signed-in admin gets by e-mail.
   * @param payload - Notify about sign-ins from new browsers and about new app passwords.
   */
  async updateNotifications(payload: { signIn: boolean; appPassword: boolean }) {
    return request<User>(`${AUTH_PATH}/notifications`, { method: 'PUT', body: JSON.stringify(payload) });
  },

  /**
   * Loads the e-mail settings, whether they are complete, and the queue status.
   * @param signal - An optional signal for aborting the request.
   */
  async getEmailSettings(signal?: AbortSignal) {
    return request<EmailSettingsResponse>(EMAIL_SETTINGS_PATH, { signal });
  },
  /**
   * Saves the e-mail settings and returns them with the new status.
   * @param settings - The settings; password null keeps the stored one, '' removes it.
   */
  async updateEmailSettings(settings: EmailSettings) {
    return request<EmailSettingsResponse>(EMAIL_SETTINGS_PATH, { method: 'PUT', body: JSON.stringify(settings) });
  },
  /** Sends a test e-mail to the signed-in admin's own address and returns the recipient. */
  async sendTestEmail() {
    return request<{ sentTo: string }>(`${EMAIL_SETTINGS_PATH}/test`, { method: 'POST' });
  },

  /**
   * Loads the current login and WebDAV limits.
   * @param signal - An optional signal for aborting the settings request.
   */
  async getRateLimits(signal?: AbortSignal) {
    return request<RateLimitSettings>(RATE_LIMITS_PATH, { signal });
  },
  /**
   * Saves both per-minute limits using the current admin session.
   * @param settings - The authentication and WebDAV request limits in requests per minute.
   */
  async updateRateLimits(settings: RateLimitSettings) {
    return request<RateLimitSettings>(RATE_LIMITS_PATH, { method: 'PUT', body: JSON.stringify(settings) });
  },

  /** Lists accounts visible to the administrator. */
  async listUsers() {
    return request<User[]>('/api/admin/users');
  },
  /**
   * Creates an account with the supplied login details and role.
   * @param payload - The username, contact email, initial password or invite flag, and role of the new account.
   */
  async createUser(payload: { username: string; email: string; password?: string; role: 'admin' | 'user'; invite?: boolean }) {
    return request<User>('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
  },
  /**
   * Sends a user a new invitation link by e-mail.
   * @param id - The ID of the account to invite.
   */
  async inviteUser(id: string) {
    await request<void>(`/api/admin/users/${encodeURIComponent(id)}/invite`, { method: 'POST' });
  },
  /**
   * Applies the supplied account edits, leaving omitted fields unchanged.
   * @param id - The ID of the account to update.
   * @param payload - The desired role, disabled flag, or password changes; omitted fields are unchanged.
   */
  async updateUser(id: string, payload: { role?: 'admin' | 'user'; disabled?: boolean; password?: string }) {
    return request<User>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  /**
   * Deletes the account identified by its ID.
   * @param id - The ID of the account to delete.
   */
  async deleteUser(id: string) {
    await request<void>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /**
   * Lists vault metadata, optionally including deleted files.
   * @param includeDeleted - Whether to include soft-deleted vaults in the list.
   */
  async listFiles(includeDeleted = false) {
    return request<AdminFile[]>(`/api/admin/files?includeDeleted=${includeDeleted ? 'true' : 'false'}`);
  },
  /**
   * Uploads an encrypted vault with an optional display name as multipart data.
   * @param file - The encrypted KDBX file selected for upload.
   * @param name - A replacement filename, if the uploaded name should not be used.
   */
  async uploadFile(file: File, name?: string) {
    const form = new FormData();
    form.append('file', file);
    const query = name ? `?name=${encodeURIComponent(name)}` : '';
    return request<AdminFile>(`/api/admin/files${query}`, { method: 'POST', body: form });
  },
  /**
   * Downloads the encrypted vault file as a Blob.
   * @param id - The ID of the vault file to update or retrieve.
   */
  /**
   * Lists the current revision and the kept earlier versions of a vault.
   * @param id - The vault's ID.
   */
  async listVersions(id: string) {
    return request<VaultVersions>(`/api/admin/files/${encodeURIComponent(id)}/versions`);
  },
  /**
   * Downloads one kept earlier version.
   * @param id - The vault's ID.
   * @param revision - The revision number.
   */
  async downloadVersion(id: string, revision: number): Promise<Blob> {
    const response = await fetch(`/api/admin/files/${encodeURIComponent(id)}/versions/${revision}/content`, { credentials: 'include' });
    if (!response.ok) throw await parseError(response);
    return response.blob();
  },
  /**
   * Restores an earlier version as a new revision and returns the vault afterwards.
   * @param id - The vault's ID.
   * @param revision - The revision to restore.
   */
  async restoreVersion(id: string, revision: number) {
    return request<AdminFile>(`/api/admin/files/${encodeURIComponent(id)}/versions/${revision}/restore`, { method: 'POST' });
  },
  /** Reads how many versions are kept and how much space they use. */
  async getVersionSettings(signal?: AbortSignal) {
    return request<VersionSettings>('/api/admin/settings/versions', { signal });
  },
  /**
   * Changes how many versions are kept.
   * @param settings - The new limits.
   */
  async updateVersionSettings(settings: { maxCount: number; maxDays: number }) {
    return request<VersionSettings>('/api/admin/settings/versions', { method: 'PUT', body: JSON.stringify(settings) });
  },
  async downloadFile(id: string): Promise<Blob> {
    const response = await fetch(`/api/admin/files/${encodeURIComponent(id)}/content`, { credentials: 'include' });
    if (!response.ok) throw await parseError(response);
    return response.blob();
  },
  /**
   * Changes a vault's display name and returns its updated metadata.
   * @param id - The ID of the vault file to update or retrieve.
   * @param name - The display filename for the vault, including its .kdbx extension when supplied.
   */
  async renameFile(id: string, name: string) {
    return request<AdminFile>(`/api/admin/files/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  },
  /**
   * Soft-deletes the specified vault.
   * @param id - The ID of the vault file to update or retrieve.
   */
  async deleteFile(id: string) {
    await request<void>(`/api/admin/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  /**
   * Restores a deleted vault and returns its current metadata.
   * @param id - The ID of the vault file to update or retrieve.
   */
  async restoreFile(id: string) {
    return request<AdminFile>(`/api/admin/files/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  },
  /**
   * Fetches the access list for the specified vault.
   * @param fileId - The ID of the vault file.
   */
  async getPermissions(fileId: string) {
    return request<FilePermission[]>(`/api/admin/files/${encodeURIComponent(fileId)}/permissions`);
  },
  /**
   * Replaces the vault's access grants, omitting entries set to no access.
   * @param fileId - The ID of the vault file.
   * @param permissions - The full replacement access list; entries set to no access are omitted.
   */
  async setPermissions(fileId: string, permissions: { userId: string; permission: 'read' | 'read-write' | 'none' }[]) {
    const filtered = permissions.filter(/**
     * Excludes draft entries without a grant from the replacement ACL.
     * @param permission - One proposed user grant from the access-list draft.
     */ (permission) => permission.permission !== 'none');
    return request<FilePermission[]>(`/api/admin/files/${encodeURIComponent(fileId)}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions: filtered.map(/**
       * Converts each remaining grant to the permissions request shape.
       * @param permission - One proposed user grant from the access-list draft.
       */ (permission) => ({ userId: permission.userId, permission: permission.permission === 'read' ? 'read' : 'read-write' })) })
    });
  },

  /** Lists WebDAV credential metadata. */
  async listWebDavCredentials() {
    return request<WebDavCredential[]>('/api/admin/webdav-credentials');
  },
  /**
   * Creates a WebDAV credential for the requested owner.
   * @param payload - The owning user ID, human-readable label, and password for the credential.
   */
  async createWebDavCredential(payload: { userId: string; label: string; password: string }) {
    return request<WebDavCredential>('/api/admin/webdav-credentials', { method: 'POST', body: JSON.stringify(payload) });
  },
  /**
   * Revokes the specified WebDAV credential.
   * @param id - The ID of the credential to revoke.
   */
  async revokeWebDavCredential(id: string) {
    await request<void>(`/api/admin/webdav-credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /**
   * Loads the admin dashboard: server status, data storage, totals and sign-in counts.
   * @param signal - An optional signal that aborts the request when the caller no longer needs it.
   */
  async getDashboard(signal?: AbortSignal) {
    return request<DashboardData>('/api/admin/dashboard', { signal });
  },

  /**
   * Reports where KeePort keeps its data: host folder, Docker volume or not mounted.
   * @param signal - An optional signal that aborts the request when the caller no longer needs it.
   */
  async getDataStorage(signal?: AbortSignal) {
    return request<DataStorage>('/api/admin/settings/storage', { signal });
  },

  /**
   * Lists the retained WebDAV request log, newest first.
   * @param signal - An optional signal that aborts the request when the caller no longer needs it.
   */
  async listWebDavLogs(signal?: AbortSignal) {
    return request<WebDavRequestLogEntry[]>('/api/admin/logs/webdav', { signal });
  },

  async listAudit(filter: AuditFilter, page: number, pageSize: number, signal?: AbortSignal) {
    return request<AuditPage>(`/api/admin/logs/audit?${auditQuery(filter, { page: String(page), pageSize: String(pageSize) })}`, { signal });
  },
  async downloadAuditCsv(filter: AuditFilter): Promise<Blob> {
    const response = await fetch(`/api/admin/logs/audit.csv?${auditQuery(filter)}`, { credentials: 'include' });
    if (!response.ok) throw await parseError(response);
    return response.blob();
  },
  async getAuditSettings(signal?: AbortSignal) {
    return request<{ retentionDays: number }>('/api/admin/settings/audit', { signal });
  },
  async updateAuditSettings(retentionDays: number) {
    return request<{ retentionDays: number }>('/api/admin/settings/audit', { method: 'PUT', body: JSON.stringify({ retentionDays }) });
  }
};

/**
 * Builds the query string of the audit log endpoints, leaving out empty filters.
 * @param filter - The filters to send.
 * @param extra - Further parameters such as the page.
 */
function auditQuery(filter: AuditFilter, extra: Record<string, string> = {}) {
  const query = new URLSearchParams(extra);
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === '' || value === false) continue;
    query.set(key, String(value));
  }
  return query.toString();
}
