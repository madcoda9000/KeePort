import * as kdbxweb from 'kdbxweb';
import messages from '../i18n/lib-fields.ts';
import { translate } from '../../../shared/i18n/core.ts';

/** The KeePass standard fields, edited by the fixed inputs of the entry form. */
export const STANDARD_FIELDS = ['Title', 'UserName', 'Password', 'URL', 'Notes'] as const;
export type StandardField = (typeof STANDARD_FIELDS)[number];

/** The field holding the TOTP setting, edited by its own input. */
export const OTP_FIELD = 'otp';

/** Field that marks an entry as a KeePass2Android / KPEntryTemplates template. */
const TEMPLATE_MARKER = '_etm_template';
/** Field of an entry created from a template that holds the template's UUID as hex text. */
const TEMPLATE_REFERENCE = '_etm_template_uuid';
/** Name of the template pseudo field for the entry's expiry date. */
const EXPIRY_KEY = '@exp_date';

/** Longest custom field name KeePort accepts. */
export const MAX_FIELD_NAME_LENGTH = 255;

/** A custom (non-standard) string field of an entry. */
export interface CustomField {
  name: string;
  value: string;
  protected: boolean;
}

/** One field definition of a template. */
export interface TemplateField {
  /** The field name the value is stored under, or a special name such as @exp_date. */
  name: string;
  /** The label shown for the field. */
  title: string;
  /** The template type, e.g. Inline, Protected Inline or Date Time. */
  type: string;
  position: number;
  protected: boolean;
  /** How the field is stored: a standard field, a custom field, the expiry date, or something KeePort does not edit. */
  kind: 'standard' | 'custom' | 'expiry' | 'other';
}

/** A template entry and the fields it defines, ordered by position. */
export interface TemplateInfo {
  /** The base64 UUID of the template entry. */
  id: string;
  title: string;
  fields: TemplateField[];
  entry: kdbxweb.KdbxEntry;
}

/**
 * Reads a plain or protected field value as text.
 * @param value - The raw KDBX field value, or undefined.
 */
function text(value: kdbxweb.KdbxEntryField | undefined): string {
  if (value === undefined) return '';
  if (value instanceof kdbxweb.ProtectedValue) return value.getText();
  return String(value);
}

/**
 * Checks whether a field is an internal marker of KeePass2Android or KPEntryTemplates that must never be shown.
 * @param name - The field name.
 */
export function isInternalField(name: string): boolean {
  return name.startsWith('_etm_') || name.startsWith('KP2A_');
}

/**
 * Checks whether a field is edited by the fixed inputs of the entry form.
 * @param name - The field name.
 */
function isFixedField(name: string): boolean {
  return (STANDARD_FIELDS as readonly string[]).includes(name) || name === OTP_FIELD;
}

/**
 * Returns the custom fields of an entry without standard and internal fields, sorted by name.
 * @param entry - The entry to read.
 */
