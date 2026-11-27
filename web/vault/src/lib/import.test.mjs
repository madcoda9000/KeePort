import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Consts, Kdbx, KdbxCredentials, ProtectedValue } from 'kdbxweb';
import { formatCsv, parseCsv } from './import/csv.ts';
import { guessMapping, readGeneric } from './import/formats.ts';
import { parseImport } from './import/index.ts';
import { duplicateKey, findDuplicates, importItems } from './import/apply.ts';
import { exportCsv, exportFileName, neutralizeFormula } from './import/export.ts';
import { createFolder, listFolders } from './groups.ts';
import { createEntry, listEntries } from './kdbx.ts';

// Use the browser DOM code path rather than kdbxweb's legacy xmldom constructor options.
Object.assign(globalThis, { DOMParser, XMLSerializer });

// All sample files below are made up for these tests; none comes from a real export.

/** Creates an ephemeral vault with a recycle bin, using the AES KDF to avoid Argon2. */
function testVault() {
  const db = Kdbx.create(new KdbxCredentials(ProtectedValue.fromString('public test password')), 'Import test');
  db.setKdf(Consts.KdfId.Aes);
  db.createRecycleBin();
  return db;
}

/**
 * Selects the titles of items.
 * @param items - Parsed items.
 */
function titles(items) {
  return items.map(/**
   * Selects one title.
   * @param item - One item.
   */ (item) => item.title);
}

test('the CSV parser handles quotes, line breaks, separators and a byte order mark', () => {
  const text = '﻿a,b,c\r\n"x, y","multi\nline","say ""hi"""\n\n1,,3';
  const { delimiter, rows, lines } = parseCsv(text);
  assert.equal(delimiter, ',');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'multi\nline', 'say "hi"'], ['1', '', '3']]);
  // The second row spans lines 2 and 3, line 4 is empty, so the third row starts on line 5.
  assert.deepEqual(lines, [1, 2, 5]);
  assert.deepEqual(parseCsv('a\r\n"b\r\nc"\r\nd\re').lines, [1, 2, 4, 5]);
  assert.deepEqual(parseCsv('name;url\r\nA;"b;c"\r\n').rows, [['name', 'url'], ['A', 'b;c']]);
  assert.deepEqual(parseCsv('name\turl\nA\tB').rows, [['name', 'url'], ['A', 'B']]);
  assert.throws(() => parseCsv('a,b\n"open,1'), /not closed/);
});

test('written CSV reads back to the same cells', () => {
  const rows = [['Group', 'Notes'], ['Root/Web', 'line 1\r\nline 2, "quoted"']];
  assert.equal(formatCsv([['a', 'b"c']]), '"a","b""c"\r\n');
  assert.deepEqual(parseCsv(formatCsv(rows)).rows, rows);
});

test('Bitwarden CSV: logins and notes with folders, TOTP, extra addresses and fields', () => {
  const csv = [
    'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp',
    'Work/Dev,1,login,GitHub,Main account,"Recovery: abc\nPIN: 1234",0,"https://github.com,https://gist.github.com",octo,s3cret,JBSWY3DPEHPK3PXP',
    ',,note,Wi-Fi,Password is on the router,,0,,,,',
    ',,card,Visa,,,0,,,,'
  ].join('\n');
  const parsed = parseImport(csv);
  assert.equal(parsed.format, 'bitwarden-csv');
  assert.deepEqual(titles(parsed.items), ['GitHub', 'Wi-Fi']);
  const [github] = parsed.items;
  assert.deepEqual(github.folder, ['Work', 'Dev']);
  assert.equal(github.url, 'https://github.com');
  assert.equal(github.otp, 'JBSWY3DPEHPK3PXP');
  assert.deepEqual(github.fields.map(/** @param field - One field. */ (field) => `${field.name}=${field.value}`), ['URL 2=https://gist.github.com', 'Recovery=abc', 'PIN=1234']);
  // The fields cell of GitHub spans two lines, so the card starts on line 5 of the file.
  assert.deepEqual(parsed.problems, [{ line: 5, label: 'Visa', reason: 'unsupportedType', detail: 'card' }]);
});

