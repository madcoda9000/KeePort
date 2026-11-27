import type { CustomField } from '../fields.ts';
import {
  MAX_IMPORT_ITEMS,
  emptyItem,
  finishItem,
  readDate,
  splitFolder,
  type ImportItem,
  type ImportProblem,
  type ParsedImport
} from './formats.ts';
import messages from '../../i18n/lib-import.ts';
import { translate } from '../../../../shared/i18n/core.ts';

/** The parts of a Bitwarden JSON export KeePort reads. */
interface BitwardenExport {
  encrypted?: boolean;
  passwordProtected?: boolean;
  folders?: { id?: string; name?: string }[];
  collections?: { id?: string; name?: string }[];
  items?: BitwardenItem[];
}

/** One item of a Bitwarden JSON export. */
interface BitwardenItem {
  type?: number;
  name?: string;
  notes?: string | null;
  folderId?: string | null;
  collectionIds?: string[] | null;
  creationDate?: string;
  revisionDate?: string;
  fields?: { name?: string | null; value?: string | null; type?: number }[] | null;
  login?: { username?: string | null; password?: string | null; totp?: string | null; uris?: { uri?: string | null }[] | null } | null;
  card?: Record<string, string | null | undefined> | null;
  identity?: Record<string, string | null | undefined> | null;
  sshKey?: { privateKey?: string | null; publicKey?: string | null; keyFingerprint?: string | null } | null;
}

/** The Bitwarden item types. */
const TYPE_NAMES: Record<number, string> = { 1: 'login', 2: 'note', 3: 'card', 4: 'identity', 5: 'sshKey' };

/** The catalog keys of the field names KeePort uses for Bitwarden's structured items. */
type FieldKey =
  | 'cardholder' | 'cardBrand' | 'cardNumber' | 'cardExpiry' | 'cardCode'
  | 'fullName' | 'company' | 'email' | 'phone' | 'address' | 'ssn' | 'passport' | 'license'
  | 'privateKey' | 'publicKey' | 'fingerprint';

/**
 * Turns an optional value into text.
 * @param value - The JSON value.
 */
