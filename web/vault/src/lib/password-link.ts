/** Helpers for the invitation and reset links whose token travels in the URL fragment, never to server logs. */

/**
 * Reads the token of an invitation or reset link from a URL fragment such as "#token=abc".
 * @param hash - The location's hash, including the leading "#".
 */
export function readLinkToken(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token ? token : null;
}

/**
 * Removes the link token from the address bar, so it is not reused or shared by accident.
 */
export function clearLinkToken() {
  history.replaceState(null, '', location.pathname + location.search);
}
