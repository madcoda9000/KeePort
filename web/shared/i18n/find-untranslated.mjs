// Lists likely untranslated English text in the frontends: JSX text, user-facing attributes and string literals that
// look like sentences. A helper for review, not a test: it reports candidates, some of which are fine (e.g. "KeePort").
// Usage: node shared/i18n/find-untranslated.mjs [file or folder ...]   (defaults to vault/src, admin/src, shared)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(fileURLToPath(import.meta.url), '../../..');
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['vault/src', 'admin/src', 'shared'].map((p) => join(web, p));
const IGNORE_DIRS = new Set(['node_modules', 'ui', 'i18n', 'wordlists', 'dist']);
const ALLOWED = /^(KeePort|KeePass\w*|WebDAV|TOTP|KDBX|ETag|CSRF|URL|HTTPS?|OK|ID|IP|UTC|Have I Been Pwned)$/;

/**
 * Collects .ts and .tsx source files below a path, skipping tests, catalogs and shadcn components.
 * @param path - A file or folder.
 */
function sources(path) {
  if (statSync(path).isFile()) return /\.tsx?$/.test(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => (IGNORE_DIRS.has(name) ? [] : sources(join(path, name))));
}

/**
 * Says whether a text looks like words a user reads.
 * @param text - The candidate text.
 */
function isProse(text) {
  const trimmed = text.trim();
  return /[A-Za-z]{2,}/.test(trimmed) && /[a-z]/.test(trimmed) && !ALLOWED.test(trimmed) && !/^[\w-]+$/.test(trimmed.replace(/\s/g, '')) || /\s/.test(trimmed) && /^[A-Z][a-z]/.test(trimmed);
}

const patterns = [
  { kind: 'jsx', regex: />\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*?)\s*</g },
  { kind: 'attr', regex: /\b(?:title|aria-label|placeholder|alt|label|description|emptyMessage|searchLabel)=["']([^"']*[A-Za-z][^"']*)["']/g },
  { kind: 'string', regex: /(?<![\w.])(['`])((?:[A-Z][a-z]+|[A-Z])(?: [^'`\n]*)?[.…!?:]?)\1/g }
];

let total = 0;
for (const file of targets.flatMap(sources)) {
  if (/\.test\.|\/i18n\//.test(file)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*\*|import )/.test(line) || /\bt(\.rich)?\(/.test(line) && !/>[^<{]*[A-Za-z]{3,}[^<{]*</.test(line)) return;
    for (const { kind, regex } of patterns) {
      for (const match of line.matchAll(regex)) {
        const text = match[kind === 'string' ? 2 : 1];
        if (!text || !isProse(text) || (kind === 'string' && !/\s/.test(text) && text.length < 4)) continue;
        if (kind === 'string' && /^(GET|POST|PUT|PATCH|DELETE|Content-Type|Authorization|X-[\w-]+)$/.test(text)) continue;
        total += 1;
        console.log(`${relative(web, file)}:${index + 1}  [${kind}]  ${text.trim()}`);
      }
    }
  });
}
console.log(`\n${total} candidate(s)`);