export function readCustomFields(entry: kdbxweb.KdbxEntry): CustomField[] {
  const out: CustomField[] = [];
  for (const [name, value] of entry.fields) {
    if (isFixedField(name) || isInternalField(name)) continue;
    out.push({ name, value: text(value), protected: value instanceof kdbxweb.ProtectedValue });
  }
  return out.sort(/**
   * Sorts fields by name, ignoring case.
   * @param a - The first field.
   * @param b - The second field.
   */ (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Checks whether an entry is a template definition rather than a regular entry.
 * @param entry - The entry to check.
 */
export function isTemplateEntry(entry: kdbxweb.KdbxEntry): boolean {
  return entry.fields.has(TEMPLATE_MARKER);
}

/**
 * Converts a KDBX UUID to the upper-case hex text KeePass2Android stores in `_etm_template_uuid`.
 * @param uuid - The UUID to convert.
 */
export function uuidToHex(uuid: kdbxweb.KdbxUuid): string {
  return [...new Uint8Array(uuid.toBytes())].map(/**
   * Formats one byte as two hex digits.
   * @param byte - One byte of the UUID.
   */ (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Reads the field definitions of a template entry.
 * @param entry - A template entry (with `_etm_template`).
 */
export function readTemplate(entry: kdbxweb.KdbxEntry): TemplateInfo {
  const fields: TemplateField[] = [];
  for (const name of entry.fields.keys()) {
    if (!name.startsWith('_etm_title_')) continue;
    const key = name.slice('_etm_title_'.length);
    const type = text(entry.fields.get(`_etm_type_${key}`)) || 'Inline';
    const position = Number.parseInt(text(entry.fields.get(`_etm_position_${key}`)), 10);
    const kind: TemplateField['kind'] = key === EXPIRY_KEY
      ? 'expiry'
      : key.startsWith('@') || type === 'Divider' || type === '@confirm'
        ? 'other'
        : (STANDARD_FIELDS as readonly string[]).includes(key) ? 'standard' : 'custom';
    fields.push({
      name: key,
      title: text(entry.fields.get(name)) || key,
      type,
      position: Number.isFinite(position) ? position : Number.MAX_SAFE_INTEGER,
      protected: type.startsWith('Protected'),
      kind
    });
  }
  fields.sort(/**
   * Orders fields by their template position.
   * @param a - The first field.
   * @param b - The second field.
   */ (a, b) => a.position - b.position);
  return { id: entry.uuid.id, title: text(entry.fields.get('Title')) || 'Template', fields, entry };
}

/**
 * Lists all template entries of the database, sorted by title.
 * @param db - The unlocked database.
 */
export function listTemplates(db: kdbxweb.Kdbx): TemplateInfo[] {
  const templates: TemplateInfo[] = [];
  for (const group of db.groups) {
    for (const entry of group.allEntries()) {
      if (isTemplateEntry(entry)) templates.push(readTemplate(entry));
    }
  }
  return templates.sort(/**
   * Sorts templates by title.
   * @param a - The first template.
   * @param b - The second template.
   */ (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

/**
 * Finds the template an entry was created from, or null.
 * @param templates - The templates of the database, from listTemplates.
 * @param entry - The entry to look up.
 */
export function findTemplate(templates: readonly TemplateInfo[], entry: kdbxweb.KdbxEntry): TemplateInfo | null {
  const reference = text(entry.fields.get(TEMPLATE_REFERENCE)).trim().toUpperCase();
  if (!reference) return null;
  return templates.find(/**
   * Compares a template's UUID with the reference.
   * @param template - One template of the database.
   */ (template) => uuidToHex(template.entry.uuid) === reference) ?? null;
}

/**
 * Marks fields as protected when their template defines them as protected. An empty protected value is written as
 * plain text by KDBX libraries, so without this a CVV entered later would be stored unprotected.
 * @param fields - The entry's custom fields.
 * @param template - The entry's template, or null.
 */
export function withTemplateProtection(fields: CustomField[], template: TemplateInfo | null): CustomField[] {
  if (!template) return fields;
  return fields.map(/**
   * Applies the template's protection to one field.
   * @param field - One custom field.
   */ (field) => (template.fields.some(/**
     * Checks whether the template protects the field.
     * @param item - One template field.
     */ (item) => item.name === field.name && item.protected) ? { ...field, protected: true } : field));
}

/**
 * Returns the expiry date of an entry as YYYY-MM-DD in local time, or an empty string if it does not expire.
 * @param entry - The entry to read.
 */
export function readExpiry(entry: kdbxweb.KdbxEntry): string {
  const date = entry.times.expires ? entry.times.expiryTime : undefined;
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = /**
   * Pads a date part to two digits.
   * @param value - The number to pad.
   */ (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Sets or clears the expiry date of an entry.
 * @param entry - The entry to change.
 * @param value - A YYYY-MM-DD date, or an empty string for no expiry.
 */
export function writeExpiry(entry: kdbxweb.KdbxEntry, value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    entry.times.expires = false;
    return;
  }
  entry.times.expires = true;
  entry.times.expiryTime = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * Replaces the custom fields of an entry: listed fields are written with their protection, other custom fields are
 * removed. Standard, TOTP and internal fields are left untouched.
 * @param entry - The entry to change.
 * @param fields - The complete list of custom fields the entry should have.
 */
export function writeCustomFields(entry: kdbxweb.KdbxEntry, fields: readonly CustomField[]) {
  const keep = new Set(fields.map(/**
   * Selects the field name.
   * @param field - One custom field.
   */ (field) => field.name));
  for (const name of [...entry.fields.keys()]) {
    if (!isFixedField(name) && !isInternalField(name) && !keep.has(name)) entry.fields.delete(name);
  }
  for (const field of fields) {
    entry.fields.set(field.name, field.protected ? kdbxweb.ProtectedValue.fromString(field.value) : field.value);
  }
}

/**
 * Marks a new entry as created from a template, as KeePass2Android does: it gets the template's reference and icon.
 * @param entry - The new entry.
 * @param template - The template it was created from.
 */
export function linkTemplate(entry: kdbxweb.KdbxEntry, template: TemplateInfo) {
  entry.fields.set(TEMPLATE_REFERENCE, uuidToHex(template.entry.uuid));
  if (template.entry.icon !== undefined) entry.icon = template.entry.icon;
  if (template.entry.customIcon) entry.customIcon = template.entry.customIcon;
}

/**
 * Returns the custom fields a new entry from a template starts with, using the template's default values.
 * @param template - The template.
 */
export function templateStartFields(template: TemplateInfo): CustomField[] {
  return template.fields
    .filter(/**
     * Keeps custom fields.
     * @param field - One template field.
     */ (field) => field.kind === 'custom')
    .map(/**
     * Creates the starting value of a field.
     * @param field - One custom template field.
     */ (field) => ({ name: field.name, value: text(template.entry.fields.get(field.name)), protected: field.protected }));
}

/**
 * Validates a new custom field name and returns an error message, or null if it can be used.
 * @param name - The proposed name.
 * @param existing - The names of the entry's other custom fields.
 */
export function customFieldNameError(name: string, existing: readonly string[]): string | null {
  const trimmed = name.trim();
  if (!trimmed) return translate(messages, 'nameRequired');
  if (trimmed.length > MAX_FIELD_NAME_LENGTH) return translate(messages, 'nameTooLong', { max: MAX_FIELD_NAME_LENGTH });
  const lower = trimmed.toLowerCase();
  if ([...STANDARD_FIELDS, OTP_FIELD].some(/**
   * Detects a clash with a standard field.
   * @param standard - One standard field name.
   */ (standard) => standard.toLowerCase() === lower)) return translate(messages, 'standardField', { name: trimmed });
  if (isInternalField(trimmed) || trimmed.startsWith('@')) return translate(messages, 'reserved');
  if (existing.some(/**
   * Detects a clash with another custom field.
   * @param other - The name of another custom field.
   */ (other) => other.toLowerCase() === lower)) return translate(messages, 'duplicate', { name: trimmed });
  return null;
}
