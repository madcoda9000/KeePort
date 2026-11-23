declare module 'argon2-browser/dist/argon2-bundled.min.js' {
  export interface Argon2HashOptions {
    pass: Uint8Array | string;
    salt: Uint8Array | string;
    time?: number;
    mem?: number;
    hashLen?: number;
    parallelism?: number;
    type?: number;
    version?: number;
    secret?: Uint8Array;
    ad?: Uint8Array;
  }

  export interface Argon2HashResult {
    hash: Uint8Array;
    hashHex: string;
    encoded: string;
  }

  export const ArgonType: {
    Argon2d: number;
    Argon2i: number;
    Argon2id: number;
  };

  export function hash(options: Argon2HashOptions): Promise<Argon2HashResult>;
  export function verify(options: Argon2HashOptions & { hash?: Uint8Array | string; hashHex?: string }): Promise<boolean>;

  const argon2: {
    ArgonType: typeof ArgonType;
    hash: typeof hash;
    verify: typeof verify;
  };

  export default argon2;
}
