/**
 * Encryption of shared secrets, used by the web vault (sender) and the share page (recipient). Everything happens in
 * the browser with WebCrypto:
 *
 * - A random 256-bit link key goes into the link after "#", which browsers never send to the server.
 * - With a recipient password, Argon2id turns the password into 32 more bytes; both are the input of HKDF-SHA-256.
 * - HKDF yields the AES-256-GCM key and, separately, an access proof. The server keeps only a hash of the proof and
 *   hands out the ciphertext only to someone who knows it, so a wrong password is caught before a view is used up.
 */

/** One value of a shared entry, shown on the recipient page. */
export interface SharedField {
  /** The kind decides the label: standard fields are translated on the share page, custom fields keep their name. */
  kind: 'title' | 'username' | 'password' | 'url' | 'notes' | 'totp' | 'custom';
  /** The field name, used for custom fields. */
  name: string;
  value: string;
  /** Whether the value is hidden until the recipient shows it. */
  protected: boolean;
}

/** The decrypted content of a share. */
export interface SharePayload {
  v: 1;
  fields: SharedField[];
  /** A message from the sender, encrypted like the fields. */
  message?: string;
}

/** The cost of Argon2id for recipient passwords. */
export interface Argon2Params {
  memory: number;
  time: number;
  parallelism: number;
}

/** Turns a password into 32 bytes with Argon2id; the web vault and the share page pass the WebAssembly version. */
export type PasswordKdf = (password: string, salt: Uint8Array, params: Argon2Params) => Promise<Uint8Array>;

/** The Argon2id cost for new shares: 64 MiB, 3 passes, 1 lane. */
export const ARGON2_PARAMS: Argon2Params = { memory: 65536, time: 3, parallelism: 1 };

/** What the web vault sends to the server for a new share; the link key stays in the browser. */
export interface EncryptedShare {
  linkKey: string;
  ciphertext: string;
  iv: string;
  kdfSalt: string;
  kdfParams: string | null;
  proof: string;
}

const encoder = new TextEncoder();
const PROOF_INFO = encoder.encode('keeport-share-proof-v1');
const KEY_INFO = encoder.encode('keeport-share-key-v1');
const ADDITIONAL_DATA = encoder.encode('keeport-share-v1');

/**
 * Encodes bytes as Base64url without padding.
 * @param bytes - The bytes.
 */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Decodes Base64url; throws on invalid input.
 * @param text - The Base64url text.
 */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Invalid Base64url');
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
}

/**
 * Encodes bytes as standard Base64.
 * @param bytes - The bytes.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Decodes standard Base64.
 * @param text - The Base64 text.
 */
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Writes Argon2 parameters in the format the server checks, for example "argon2id:m=65536,t=3,p=1".
 * @param params - The parameters.
 */
export function formatKdfParams(params: Argon2Params): string {
  return `argon2id:m=${params.memory},t=${params.time},p=${params.parallelism}`;
}

/**
 * Reads Argon2 parameters written by formatKdfParams; returns null for anything else.
 * @param text - The stored parameters.
 */
export function parseKdfParams(text: string | null | undefined): Argon2Params | null {
  const match = /^argon2id:m=(\d+),t=(\d+),p=(\d+)$/.exec(text ?? '');
  return match ? { memory: Number(match[1]), time: Number(match[2]), parallelism: Number(match[3]) } : null;
}

/**
 * Derives the AES key and the access proof from the link key and the optional password hash.
 * @param linkKey - The 32 random bytes from the link.
 * @param salt - The 16-byte salt stored with the share.
 * @param passwordHash - The Argon2id output of the recipient password, or null without password.
 */
async function deriveKeys(linkKey: Uint8Array, salt: Uint8Array<ArrayBuffer>, passwordHash: Uint8Array | null) {
  const material = new Uint8Array(linkKey.length + (passwordHash?.length ?? 0));
  material.set(linkKey);
  if (passwordHash) material.set(passwordHash, linkKey.length);
  const base = await crypto.subtle.importKey('raw', material, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const proof = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: PROOF_INFO }, base, 256));
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: KEY_INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return { key, proof: toBase64Url(proof) };
}

/**
 * Encrypts a share in the browser. The returned link key belongs only into the link; everything else goes to the server.
 * @param payload - The fields and the message.
 * @param password - The recipient password, or an empty string for none.
 * @param kdf - The Argon2id implementation, needed only with a password.
 * @param params - The Argon2id cost.
 */
export async function encryptShare(payload: SharePayload, password: string, kdf: PasswordKdf, params: Argon2Params = ARGON2_PARAMS): Promise<EncryptedShare> {
  const linkKey = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const passwordHash = password ? await kdf(password, salt, params) : null;
  const { key, proof } = await deriveKeys(linkKey, salt, passwordHash);
  const plain = encoder.encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ADDITIONAL_DATA }, key, plain));
  return {
    linkKey: toBase64Url(linkKey),
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
    kdfSalt: toBase64(salt),
    kdfParams: password ? formatKdfParams(params) : null,
    proof
  };
}

/** What the recipient's browser has after deriving the keys: the proof for the server and the key to decrypt. */
export interface OpenedShare {
  proof: string;
  /**
   * Decrypts the ciphertext the server handed out.
   * @param ciphertext - The ciphertext, Base64.
   * @param iv - The nonce, Base64.
   */
  decrypt: (ciphertext: string, iv: string) => Promise<SharePayload>;
}

/**
 * Derives the proof and the key on the recipient's side.
 * @param linkKey - The key from the link, Base64url.
 * @param kdfSalt - The salt from the server, Base64.
 * @param kdfParams - The Argon2 parameters from the server, or null without password.
 * @param password - The password the recipient entered.
 * @param kdf - The Argon2id implementation.
 */
export async function openShare(linkKey: string, kdfSalt: string, kdfParams: string | null, password: string, kdf: PasswordKdf): Promise<OpenedShare> {
  const keyBytes = fromBase64Url(linkKey);
  if (keyBytes.length !== 32) throw new Error('Invalid link key');
  const salt = fromBase64(kdfSalt);
  const params = parseKdfParams(kdfParams);
  const passwordHash = params ? await kdf(password, salt, params) : null;
  const { key, proof } = await deriveKeys(keyBytes, salt, passwordHash);
  return {
    proof,
    decrypt: /**
     * Decrypts and parses the payload.
     * @param ciphertext - The ciphertext, Base64.
     * @param iv - The nonce, Base64.
     */ async (ciphertext, iv) => {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: ADDITIONAL_DATA }, key, fromBase64(ciphertext));
      const payload = JSON.parse(new TextDecoder().decode(plain)) as SharePayload;
      if (payload?.v !== 1 || !Array.isArray(payload.fields)) throw new Error('Unknown share format');
      return payload;
    }
  };
}

/**
 * Builds the link for a share: the server only ever sees the part before "#".
 * @param origin - The web vault's address, for example https://vault.example.com.
 * @param id - The share's ID.
 * @param linkKey - The link key, Base64url.
 */
export function shareLink(origin: string, id: string, linkKey: string): string {
  return `${origin.replace(/\/+$/, '')}/s/${encodeURIComponent(id)}#${linkKey}`;
}

/**
 * Reads the share ID from the address of the share page and the key from its fragment.
 * @param pathname - The path, for example /s/abc.
 * @param hash - The fragment including "#".
 */
export function readShareLocation(pathname: string, hash: string): { id: string; key: string } | null {
  const match = /^\/s\/([A-Za-z0-9_-]{16,32})\/?$/.exec(pathname);
  if (!match) return null;
  return { id: match[1], key: hash.replace(/^#/, '') };
}
