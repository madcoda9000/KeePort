export interface User {
  id: string;
  username: string;
  email: string | null;
  role: 'admin' | 'user';
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  autoLockMinutes: number | null;
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
  return new ApiError(message, response.status, currentETag);
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
  async changePassword(payload: { currentPassword: string; newPassword: string }) {
    await request<void>('/api/auth/change-password', { method: 'POST', body: JSON.stringify(payload) });
  },
  /**
   * Saves the signed-in account's email and returns the updated user.
   * @param email - The new contact email for the signed-in account.
   */
  async updateEmail(email: string) {
    return request<User>('/api/auth/email', { method: 'PUT', body: JSON.stringify({ email }) });
  },
  /**
   * Saves the auto-lock preference and returns the updated profile.
   * @param payload - The user's auto-lock delay in minutes.
   */
  async updateSettings(payload: { autoLockMinutes: number }) {
    return request<User>('/api/auth/settings', { method: 'PUT', body: JSON.stringify(payload) });
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
