import type { Argon2Params } from './share-crypto';

/**
 * Turns a recipient password into 32 bytes with Argon2id (WebAssembly), for the share key. The Argon2 code is loaded
 * only when a password is used, so the share page stays small without one.
 * @param password - The password.
 * @param salt - The share's salt.
 * @param params - The Argon2id cost.
 */
export async function argon2Kdf(password: string, salt: Uint8Array, params: Argon2Params): Promise<Uint8Array> {
  const { default: argon2 } = await import('argon2-browser/dist/argon2-bundled.min.js');
  const result = await argon2.hash({
    pass: new TextEncoder().encode(password),
    salt,
    time: params.time,
    mem: params.memory,
    parallelism: params.parallelism,
    hashLen: 32,
    type: argon2.ArgonType.Argon2id
  });
  return result.hash.slice();
}
