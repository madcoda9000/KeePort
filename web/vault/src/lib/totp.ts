const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export interface TotpConfig {
  secret: Uint8Array;
  digits: number;
  period: number;
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512';
}

/**
 * Decodes Base32 secret text into bytes, ignoring characters outside the alphabet.
 * @param input - The Base32 text to decode, with optional formatting characters.
 */
export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/**
 * Maps the URI's algorithm name to a Web Crypto hash name, defaulting to SHA-1.
 * @param raw - The optional algorithm parameter read from the provisioning URI.
 */
function hashName(raw: string | null): TotpConfig['algorithm'] {
  const normalized = (raw ?? 'SHA1').toUpperCase().replace('-', '');
  if (normalized === 'SHA256') return 'SHA-256';
  if (normalized === 'SHA512') return 'SHA-512';
  return 'SHA-1';
}

/**
 * Reads a provisioning URI or raw Base32 secret as a TOTP configuration.
 * @param raw - A provisioning URI or a raw Base32 shared secret from the entry.
 */
export function parseOtpSecret(raw: string): TotpConfig | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    try {
      const url = new URL(trimmed);
      const secret = url.searchParams.get('secret');
      if (!secret) return null;
      const decoded = base32Decode(secret);
      if (decoded.length === 0) return null;
      return {
        secret: decoded,
        digits: parseInt(url.searchParams.get('digits') ?? '6', 10) || 6,
        period: parseInt(url.searchParams.get('period') ?? '30', 10) || 30,
        algorithm: hashName(url.searchParams.get('algorithm'))
      };
    } catch {
      return null;
    }
  }
  const decoded = base32Decode(trimmed);
  if (decoded.length === 0) return null;
  return { secret: decoded, digits: 6, period: 30, algorithm: 'SHA-1' };
}

/**
 * Generates the TOTP code and remaining validity for the supplied timestamp.
 * @param config - The TOTP secret, hash algorithm, digit count, and time-step configuration.
 * @param timeMs - The calculation time in milliseconds since the Unix epoch; defaults to now.
 */
export async function totpCode(config: TotpConfig, timeMs: number = Date.now()): Promise<{ code: string; secondsLeft: number }> {
  const counter = Math.floor(timeMs / 1000 / config.period);
  const buf = new ArrayBuffer(8);
  new DataView(buf).setUint32(4, counter);
  const key = await crypto.subtle.importKey('raw', config.secret as BufferSource, { name: 'HMAC', hash: { name: config.algorithm } }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const offset = sig[sig.length - 1] & 0x0f;
  const binary = ((sig[offset] & 0x7f) << 24) | (sig[offset + 1] << 16) | (sig[offset + 2] << 8) | sig[offset + 3];
  const code = (binary % 10 ** config.digits).toString().padStart(config.digits, '0');
  const secondsLeft = config.period - (Math.floor(timeMs / 1000) % config.period);
  return { code, secondsLeft };
}
