/** Browsers recognised in a user agent, checked in this order because e.g. Edge also names Chrome and Safari. */
const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/\bOPR\/(\d+)/, 'Opera'],
  [/\bSamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/\bFirefox\/(\d+)/, 'Firefox'],
  [/\bFxiOS\/(\d+)/, 'Firefox'],
  [/\bCriOS\/(\d+)/, 'Chrome'],
  [/(?:\b|Headless)Chrome\/(\d+)/, 'Chrome'],
  [/\bVersion\/(\d+)[.\d]* (?:Mobile\/\S+ )?Safari\//, 'Safari']
];

/** Operating systems recognised in a user agent, checked in this order because Android also names Linux. */
const SYSTEMS: readonly [RegExp, string][] = [
  [/\bAndroid\b/, 'Android'],
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux']
];

/**
 * Turns a user agent into a short label such as "Firefox 120 on Linux". Apps that are not browsers (e.g. a KeePass
 * app saving over WebDAV) show their first product token, e.g. "okhttp/4.12.0". Returns null for an empty value.
 * @param userAgent - The User-Agent header as stored by the server.
 */
export function describeUserAgent(userAgent: string | null | undefined): string | null {
  const text = userAgent?.trim();
  if (!text) return null;
  const browser = BROWSERS.find(/**
   * Matches one browser pattern.
   * @param entry - The pattern and browser name.
   */ ([pattern]) => pattern.test(text));
  const system = SYSTEMS.find(/**
   * Matches one operating system pattern.
   * @param entry - The pattern and system name.
   */ ([pattern]) => pattern.test(text))?.[1];
  if (!browser) {
    // Browsers all start with "Mozilla/5.0"; that token says nothing, so name only the system.
    const product = text.startsWith('Mozilla/') ? 'Browser' : text.split(/\s+/)[0];
    return system ? `${product} on ${system}` : product;
  }
  const version = browser[0].exec(text)?.[1];
  const name = version ? `${browser[1]} ${version}` : browser[1];
  return system ? `${name} on ${system}` : name;
}
