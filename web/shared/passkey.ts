/** A started WebAuthn ceremony from the server: its one-time ID and the options for the browser as JSON. */
export interface PasskeyCeremony {
  challengeId: string;
  options: Record<string, unknown>;
}

/** Why passkeys cannot be used on this page, or null when they can. */
export type PasskeyBlocker = 'unsupported' | 'domain' | null;

/**
 * Tells whether the browser offers passkeys on this page. They need WebAuthn, a secure context and a domain name;
 * browsers refuse them for IP addresses.
 */
export function passkeyBlocker(): PasskeyBlocker {
  if (typeof window === 'undefined' || !('PublicKeyCredential' in window) || !navigator.credentials) return 'unsupported';
  const host = location.hostname;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');
  if (isIp || !window.isSecureContext) return 'domain';
  return null;
}

/**
 * Decodes unpadded Base64url text.
 * @param text - The text.
 */
function fromBase64Url(text: string): ArrayBuffer {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Encodes bytes as unpadded Base64url text.
 * @param buffer - The bytes.
 */
function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Removes null values, which browsers reject in WebAuthn options (e.g. "authenticatorAttachment": null).
 * @param value - The JSON value.
 */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(/**
     * Keeps entries with a value.
     * @param entry - One key and value.
     */ (entry) => entry[1] !== null).map(/**
     * Cleans one value.
     * @param entry - One key and value.
     */ ([key, item]) => [key, withoutNulls(item)]));
  }
  return value;
}

/**
 * Converts credential descriptors with Base64url IDs into the browser's form.
 * @param list - The descriptors from the server.
 */
function descriptors(list: unknown): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.map(/**
   * Converts one descriptor.
   * @param item - The descriptor.
   */ (item: { id: string; type?: string; transports?: AuthenticatorTransport[] }) => ({
    type: 'public-key' as const,
    id: fromBase64Url(item.id),
    ...(item.transports ? { transports: item.transports } : {})
  }));
}

/**
 * Lets the user create a passkey with the options from the server and returns the answer for the server.
 * @param options - The creation options as JSON.
 */
export async function createPasskey(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const clean = withoutNulls(options) as Record<string, unknown> & { challenge: string; user: { id: string; name: string; displayName: string }; excludeCredentials?: unknown };
  const publicKey = {
    ...clean,
    challenge: fromBase64Url(clean.challenge),
    user: { ...clean.user, id: fromBase64Url(clean.user.id) },
    excludeCredentials: descriptors(clean.excludeCredentials) ?? []
  } as unknown as PublicKeyCredentialCreationOptions;
  const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException('No passkey was created.', 'NotAllowedError');
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: toBase64Url(response.attestationObject),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      transports: typeof response.getTransports === 'function' ? response.getTransports() : []
    },
    clientExtensionResults: credential.getClientExtensionResults()
  };
}

/**
 * Lets the user sign in with a passkey and returns the answer for the server.
 * @param options - The request options as JSON.
 */
export async function getPasskey(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const clean = withoutNulls(options) as Record<string, unknown> & { challenge: string; allowCredentials?: unknown };
  const publicKey = {
    ...clean,
    challenge: fromBase64Url(clean.challenge),
    allowCredentials: descriptors(clean.allowCredentials) ?? []
  } as unknown as PublicKeyCredentialRequestOptions;
  const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException('No passkey was chosen.', 'NotAllowedError');
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: toBase64Url(response.authenticatorData),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : null
    },
    clientExtensionResults: credential.getClientExtensionResults()
  };
}

/**
 * Tells whether an error means the user closed the browser's passkey dialog or it timed out.
 * @param reason - The error.
 */
export function isPasskeyCancel(reason: unknown): boolean {
  return reason instanceof DOMException && (reason.name === 'NotAllowedError' || reason.name === 'AbortError');
}

/**
 * Tells whether an error means the passkey is already stored for this account.
 * @param reason - The error.
 */
export function isPasskeyDuplicate(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'InvalidStateError';
}
