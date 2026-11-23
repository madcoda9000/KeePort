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

  constructor(message: string, status: number, currentETag?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.currentETag = currentETag;
  }
}

let csrfToken = '';

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export function getCsrfToken() {
  return csrfToken;
}

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
  async login(payload: { username: string; password: string }) {
    const result = await request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setCsrfToken(result.csrfToken);
    return result;
  },
  async logout() {
    await request<void>('/api/auth/logout', { method: 'POST' });
    setCsrfToken('');
  },
  async me() {
    return request<User>('/api/auth/me');
  },
  async csrf() {
    const result = await request<{ csrfToken: string }>('/api/auth/csrf');
    setCsrfToken(result.csrfToken);
    return result.csrfToken;
  },
  async changePassword(payload: { currentPassword: string; newPassword: string }) {
    await request<void>('/api/auth/change-password', { method: 'POST', body: JSON.stringify(payload) });
  },
  /** Saves the signed-in account's email and returns the updated user. */
  async updateEmail(email: string) {
    return request<User>('/api/auth/email', { method: 'PUT', body: JSON.stringify({ email }) });
  },
  async updateSettings(payload: { autoLockMinutes: number }) {
    return request<User>('/api/auth/settings', { method: 'PUT', body: JSON.stringify(payload) });
  },
  async listVaultFiles() {
    return request<VaultFile[]>('/api/vault/files');
  },
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
  async putFileBytes(fileId: string, bytes: Uint8Array, expectedETag: string): Promise<VaultFile> {
    return request<VaultFile>(`/api/vault/files/${encodeURIComponent(fileId)}/content`, {
      method: 'PUT',
      headers: { 'X-Expected-ETag': expectedETag },
      body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    });
  }
};