test('Bitwarden JSON: folders, cards, hidden fields, and refusal of encrypted exports', () => {
  const json = JSON.stringify({
    encrypted: false,
    folders: [{ id: 'f1', name: 'Finance' }],
    items: [
      { type: 1, name: 'Bank', folderId: 'f1', notes: null, login: { username: 'anna', password: 'pw', totp: null, uris: [{ uri: 'https://bank.example' }] },
        fields: [{ name: 'Customer ID', value: '42', type: 0 }, { name: 'PIN', value: '0000', type: 1 }, { name: 'Linked', value: null, type: 3 }],
        creationDate: '2024-01-02T03:04:05.000Z', revisionDate: '2025-02-03T04:05:06.000Z' },
      { type: 3, name: 'Visa', card: { cardholderName: 'Anna Example', brand: 'Visa', number: '4111111111111111', expMonth: '7', expYear: '2030', code: '123' } },
      { type: 2, name: 'Secret note', notes: 'Text' },
      { type: 9, name: 'Future type' }
    ]
  });
  const parsed = parseImport(json);
  assert.equal(parsed.format, 'bitwarden-json');
  assert.deepEqual(titles(parsed.items), ['Bank', 'Visa', 'Secret note']);
  const [bank, visa] = parsed.items;
  assert.deepEqual(bank.folder, ['Finance']);
  assert.equal(bank.url, 'https://bank.example');
  assert.equal(bank.created?.toISOString(), '2024-01-02T03:04:05.000Z');
  assert.deepEqual(bank.fields, [{ name: 'Customer ID', value: '42', protected: false }, { name: 'PIN', value: '0000', protected: true }]);
  assert.deepEqual(visa.fields.map(/** @param field - One field. */ (field) => `${field.name}=${field.value}:${field.protected}`), [
    'Cardholder=Anna Example:false', 'Card brand=Visa:false', 'Card number=4111111111111111:true', 'Expiry date=07/2030:false', 'Security code=123:true'
  ]);
  assert.equal(parsed.problems.length, 1);
  assert.throws(() => parseImport(JSON.stringify({ encrypted: true, items: [] })), /encrypted/);
  assert.throws(() => parseImport('{"vaults": {}}'), /Only JSON exports from Bitwarden/);
  assert.throws(() => parseImport('{broken'), /not valid JSON/);
});

test('1Password, Apple Passwords, Chrome, Firefox, KeePassXC and Proton Pass are recognized', () => {
  const samples = {
    onepassword: 'Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\nMail,https://mail.example,me,pw,,false,false,"private,mail",\n',
    apple: 'Title,URL,Username,Password,Notes,OTPAuth\nShop (me),https://shop.example/,me,pw,,otpauth://totp/Shop?secret=JBSWY3DPEHPK3PXP\n',
    chromium: 'name,url,username,password,note\nforum.example,https://forum.example/login,me,pw,old\n',
    firefox: 'url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged\nhttps://www.news.example,me,pw,,https://www.news.example,{1},1700000000000,1700000000000,1710000000000\n',
    keepassxc: '"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"\n"Root/Private/Games","Steam","me","pw","https://store.example","","","0","2024-05-01T10:00:00Z","2023-05-01T10:00:00Z"\n',
    proton: 'type,name,url,email,username,password,note,totp,createTime,modifyTime,vault\nlogin,Cloud,https://cloud.example,me@example.org,,pw,,,1700000000,1700000100,Personal\n'
  };
  for (const [format, csv] of Object.entries(samples)) assert.equal(parseImport(csv).format, format, format);
  assert.deepEqual(parseImport(samples.onepassword).items[0].tags, ['private', 'mail']);
  assert.match(parseImport(samples.apple).items[0].otp, /^otpauth:/);
  const firefox = parseImport(samples.firefox).items[0];
  assert.equal(firefox.title, 'news.example');
  assert.equal(firefox.modified?.getTime(), 1710000000000);
  assert.deepEqual(parseImport(samples.keepassxc).items[0].folder, ['Private', 'Games']);
  const proton = parseImport(samples.proton).items[0];
  assert.equal(proton.username, 'me@example.org');
  assert.deepEqual(proton.folder, ['Personal']);
  assert.equal(proton.created?.getTime(), 1700000000000);
});

test('other CSV files get guessed columns that the user can change', () => {
  const parsed = parseImport('Site;Login;Kennwort;Kommentar\nexample.org;me;pw;hello\n;;;only notes\n');
  assert.equal(parsed.format, 'generic');
  assert.deepEqual(parsed.table?.mapping, ['url', 'username', 'ignore', 'ignore']);
  assert.equal(parsed.items[0].title, 'example.org');
  assert.equal(parsed.items[0].password, '');
  assert.deepEqual(parsed.problems, [{ line: 3, label: '', reason: 'noTitle' }]);
  const multiline = parseImport('Title;Notes\n"A";"one\ntwo"\n;only notes\n');
  assert.equal(multiline.format, 'generic');
  assert.deepEqual(multiline.problems.map(/** @param problem - One problem. */ (problem) => problem.line), [4]);
  assert.equal(readGeneric(multiline.table.rows, ['title', 'notes'], multiline.table.lines).problems[0].line, 4);
  const remapped = readGeneric(parsed.table.rows, ['url', 'username', 'password', 'notes']);
  assert.equal(remapped.items[0].password, 'pw');
  assert.equal(remapped.items[0].notes, 'hello');
  assert.deepEqual(guessMapping(['Name', 'E-Mail', 'Passwort', 'Ordner', 'Name']), ['title', 'username', 'password', 'folder', 'ignore']);
});