function text(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

/**
 * Builds a custom field with a translated name, or nothing when the value is empty.
 * @param key - The catalog key of the field name.
 * @param value - The value.
 * @param secret - Whether the value is protected in the vault.
 */
function field(key: FieldKey, value: string, secret = false): CustomField[] {
  return value.trim() ? [{ name: translate(messages, key), value, protected: secret }] : [];
}

/**
 * Joins the non-empty parts with a separator.
 * @param separator - The separator.
 * @param parts - The parts.
 */
function join(separator: string, ...parts: string[]): string {
  return parts.map(/**
   * Trims one part.
   * @param part - The part.
   */ (part) => part.trim()).filter(Boolean).join(separator);
}

/**
 * Reads the fields of a card.
 * @param card - The card of the item.
 */
function cardFields(card: NonNullable<BitwardenItem['card']>): CustomField[] {
  const expiry = join('/', text(card.expMonth).padStart(card.expMonth ? 2 : 0, '0'), text(card.expYear));
  return [
    ...field('cardholder', text(card.cardholderName)),
    ...field('cardBrand', text(card.brand)),
    ...field('cardNumber', text(card.number), true),
    ...field('cardExpiry', expiry),
    ...field('cardCode', text(card.code), true)
  ];
}

/**
 * Reads the fields of an identity; the name and the address are joined into one field each.
 * @param identity - The identity of the item.
 */
function identityFields(identity: NonNullable<BitwardenItem['identity']>): CustomField[] {
  /**
   * Reads one value of the identity.
   * @param key - The property.
   */
  const get = (key: string) => text(identity[key]);
  const address = join('\n', get('address1'), get('address2'), get('address3'), join(' ', get('postalCode'), get('city')), get('state'), get('country'));
  return [
    ...field('fullName', join(' ', get('title'), get('firstName'), get('middleName'), get('lastName'))),
    ...field('company', get('company')),
    ...field('email', get('email')),
    ...field('phone', get('phone')),
    ...field('address', address),
    ...field('ssn', get('ssn'), true),
    ...field('passport', get('passportNumber'), true),
    ...field('license', get('licenseNumber'), true)
  ];
}

/**
 * Reads the item's own fields: hidden fields are protected, linked fields are left out.
 * @param fields - The item's fields.
 */
function ownFields(fields: BitwardenItem['fields']): CustomField[] {
  return (fields ?? []).filter(/**
   * Leaves out linked fields, which only point to another value.
   * @param item - One field.
   */ (item) => item.type !== 3).map(/**
   * Converts one field.
   * @param item - One field.
   */ (item) => ({ name: text(item.name), value: text(item.value), protected: item.type === 1 }));
}

/**
 * Reads one item into an entry, or returns a problem.
 * @param item - The Bitwarden item.
 * @param line - Its position in the file, starting at 1.
 * @param folders - The folder names by ID, including collections.
 */
function readItem(item: BitwardenItem, line: number, folders: ReadonlyMap<string, string>): ImportItem | ImportProblem {
  const type = TYPE_NAMES[item.type ?? 0];
  if (!type) return { line, label: text(item.name), reason: 'unsupportedType', detail: text(item.type) };
  const uris = (item.login?.uris ?? []).map(/**
   * Reads one address.
   * @param uri - The address entry.
   */ (uri) => text(uri.uri).trim()).filter(Boolean);
  const folderName = folders.get(text(item.folderId)) ?? folders.get(text(item.collectionIds?.[0])) ?? '';
  const fields: CustomField[] = [
    ...uris.slice(1).map(/**
     * Turns an additional address into a field.
     * @param uri - The address.
     * @param index - Its position after the first address.
     */ (uri, index) => ({ name: translate(messages, 'extraUrl', { number: index + 2 }), value: uri, protected: false })),
    ...(item.card ? cardFields(item.card) : []),
    ...(item.identity ? identityFields(item.identity) : []),
    ...(item.sshKey
      ? [
          ...field('privateKey', text(item.sshKey.privateKey), true),
          ...field('publicKey', text(item.sshKey.publicKey)),
          ...field('fingerprint', text(item.sshKey.keyFingerprint))
        ]
      : []),
    ...ownFields(item.fields)
  ];
  return finishItem({
    ...emptyItem(line),
    title: text(item.name),
    username: text(item.login?.username) || text(item.identity?.username),
    password: text(item.login?.password),
    url: uris[0] ?? '',
    notes: text(item.notes),
    otp: text(item.login?.totp),
    folder: splitFolder(folderName),
    fields,
    created: readDate(text(item.creationDate)),
    modified: readDate(text(item.revisionDate))
  });
}

/**
 * Reads an unencrypted Bitwarden JSON export, including organization exports with collections. Encrypted exports
 * cannot be read without the Bitwarden account, so they are refused with a hint.
 * @param content - The file content.
 */
export function parseBitwardenJson(content: string): ParsedImport {
  let data: BitwardenExport;
  try {
    data = JSON.parse(content) as BitwardenExport;
  } catch {
    throw new Error(translate(messages, 'invalidJson'));
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(translate(messages, 'unknownJson'));
  if (data.encrypted || data.passwordProtected) throw new Error(translate(messages, 'encryptedJson'));
  if (!Array.isArray(data.items)) throw new Error(translate(messages, 'unknownJson'));
  if (!data.items.length) throw new Error(translate(messages, 'noEntries'));
  if (data.items.length > MAX_IMPORT_ITEMS) throw new Error(translate(messages, 'tooMany', { max: MAX_IMPORT_ITEMS }));
  const folders = new Map<string, string>();
  for (const folder of [...(data.folders ?? []), ...(data.collections ?? [])]) {
    if (folder.id) folders.set(folder.id, text(folder.name));
  }
  const items: ImportItem[] = [];
  const problems: ImportProblem[] = [];
  data.items.forEach(/**
   * Reads one item.
   * @param item - The Bitwarden item.
   * @param index - Its position.
   */ (item, index) => {
    const result = readItem(item ?? {}, index + 1, folders);
    if ('reason' in result) problems.push(result);
    else items.push(result);
  });
  return { format: 'bitwarden-json', items, problems };
}
