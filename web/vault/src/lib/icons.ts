import * as kdbxweb from 'kdbxweb';

/**
 * Returns the entry's own icon stored in the KDBX (KeePassXC keeps downloaded favicons there) as a data URL, or null.
 * Showing it needs no network access.
 * @param db - The unlocked database holding the custom icons.
 * @param entry - The entry whose icon is looked up.
 */
export function customIconUrl(db: kdbxweb.Kdbx, entry: kdbxweb.KdbxEntry): string | null {
  const id = entry.customIcon?.id;
  const icon = id ? db.meta.customIcons.get(id) : undefined;
  if (!icon?.data.byteLength) return null;
  return `data:${imageType(new Uint8Array(icon.data))};base64,${kdbxweb.ByteUtils.bytesToBase64(icon.data)}`;
}

/**
 * Detects the image type from the first bytes; KDBX icons are usually PNG, but other formats occur.
 * @param bytes - The image bytes.
 */
function imageType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01) return 'image/x-icon';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return 'image/webp';
  return 'image/png';
}

/**
 * Returns the address of the site's favicon for an entry URL, or null when the URL is not a web address. Only
 * http(s) URLs with a host name are used; the icon is always requested over HTTPS from the site itself.
 * @param url - The entry's URL field, with or without scheme.
 */
export function faviconUrl(url: string): string | null {
  const value = url.trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  // Plain IP addresses and single-label names (routers, NAS) rarely have valid certificates for HTTPS icons.
  if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host) || host.startsWith('[')) return null;
  return `https://${host}/favicon.ico`;
}

/**
 * Returns the URL to open for an entry's website, or null when it is not an http(s) address.
 * @param url - The entry's URL field, with or without scheme.
 */
export function openableUrl(url: string): string | null {
  const value = url.trim();
  if (!value) return null;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}
