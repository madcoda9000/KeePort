import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptShare, formatKdfParams, fromBase64Url, openShare, parseKdfParams, readShareLocation, shareLink, toBase64Url } from './share-crypto.ts';

/**
 * A stand-in for Argon2id in tests: PBKDF2 from WebCrypto, so the tests need no WebAssembly.
 * @param password - The password.
 * @param salt - The salt.
 */
async function fakeKdf(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 }, base, 256));
}

const PAYLOAD = {
  v: 1,
  fields: [
    { kind: 'title', name: 'Title', value: 'Router', protected: false },
    { kind: 'password', name: 'Password', value: 'correct horse ✓', protected: true }
  ],
  message: 'For the guest network'
};

/** Encrypts and decrypts without a password; the server only gets ciphertext, nonce, salt and proof. */
test('round trip without password', async () => {
  const share = await encryptShare(PAYLOAD, '', fakeKdf);
  assert.equal(share.kdfParams, null);
  assert.equal(fromBase64Url(share.linkKey).length, 32);
  assert.equal(fromBase64Url(share.proof).length, 32);
  assert.ok(!share.ciphertext.includes('Router'));
  const opened = await openShare(share.linkKey, share.kdfSalt, null, '', fakeKdf);
  assert.equal(opened.proof, share.proof);
  assert.deepEqual(await opened.decrypt(share.ciphertext, share.iv), PAYLOAD);
});

/** With a password, the proof and the key depend on it: a wrong password gives another proof and cannot decrypt. */
test('password changes proof and key', async () => {
  const share = await encryptShare(PAYLOAD, 'tell-by-phone', fakeKdf);
  assert.equal(share.kdfParams, 'argon2id:m=65536,t=3,p=1');
  const right = await openShare(share.linkKey, share.kdfSalt, share.kdfParams, 'tell-by-phone', fakeKdf);
  assert.equal(right.proof, share.proof);
  assert.deepEqual(await right.decrypt(share.ciphertext, share.iv), PAYLOAD);
  const wrong = await openShare(share.linkKey, share.kdfSalt, share.kdfParams, 'guess', fakeKdf);
  assert.notEqual(wrong.proof, share.proof);
  await assert.rejects(wrong.decrypt(share.ciphertext, share.iv));
  const withoutPassword = await openShare(share.linkKey, share.kdfSalt, null, '', fakeKdf);
  assert.notEqual(withoutPassword.proof, share.proof, 'the link alone is not enough');
});

/** A changed ciphertext or another link key fails. */
test('tampering is detected', async () => {
  const share = await encryptShare(PAYLOAD, '', fakeKdf);
  const opened = await openShare(share.linkKey, share.kdfSalt, null, '', fakeKdf);
  const bytes = Uint8Array.from(atob(share.ciphertext), (c) => c.charCodeAt(0));
  bytes[0] ^= 1;
  await assert.rejects(opened.decrypt(btoa(String.fromCharCode(...bytes)), share.iv));
  const other = await encryptShare(PAYLOAD, '', fakeKdf);
  const mixed = await openShare(other.linkKey, share.kdfSalt, null, '', fakeKdf);
  await assert.rejects(mixed.decrypt(share.ciphertext, share.iv));
  await assert.rejects(openShare('short', share.kdfSalt, null, '', fakeKdf));
});

/** The key stays in the fragment of the link; the share page reads ID and key back. */
test('builds and reads links', () => {
  const link = shareLink('https://vault.example.com/', 'AbCdEfGhIjKlMnOpQrStUv', 'key_-123');
  assert.equal(link, 'https://vault.example.com/s/AbCdEfGhIjKlMnOpQrStUv#key_-123');
  const url = new URL(link);
  assert.deepEqual(readShareLocation(url.pathname, url.hash), { id: 'AbCdEfGhIjKlMnOpQrStUv', key: 'key_-123' });
  assert.equal(readShareLocation('/s/../etc', ''), null);
  assert.equal(readShareLocation('/vault', '#x'), null);
  assert.deepEqual(parseKdfParams(formatKdfParams({ memory: 1024, time: 2, parallelism: 1 })), { memory: 1024, time: 2, parallelism: 1 });
  assert.equal(parseKdfParams('scrypt'), null);
  assert.deepEqual(fromBase64Url(toBase64Url(new Uint8Array([251, 255, 0]))), new Uint8Array([251, 255, 0]));
});
