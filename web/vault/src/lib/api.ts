import { translateServerMessage } from '@shared/i18n/messages/server-errors';
/** One sign-in attempt on the user's own account. */
export interface SignIn {
  occurredAt: string;
  success: boolean;
  channel: string | null;
  remoteIp: string | null;
  userAgent: string | null;
}

export interface User {
  id: string;
  username: string;
  email: string | null;
  role: 'admin' | 'user';
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  autoLockMinutes: number | null;
  /** Whether the web vault loads website icons directly from the sites (opt-in). */
  showFavicons: boolean;
  /** Seconds until copied values are cleared from the clipboard; null for the default, 0 for off. */
  clipboardClearSeconds: number | null;
  /** Whether the web vault checks passwords against "Have I Been Pwned" (opt-in). */
  checkBreaches: boolean;
  /** The interface language stored on the account, or null to follow the browser. */
  language: 'de' | 'en' | 'fr' | null;
  /** Whether the account's e-mail address has been confirmed with a code or a link. */
  emailVerified: boolean;
  /** Whether the account gets an e-mail on sign-ins from a new browser or device. */
  notifySignIn: boolean;
  /** Whether the account gets an e-mail when an app password is created for it. */
  notifyAppPassword: boolean;
}

/** What an invitation or password reset link is for, and for which account. */
export interface PasswordLinkInfo {
  purpose: 'invite' | 'reset';
  username: string;
}

export interface VaultFile {
  id: string;
  name: string;
  size: number;
  revision: number;
  etag: string;
  createdAt: string;
  updatedAt: string;
  permission: 'read' | 'read-write';
}

export interface AuthResponse {
  user: User;
  csrfToken: string;
}

export class ApiError extends Error {
  status: number;
  currentETag?: string;

  /**
   * Creates an API error carrying the HTTP status and optional current ETag.
   * @param message - The message extracted from the failed response.
   * @param status - The failure HTTP status code.
   * @param currentETag - The current entity tag returned by the server, if available.
   */
  constructor(message: string, status: number, currentETag?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.currentETag = currentETag;
  }
}

let csrfToken = '';

/**
 * Stores the vault session's CSRF token for later mutations.
 * @param token - The current session's CSRF token, or an empty string to clear it.
 */
export function setCsrfToken(token: string) {
  csrfToken = token;
}

/** Returns the CSRF token currently held in memory. */
export function getCsrfToken() {
  return csrfToken;
}

/**
 * Adds the vault CSRF token to mutating requests when one is available.
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
 * Extracts the response error and any current ETag supplied for a conflict.
 * @param response - The non-success HTTP response to decode.
 */
async function parseError(response: Response): Promise<ApiError> {
  const text = await response.text();
  let message = response.statusText || 'Request failed';
  let currentETag: string | undefined;
  if (text) {
    try {
      const data = JSON.parse(text) as { message?: string; error?: string; currentETag?: string };
      message = data.message || data.error || message;
      currentETag = data.currentETag;
    } catch {
      message = text.slice(0, 200) || message;
    }
  }
  return new ApiError(translateServerMessage(message), response.status, currentETag);
}

