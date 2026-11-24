import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOtpSecret, totpCode, totpUri } from './totp.ts';

const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/** Compares browser calculations to the SHA-1 reference vectors in RFC 6238 Appendix B. */
test('matches published TOTP vectors and reports the remaining time', async () => {
  const config = parseOtpSecret(`otpauth://totp/Example?secret=${secret}&digits=8`);
  assert.ok(config);
  for (const [seconds, code] of [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130']
  ]) {
    assert.deepEqual(await totpCode(config, seconds * 1000), { code, secondsLeft: 30 - (seconds % 30) });
  }
});

/** Verifies that copying a stored URI keeps its issuer and non-default parameters intact. */
test('preserves the stored URI and rejects HOTP', () => {
  const uri = `otpauth://totp/Issuer:Example?secret=${secret}&algorithm=SHA256&digits=8&period=60&issuer=Issuer`;
  assert.equal(totpUri(` ${uri} `, 'Renamed entry'), uri);
  assert.equal(totpUri(uri.replace('/totp/', '/hotp/'), 'Example'), null);
  assert.equal(totpUri('', 'Example'), null);
});

/** Verifies that an exported raw secret generates the same code in URI form. */
test('exports a raw Base32 secret with an encoded label and defaults', async () => {
  const raw = ' gezd-gnbv gy3tqojqgezdgnbvgy3tqojq ';
  const uri = totpUri(raw, 'Example / Personal');
  assert.equal(uri, `otpauth://totp/Example%20%2F%20Personal?secret=${secret}`);
  assert.deepEqual(parseOtpSecret(uri), parseOtpSecret(raw));
  assert.equal((await totpCode(parseOtpSecret(uri), 59000)).code, '287082');
});