test('duplicates are found by host name and username', () => {
  assert.equal(duplicateKey({ title: 'X', username: 'Me', url: 'https://www.Example.org/login' }), 'example.org\nme');
  const existing = [{ title: 'Example', username: 'me', url: 'https://example.org' }];
  const items = parseImport('name,url,username,password\nA,https://www.example.org/x,ME,1\nB,https://example.org,other,2\n').items;
  assert.deepEqual(titles([...findDuplicates(items, existing)]), ['A']);
});

test('importing creates entries in a new folder with the source folders, fields, tags and dates', () => {
  const db = testVault();
  const root = listFolders(db)[0];
  createFolder(db, root.id, 'Imported 2026-11-27');
  const { items } = parseImport([
    'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp',
    'Work,,login,Mail,,"Title: x\n@exp_date: y\nNotes: z",0,https://mail.example,me,pw,JBSWY3DPEHPK3PXP',
    'Work,,login,Chat,,,0,https://chat.example,me,pw2,'
  ].join('\n'));
  items[1].tags = ['team;chat', 'Team chat', 'x'.repeat(80)];
  items[1].created = new Date('2020-01-01T00:00:00Z');
  const outcome = importItems(db, items, { kind: 'new', name: 'Imported 2026-11-27' }, true);
  assert.equal(outcome.imported, 2);
  const folder = db.getGroup(outcome.folderId);
  assert.equal(folder.name, 'Imported 2026-11-27 (2)');
  assert.deepEqual(folder.groups.map(/** @param group - A subfolder. */ (group) => group.name), ['Work']);
  const entries = listEntries(db).filter(/** @param entry - One entry. */ (entry) => entry.groupPath.endsWith('Imported 2026-11-27 (2) / Work'));
  assert.deepEqual(titles(entries), ['Chat', 'Mail']);
  const [chat, mail] = entries;
  assert.match(mail.otp, /^otpauth:\/\/totp\/Mail\?secret=JBSWY3DPEHPK3PXP/);
  assert.deepEqual(mail.customFields.map(/** @param field - One field. */ (field) => field.name), ['exp_date', 'Notes (2)', 'Title (2)']);
  assert.deepEqual(chat.tags, ['team chat', 'x'.repeat(64)]);
  assert.equal(chat.created?.toISOString(), '2020-01-01T00:00:00.000Z');
  assert.equal(chat.modified?.toISOString(), '2020-01-01T00:00:00.000Z');

  const flat = importItems(db, items, { kind: 'folder', id: root.id }, false);
  assert.equal(flat.folderId, root.id);
  assert.equal(db.getGroup(root.id).entries.length, 2);
});

test('the export lists regular entries as KeePassXC CSV and reads back the same', () => {
  const db = testVault();
  const root = listFolders(db)[0];
  const web = createFolder(db, root.id, 'Web');
  createEntry(db, { title: '=SUM(1)', username: 'me', password: '-pw', url: 'https://a.example', notes: 'two\nlines', otp: '', tags: ['a', 'b'] }, web.uuid.id);
  const trashed = createEntry(db, { title: 'Old', username: '', password: '', url: '', notes: '', otp: '' });
  db.remove(trashed);
  const plain = exportCsv(db, { neutralizeFormulas: false });
  assert.equal(plain.count, 1);
  const [header, row] = parseCsv(plain.csv).rows;
  assert.deepEqual(header, ['Group', 'Title', 'Username', 'Password', 'URL', 'Notes', 'TOTP', 'Tags', 'Last Modified', 'Created']);
  assert.deepEqual(row.slice(0, 8), [`${root.name}/Web`, '=SUM(1)', 'me', '-pw', 'https://a.example', 'two\nlines', '', 'a,b']);
  const again = parseImport(plain.csv);
  assert.equal(again.format, 'keepassxc');
  assert.deepEqual(again.items[0].folder, ['Web']);
  assert.deepEqual(again.items[0].tags, ['a', 'b']);

  const safe = parseCsv(exportCsv(db, { neutralizeFormulas: true }).csv).rows[1];
  assert.equal(safe[1], "'=SUM(1)");
  assert.equal(safe[3], '-pw');
  assert.equal(neutralizeFormula('@x'), "'@x");
  assert.equal(neutralizeFormula('plain'), 'plain');
  assert.equal(exportCsv(db, { folderId: web.uuid.id, neutralizeFormulas: false }).count, 1);
  assert.equal(exportFileName('Family.kdbx', new Date(2026, 10, 7)), 'keeport-Family-2026-11-07.csv');
});
