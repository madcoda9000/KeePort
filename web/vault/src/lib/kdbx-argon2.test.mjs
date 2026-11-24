import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Consts, CryptoEngine } from 'kdbxweb';

const { CryptoEngine: adminEngine } = createRequire(new URL('../../../admin/package.json', import.meta.url))('kdbxweb');
const vectors = [
  [0, 'dd1e6b744a461127dbbac5fa63e04b6a2ad4acf3b0028a57f9176eeeb13e5c06'],
  [2, '4d3ab5e6d7443ad05a8cb0012fbc31ddb7195552d0998942e1842b33f018bb46']
];

/**
 * Checks both browser adapters against independent Argon2 v1.3 vectors and verifies the settings of a new vault.
 * @param t - The test context used to restore the browser shims afterward.
 */
test('Admin and Vault derive the standard KDBX keys and create Argon2id vaults', async (t) => {
  const before = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, {
    DOMParser,
    XMLSerializer,
    // Use the bundled WASM rather than argon2-browser's unbundled Node loader.
    self: {
      /** Exposes the WASM module to the browser loader. */
      get Module() { return globalThis.Module; },
      /**
       * Shares the WASM module with the generated loader's global binding.
       * @param value - Module configuration supplied by argon2-browser.
       */
      set Module(value) { globalThis.Module = value; }
    }
  });
  t.after(/** Restores globals used by the WASM and XML shims. */ () => {
    for (const name of ['self', 'Module', 'DOMParser', 'XMLSerializer']) {
      if (before[name]) Object.defineProperty(globalThis, name, before[name]);
      else delete globalThis[name];
    }
  });

  const admin = await import('../../../admin/src/lib/kdbx.ts');
  const vault = await import('./kdbx.ts');
  for (const [client, engine] of [[admin, adminEngine], [vault, CryptoEngine]]) {
    await client.ensureKdbxCrypto();
    for (const [type, expected] of vectors) {
      const hash = await engine.argon2(new ArrayBuffer(32), new ArrayBuffer(32), 8, 2, 32, 1, type, 0x13);
      assert.equal(Buffer.from(hash).toString('hex'), expected);
    }
    const password = 'public interop fixture';
    const contents = await client.createKdbxBytes('Interop test', password);
    const reopened = await client.loadVault(contents.buffer, password, null);
    const kdf = reopened.header.kdfParameters;
    assert.equal(Buffer.from(kdf.get('$UUID')).toString('base64'), Consts.KdfId.Argon2id);
    assert.equal(kdf.get('M').value, 64 * 1024 * 1024);
    assert.equal(kdf.get('I').value, 3);
    assert.equal(kdf.get('P'), 4);
  }
});
