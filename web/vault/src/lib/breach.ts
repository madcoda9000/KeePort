import messages from '../i18n/lib-breach.ts';
import { translate } from '../../../shared/i18n/core.ts';

/** The "Have I Been Pwned" range API; only the first five hex characters of a SHA-1 hash are sent to it. */
export const PWNED_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

/** How many range requests run at the same time. */
const CONCURRENCY = 4;

/** Fetches one range of hash suffixes; replaceable in tests. */
export type RangeFetcher = (prefix: string) => Promise<string>;

/**
 * Requests the hash suffixes for a prefix from "Have I Been Pwned" with padding, so the response size reveals nothing
 * about the prefix either.
 * @param prefix - The first five upper-case hex characters of a SHA-1 hash.
 */
export async function fetchRange(prefix: string): Promise<string> {
  const response = await fetch(`${PWNED_RANGE_URL}${prefix}`, { headers: { 'Add-Padding': 'true' }, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(translate(messages, 'status', { status: String(response.status) }));
  return response.text();
}

/**
 * Computes the upper-case hex SHA-1 hash of a password in the browser.
 * @param password - The password.
 */
export async function sha1Hex(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
  return [...new Uint8Array(digest)].map(/**
   * Formats one byte.
   * @param byte - One byte of the hash.
   */ (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Reads how often a hash suffix occurs in a range response. Padding lines have a count of 0 and are ignored.
 * @param range - The response text, one "SUFFIX:COUNT" per line.
 * @param suffix - The last 35 hex characters of the hash.
 */
export function countInRange(range: string, suffix: string): number {
  for (const line of range.split('\n')) {
    const [candidate, count] = line.trim().split(':');
    if (candidate?.toUpperCase() === suffix) return Number.parseInt(count ?? '0', 10) || 0;
  }
  return 0;
}

/**
 * Checks passwords against "Have I Been Pwned" with k-anonymity: for each password only the first five characters of
 * its SHA-1 hash leave the browser; the rest is compared locally. Each prefix is requested once.
 * @param passwords - The passwords to check; duplicates and empty values are skipped.
 * @param onProgress - Called after each checked prefix with the number done and the total.
 * @param fetchPrefix - Fetches one range; defaults to the real API.
 */
export async function checkPasswords(
  passwords: Iterable<string>,
  onProgress: (done: number, total: number) => void = () => undefined,
  fetchPrefix: RangeFetcher = fetchRange
): Promise<Map<string, number>> {
  const unique = [...new Set([...passwords].filter(Boolean))];
  const hashes = await Promise.all(unique.map(/**
   * Hashes one password.
   * @param password - One password.
   */ async (password) => ({ password, hash: await sha1Hex(password) })));
  const byPrefix = new Map<string, { password: string; suffix: string }[]>();
  for (const { password, hash } of hashes) {
    const prefix = hash.slice(0, 5);
    const list = byPrefix.get(prefix) ?? [];
    list.push({ password, suffix: hash.slice(5) });
    byPrefix.set(prefix, list);
  }
  const prefixes = [...byPrefix.keys()];
  const results = new Map<string, number>();
  let done = 0;
  /** Works through the remaining prefixes one after another. */
  const worker = async () => {
    for (let prefix = prefixes.shift(); prefix; prefix = prefixes.shift()) {
      const range = await fetchPrefix(prefix);
      for (const { password, suffix } of byPrefix.get(prefix) ?? []) results.set(password, countInRange(range, suffix));
      done += 1;
      onProgress(done, byPrefix.size);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, prefixes.length) }, worker));
  return results;
}
