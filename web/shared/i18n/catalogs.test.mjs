import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
/** The folders that hold catalogs, one file per area of the interface. */
const FOLDERS = [join(here, 'messages'), join(here, '../../vault/src/i18n'), join(here, '../../admin/src/i18n')];

/**
 * Lists the catalog files of a folder; a missing folder has none.
 * @param folder - The folder to read.
 */
function catalogFiles(folder) {
  try {
    return readdirSync(folder).filter((name) => name.endsWith('.ts')).map((name) => join(folder, name));
  } catch {
    return [];
  }
}

/**
 * Returns the placeholder names of a text, sorted.
 * @param text - The text.
 */
function placeholders(text) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
}

/**
 * Lists the forms of a text: the text itself, or its plural forms.
 * @param text - A string or plural object.
 */
function forms(text) {
  return typeof text === 'string' ? [text] : Object.values(text);
}

const files = FOLDERS.flatMap(catalogFiles);

/** Verifies that every catalog is complete in German and French and uses the same placeholders as English. */
test('catalogs are complete and consistent in every language', async () => {
  const problems = [];
  for (const file of files) {
    const { default: catalog } = await import(file);
    const name = file.split('/').slice(-3).join('/');
    for (const language of ['de', 'fr']) {
      for (const key of Object.keys(catalog.en)) {
        const english = catalog.en[key];
        const own = catalog[language][key];
        if (own === undefined) { problems.push(`${name}: ${language}.${key} missing`); continue; }
        if (typeof english !== typeof own) { problems.push(`${name}: ${language}.${key} must be ${typeof english === 'string' ? 'a string' : 'plural forms'}`); continue; }
        const expected = new Set(forms(english).flatMap((form) => placeholders(form).split(',').filter(Boolean)));
        const used = new Set();
        for (const form of forms(own)) {
          for (const placeholder of placeholders(form).split(',').filter(Boolean)) {
            used.add(placeholder);
            if (!expected.has(placeholder)) problems.push(`${name}: ${language}.${key} has unknown placeholder {${placeholder}}`);
          }
        }
        for (const placeholder of expected) {
          // A plural form may say "one entry" instead of "{count} entry"; every other placeholder must stay.
          if (!used.has(placeholder) && !(placeholder === 'count' && typeof english !== 'string')) {
            problems.push(`${name}: ${language}.${key} drops placeholder {${placeholder}}`);
          }
        }
      }
      for (const key of Object.keys(catalog[language])) {
        if (!(key in catalog.en)) problems.push(`${name}: ${language}.${key} has no English text`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
