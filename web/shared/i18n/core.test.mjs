import assert from 'node:assert/strict';
import test from 'node:test';
import { browserLanguage, defineMessages, formatRelative, interpolate, setLanguage, translate } from './core.ts';

const catalog = defineMessages({
  en: { save: 'Save', entries: { one: '{count} entry', other: '{count} entries' }, hello: 'Hello {name}', onlyEnglish: 'Only English' },
  de: { save: 'Speichern', entries: { one: '{count} Eintrag', other: '{count} Einträge' }, hello: 'Hallo {name}' },
  fr: { save: 'Enregistrer', entries: { one: '{count} entrée', other: '{count} entrées' }, hello: 'Bonjour {name}' }
});

/** Verifies translations, placeholders and the English fallback for missing keys. */
test('translates, fills placeholders and falls back to English', () => {
  assert.equal(translate(catalog, 'save', undefined, 'de'), 'Speichern');
  assert.equal(translate(catalog, 'hello', { name: 'Anna' }, 'fr'), 'Bonjour Anna');
  assert.equal(translate(catalog, 'onlyEnglish', undefined, 'de'), 'Only English');
  assert.equal(translate(catalog, 'missing', undefined, 'de'), 'missing');
  assert.equal(interpolate('Keep {unknown}', {}), 'Keep {unknown}');
});

/** Verifies the plural rules, including French counting 0 as singular. */
test('selects plural forms per language', () => {
  setLanguage('en');
  assert.equal(translate(catalog, 'entries', { count: 1 }, 'en'), '1 entry');
  assert.equal(translate(catalog, 'entries', { count: 0 }, 'en'), '0 entries');
  assert.equal(translate(catalog, 'entries', { count: 2 }, 'de'), '2 Einträge');
  assert.equal(translate(catalog, 'entries', { count: 0 }, 'fr'), '0 entrée');
  assert.equal(translate(catalog, 'entries', { count: 2 }, 'fr'), '2 entrées');
});

/** Verifies that the browser's language list picks the first supported language. */
test('detects the browser language', () => {
  assert.equal(browserLanguage(['de-AT', 'en']), 'de');
  assert.equal(browserLanguage(['es-ES', 'fr-CA']), 'fr');
  assert.equal(browserLanguage(['es-ES']), 'en');
  assert.equal(browserLanguage([]), 'en');
});

/** Verifies relative times in the current language. */
test('formats relative times', () => {
  const now = new Date('2026-11-26T12:00:00Z');
  setLanguage('de');
  assert.equal(formatRelative(new Date('2026-11-26T11:58:00Z'), now), 'vor 2 Minuten');
  setLanguage('en');
  assert.equal(formatRelative(new Date('2026-11-25T12:00:00Z'), now), 'yesterday');
  assert.equal(formatRelative(new Date('2026-11-26T11:59:50Z'), now), 'now');
});
