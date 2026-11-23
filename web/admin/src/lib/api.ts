export interface User {
  id: string;
  username: string;
  email: string | null;
  role: 'admin' | 'user';
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
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

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let csrfToken = '';

export function setCsrfToken(token: string) {
  csrfToken = token;
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
  if (text) {
    try {
      const data = JSON.parse(text) as { message?: string; error?: string };
      message = data.message || data.error || message;
    } catch {
      message = text.slice(0, 200) || message;
    }
  }
  return new ApiError(message, response.status);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include', headers: buildHeaders(init) });
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  async setupStatus() {
    return request<{ requiresSetup: boolean; hasUsers: boolean }>('/api/auth/setup-status');
  },
  async setup(payload: { setupToken: string; username: string; password: string }) {
    const result = await request<AuthResponse>('/api/auth/setup', { method: 'POST', body: JSON.stringify(payload) });
    setCsrfToken(result.csrfToken);
    return result;
  },
  async login(payload: { username: string; password: string }) {
    const result = await request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
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

  async listUsers() {
    return request<User[]>('/api/admin/users');
  },
  async createUser(payload: { username: string; email: string; password: string; role: 'admin' | 'user' }) {
    return request<User>('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
  },
  async updateUser(id: string, payload: { role?: 'admin' | 'user'; disabled?: boolean; password?: string }) {
    return request<User>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  async deleteUser(id: string) {
    await request<void>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async listFiles(includeDeleted = false) {
    return request<AdminFile[]>(`/api/admin/files?includeDeleted=${includeDeleted ? 'true' : 'false'}`);
  },
  async uploadFile(file: File, name?: string) {
    const form = new FormData();
    form.append('file', file);
    const query = name ? `?name=${encodeURIComponent(name)}` : '';
    return request<AdminFile>(`/api/admin/files${query}`, { method: 'POST', body: form });
  },
  async downloadFile(id: string): Promise<Blob> {
    const response = await fetch(`/api/admin/files/${encodeURIComponent(id)}/content`, { credentials: 'include' });
    if (!response.ok) throw await parseError(response);
    return response.blob();
  },
  async renameFile(id: string, name: string) {
    return request<AdminFile>(`/api/admin/files/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  },
  async deleteFile(id: string) {
    await request<void>(`/api/admin/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async restoreFile(id: string) {
    return request<AdminFile>(`/api/admin/files/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  },
  async getPermissions(fileId: string) {
    return request<FilePermission[]>(`/api/admin/files/${encodeURIComponent(fileId)}/permissions`);
  },
  async setPermissions(fileId: string, permissions: { userId: string; permission: 'read' | 'read-write' | 'none' }[]) {
    const filtered = permissions.filter((permission) => permission.permission !== 'none');
    return request<FilePermission[]>(`/api/admin/files/${encodeURIComponent(fileId)}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions: filtered.map((permission) => ({ userId: permission.userId, permission: permission.permission === 'read' ? 'read' : 'read-write' })) })
    });
  },

  async listWebDavCredentials() {
    return request<WebDavCredential[]>('/api/admin/webdav-credentials');
  },
  async createWebDavCredential(payload: { userId: string; label: string; password: string }) {
    return request<WebDavCredential>('/api/admin/webdav-credentials', { method: 'POST', body: JSON.stringify(payload) });
  },
  async revokeWebDavCredential(id: string) {
    await request<void>(`/api/admin/webdav-credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
};