/**
 * Sends a same-origin vault request and decodes its response or error.
 * @param path - The same-origin API path to request.
 * @param init - The fetch options, including headers, method, and body where applicable.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: buildHeaders(init)
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  /**
   * Signs in to the Vault API and stores the issued CSRF token.
   * @param payload - The username and password to verify for this application.
   */
  async login(payload: { username: string; password: string }) {
    const result = await request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setCsrfToken(result.csrfToken);
    return result;
  },
  /** Ends the vault session and clears the stored CSRF token. */
  async logout() {
    await request<void>('/api/auth/logout', { method: 'POST' });
    setCsrfToken('');
  },
  /** Fetches the currently signed-in vault user. */
  async me() {
    return request<User>('/api/auth/me');
  },
  /** Fetches and stores the CSRF token for an existing vault session. */
  async csrf() {
    const result = await request<{ csrfToken: string }>('/api/auth/csrf');
    setCsrfToken(result.csrfToken);
    return result.csrfToken;
  },
  /**
   * Submits a login password change using the current password.
   * @param payload - The current login password and the requested replacement.
   */
  /**
   * Lists the latest sign-in attempts on the signed-in account, newest first.
   * @param signal - Aborts the request when the list is no longer shown.
   */
  async listSignIns(signal?: AbortSignal) {
    return request<SignIn[]>('/api/auth/sign-ins', { signal });
  },
  async changePassword(payload: { currentPassword: string; newPassword: string }) {
    await request<void>('/api/auth/change-password', { method: 'POST', body: JSON.stringify(payload) });
  },
  /**
   * Saves the signed-in account's email and returns the updated user.
   * @param email - The new contact email for the signed-in account.
   */
  /**
   * Stores the interface language on the account; null follows the browser.
   * @param language - de, en or fr, or null.
   */
  async updateLanguage(language: 'de' | 'en' | 'fr' | null) {
    return request<User>('/api/auth/language', { method: 'PUT', body: JSON.stringify({ language }) });
  },
  async updateEmail(email: string) {
    return request<User>('/api/auth/email', { method: 'PUT', body: JSON.stringify({ email }) });
  },
  /**
   * Sends a 6-digit code to the signed-in account's e-mail address, to confirm it.
   */
  async requestEmailCode() {
    await request<void>('/api/auth/email/verification', { method: 'POST' });
  },
  /**
   * Confirms the signed-in account's e-mail address with the code from the e-mail and returns the updated user.
   * @param code - The 6-digit code.
   */
  async verifyEmail(code: string) {
    return request<User>('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ code }) });
  },
  /**
   * Chooses which security notifications the signed-in account gets by e-mail and returns the updated user.
   * @param payload - Whether to notify about sign-ins from new browsers and about new app passwords.
   */
  async updateNotifications(payload: { signIn: boolean; appPassword: boolean }) {
    return request<User>('/api/auth/notifications', { method: 'PUT', body: JSON.stringify(payload) });
  },
  /**
   * Asks for a password reset link; the server answers the same whether or not an account matches.
   * @param identifier - The username or e-mail address the user entered.
   */
  async requestPasswordReset(identifier: string) {
    await request<void>('/api/auth/password-reset', { method: 'POST', body: JSON.stringify({ identifier }) });
  },
  /**
   * Looks up what an invitation or reset link is for; fails with status 404 when it is invalid, expired or used.
   * @param token - The token from the link's URL fragment.
   * @param signal - Aborts the request when the page is no longer shown.
   */
  async checkPasswordLink(token: string, signal?: AbortSignal) {
    return request<PasswordLinkInfo>('/api/auth/token', { method: 'POST', body: JSON.stringify({ token }), signal });
  },
  /**
   * Sets the account password with an invitation or reset link.
   * @param token - The token from the link's URL fragment.
   * @param password - The new account password.
   */
  async setPasswordWithLink(token: string, password: string) {
    await request<void>('/api/auth/set-password', { method: 'POST', body: JSON.stringify({ token, password }) });
  },
  /**
   * Saves the vault preferences and returns the updated profile; fields left out stay unchanged.
   * @param payload - The auto-lock delay in minutes, the website icon opt-in and the clipboard clearing delay.
   */
  async updateSettings(payload: { autoLockMinutes?: number; showFavicons?: boolean; clipboardClearSeconds?: number; checkBreaches?: boolean }) {
    return request<User>('/api/auth/settings', { method: 'PUT', body: JSON.stringify(payload) });
  },
  /**
   * Asks the server to download a website's icon, for storing it in a vault entry. Only the host name is sent.
   * @param host - The host name of the entry's website.
   */
  async getFavicon(host: string): Promise<Blob> {
    const response = await fetch(`/api/vault/favicon?host=${encodeURIComponent(host)}`, { credentials: 'include' });
    if (!response.ok) {
      throw await parseError(response);
    }
    return response.blob();
  },
  /** Lists vault files the signed-in account can access. */
  async listVaultFiles() {
    return request<VaultFile[]>('/api/vault/files');
  },
  /**
   * Downloads encrypted vault bytes along with the ETag and modification time.
   * @param fileId - The ID of the vault file.
   */
  async getFileBytes(fileId: string): Promise<{ bytes: ArrayBuffer; etag: string; lastModified: string | null }> {
    const response = await fetch(`/api/vault/files/${encodeURIComponent(fileId)}/content`, { credentials: 'include' });
    if (!response.ok) {
      throw await parseError(response);
    }
    const bytes = await response.arrayBuffer();
    return {
      bytes,
      etag: response.headers.get('ETag') ?? '',
      lastModified: response.headers.get('Last-Modified')
    };
  },
  /**
   * Uploads encrypted bytes with an If-Match precondition and returns the saved metadata.
   * @param fileId - The ID of the vault file.
   * @param bytes - The encrypted KDBX bytes.
   * @param expectedETag - The ETag of the file revision this update is based on.
   */
  async putFileBytes(fileId: string, bytes: Uint8Array, expectedETag: string): Promise<VaultFile> {
    return request<VaultFile>(`/api/vault/files/${encodeURIComponent(fileId)}/content`, {
      method: 'PUT',
      headers: { 'X-Expected-ETag': expectedETag },
      body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    });
  }
};
