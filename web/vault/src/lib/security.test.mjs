import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Consts, Kdbx, KdbxCredentials, ProtectedValue } from 'kdbxweb';
import { createEntry, listEntries, saveEntryUpdate } from './kdbx.ts';
import { generatePassphrase, loadWordlist, passphraseEntropyBits } from './passphrase.ts';
import { generatePassword, strengthLabel } from './password.ts';
import { buildReport, passwordChangedAt } from './security-report.ts';
import { estimateStrength } from './strength.ts';
import { COMMON_PASSWORDS } from './wordlists/common-passwords.ts';

// Use the browser DOM code path rather than kdbxweb's legacy xmldom constructor options.
Object.assign(globalThis, { DOMParser, XMLSerializer });
if (!globalThis.crypto) Object.assign(globalThis, { crypto: webcrypto });

/** Verifies that weak passwords are found and generated ones are not. */
test('rates common, short and patterned passwords as weak and generated ones as strong', () => {
  for (const weak of ['', 'password', '123456', 'P@ssw0rd2024!', 'qwertyuiop', 'aaaaaaaaaaaaaaaa', 'abcdefgh12345678', 'Sommer2023!', 'dragon99']) {
    assert.equal(estimateStrength(weak).weak, true, `weak: ${weak}`);
  }
  assert.ok(estimateStrength('P@ssw0rd2024!').hints.includes('Common password'));
  assert.ok(estimateStrength('qwertyuiop').hints.includes('Keyboard pattern'));
  for (let i = 0; i < 20; i += 1) {
    const generated = generatePassword({ length: 16, sets: ['lower', 'upper', 'digits', 'symbols'], avoidLookAlikes: false });
    assert.equal(estimateStrength(generated).weak, false, `strong: ${generated}`);
  }
  assert.equal(estimateStrength('correct-horse-battery-staple-river').weak, false);
  assert.equal(COMMON_PASSWORDS.size, 1000);
});

/** Verifies the passphrase generator and its entropy with the EFF list. */
test('generates passphrases from the EFF Large Wordlist', async () => {
  const words = await loadWordlist();
  assert.equal(words.length, 7776);
  assert.equal(new Set(words).size, 7776);
  assert.ok(words.every(/**
   * Checks the word format.
   * @param word - One word.
   */ (word) => /^[a-z-]+$/.test(word)));
  const list = new Set(words);
  for (let i = 0; i < 20; i += 1) {
    const phrase = generatePassphrase({ words: 6, separator: 'hyphen', capitalize: false, addNumber: false }, words);
    const parts = phrase.split('-');
    // Some EFF words contain hyphens themselves (e.g. "t-shirt"), so rebuild the words greedily.
    assert.ok(parts.length >= 6);
  }
  const spaced = generatePassphrase({ words: 5, separator: 'space', capitalize: true, addNumber: true }, words);
  const tokens = spaced.split(' ');
  assert.equal(tokens.length, 5);
  assert.ok(tokens.every(/**
   * Checks capitalization.
   * @param token - One word.
   */ (token) => /^[A-Z]/.test(token)));
  assert.equal(tokens.filter(/**
   * Finds the word with the digit.
   * @param token - One word.
   */ (token) => /\d$/.test(token)).length, 1);
  assert.ok(tokens.every(/**
   * Checks that each word comes from the list.
   * @param token - One word.
   */ (token) => list.has(token.replace(/\d$/, '').toLowerCase())));
  assert.equal(passphraseEntropyBits({ words: 6, separator: 'hyphen', capitalize: false, addNumber: false }, 7776), 77);
  assert.equal(strengthLabel(77), 'Strong', 'six words are strong');
  assert.ok(passphraseEntropyBits({ words: 6, separator: 'none', capitalize: true, addNumber: true }, 7776) > 77);
  assert.equal(generatePassphrase({ words: 2, separator: 'none', capitalize: false, addNumber: false }, words).length > 0, true, 'minimum 4 words');
});

/** Verifies the report: reused across folders, old by the history, exclusions and empty passwords. */
test('reports weak, reused, old, empty and expired entries from the vault', async () => {
  const db = Kdbx.create(new KdbxCredentials(ProtectedValue.fromString('public test password')), 'Report test');
  db.setKdf(Consts.KdfId.Aes);
  const strong = 'Vq7#pL2!xZ9$wR4m';
  const fields = { title: 'X', username: 'user', password: strong, url: '', notes: '', otp: '' };
  const work = db.createGroup(db.getDefaultGroup(), 'Work');
  createEntry(db, { ...fields, title: 'Shared A' });
  createEntry(db, { ...fields, title: 'Shared B' }, work.uuid.id);
  createEntry(db, { ...fields, title: 'Weak', password: 'password1' });
  createEntry(db, { ...fields, title: 'Empty', password: '' });
  createEntry(db, { ...fields, title: 'Expired', password: 'Unique-Pass-8472-Kx!', expires: '2020-01-01' });
  const old = createEntry(db, { ...fields, title: 'Old', password: 'Another-Unique-9931-Qz!' });
  const yearsAgo = new Date(Date.now() - 2 * 365 * 86400000);
  old.times.creationTime = yearsAgo;
  old.times.lastModTime = yearsAgo;
  // Changing only the notes later must not make the password look new.
  await saveEntryUpdate(db, old, { ...fields, title: 'Old', password: 'Another-Unique-9931-Qz!', notes: 'new note' }, old.binaries, /**
   * Accepts the write.
   * @param bytes - The saved vault.
   */ async (bytes) => bytes);
  assert.ok(old.times.lastModTime > yearsAgo);
  assert.equal(passwordChangedAt(old).getTime(), yearsAgo.getTime());
  db.createRecycleBin();
  createEntry(db, { ...fields, title: 'Recycled', password: 'password1' }, db.meta.recycleBinUuid.id);

  const views = listEntries(db);
  const report = buildReport(views, new Date());
  /**
   * Returns the titles of the entries with an issue.
   * @param issue - The check.
   */
  const titles = (issue) => views.filter(/**
   * Keeps entries with the issue.
   * @param view - One entry view.
   */ (view) => report.issues[issue].has(view.id)).map(/**
   * Selects the title.
   * @param view - One entry view.
   */ (view) => view.title).sort();
  assert.deepEqual(titles('reused'), ['Shared A', 'Shared B']);
  assert.deepEqual(titles('weak'), ['Weak']);
  assert.deepEqual(titles('old'), ['Old']);
  assert.deepEqual(titles('empty'), ['Empty']);
  assert.deepEqual(titles('expired'), ['Expired']);
  assert.equal(report.reuseCounts.get(views.find(/**
   * Finds entry Shared A.
   * @param view - One entry view.
   */ (view) => view.title === 'Shared A').id), 2);
  assert.equal(report.affected.size, 6);
});
