/**
 * KeePort's small translation layer: English, German and French, with English as the fallback for every text that a
 * language does not (yet) translate. Works without React, so API clients and helpers can translate too.
 */

/** The supported interface languages; English is the fallback. */
export const LANGUAGES = ['en', 'de', 'fr'] as const;

/** One supported interface language. */
export type Language = (typeof LANGUAGES)[number];

/** A stored language choice: a language, or null to follow the browser. */
export type LanguagePreference = Language | null;

/** Each language's own name, for the language menus. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', de: 'Deutsch', fr: 'Français' };

/** The locale used for dates and numbers in each language. */
const LOCALES: Record<Language, string> = { en: 'en-US', de: 'de-DE', fr: 'fr-FR' };

/** A text whose wording depends on a count: "one" for the singular, "other" for the plural, optional "zero". */
export interface PluralText {
  zero?: string;
  one: string;
  other: string;
}

/** One translatable text. */
export type Text = string | PluralText;

/** The English texts of one area of the interface, by key. */
export type Messages = Record<string, Text>;

/** Translations of an English catalog; missing keys fall back to English, plural keys stay plural. */
export type Translations<T extends Messages> = { [K in keyof T]?: T[K] extends string ? string : PluralText };

/** The texts of one area of the interface in all languages. */
export interface Catalog<T extends Messages> {
  en: T;
  de: Translations<T>;
  fr: Translations<T>;
}

/** Values filled into {placeholders}; a "count" also selects the plural form. */
export type Params = Record<string, string | number>;

/**
 * Declares the texts of one area of the interface. English defines the keys; the other languages may leave keys out.
 * @param catalog - The English texts and their German and French translations.
 */
export function defineMessages<T extends Messages>(catalog: Catalog<T>): Catalog<T> {
  return catalog;
}

const STORAGE_KEY = 'keeport-language';
const listeners = new Set<() => void>();
let current: Language = 'en';

/**
 * Checks whether a value names a supported language.
 * @param value - Any value, e.g. from storage or the server.
 */
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Picks the first supported language from the browser's preferred languages, e.g. "de-AT" gives German.
 * @param preferred - The browser's languages; defaults to navigator.languages.
 */
export function browserLanguage(preferred: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

/** Reads the choice stored in this browser: a language, or null when the browser language should be used. */
export function storedPreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

/** The language currently shown. */
export function getLanguage(): Language {
  return current;
}

/**
 * Registers a callback for language changes and returns the function that removes it.
 * @param listener - Called after every change.
 */
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return /** Removes the listener. */ () => listeners.delete(listener);
}

/**
 * Shows the interface in a language now, without storing the choice.
 * @param language - The language to show.
 */
export function setLanguage(language: Language) {
  if (language === current) return;
  current = language;
  if (typeof document !== 'undefined') document.documentElement.lang = language;
  listeners.forEach(/**
   * Notifies one listener.
   * @param listener - The callback to call.
   */ (listener) => listener());
}

/**
 * Stores a choice in this browser and applies it: a language, or null to follow the browser.
 * @param preference - The language, or null for automatic.
 */
export function applyPreference(preference: LanguagePreference) {
  try {
    if (preference) localStorage.setItem(STORAGE_KEY, preference);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked; the choice then lasts until the page is reloaded.
  }
  setLanguage(preference ?? browserLanguage());
}

/**
 * Fills {placeholders} in a text; unknown placeholders stay visible so mistakes are easy to spot.
 * @param text - The text with placeholders.
 * @param params - The values to insert.
 */
export function interpolate(text: string, params: Params = {}): string {
  return text.replace(/\{(\w+)\}/g, /**
   * Replaces one placeholder.
   * @param match - The whole placeholder.
   * @param name - Its name.
   */ (match, name: string) => (name in params ? formatParam(params[name]) : match));
}

/**
 * Formats a placeholder value; numbers use the language's digit grouping.
 * @param value - The value to insert.
 */
function formatParam(value: string | number) {
  return typeof value === 'number' ? value.toLocaleString(LOCALES[current]) : value;
}

/**
 * Picks the plural form for a count in a language, e.g. French counts 0 and 1 as singular.
 * @param text - The plural forms.
 * @param count - The number the text refers to.
 * @param language - The language whose plural rules apply.
 */
function selectPlural(text: PluralText, count: number, language: Language): string {
  if (count === 0 && text.zero !== undefined) return text.zero;
  return new Intl.PluralRules(LOCALES[language]).select(count) === 'one' ? text.one : text.other;
}

/**
 * Translates one text into the current language, falling back to English. Plural texts need a "count" parameter.
 * @param catalog - The catalog of the area.
 * @param key - The text's key.
 * @param params - Values for placeholders.
 * @param language - The language; defaults to the current one.
 */
export function translate<T extends Messages>(catalog: Catalog<T>, key: keyof T, params?: Params, language: Language = current): string {
  const own = catalog[language][key];
  const text = (own ?? catalog.en[key]) as Text | undefined;
  if (text === undefined) return String(key);
  const usedLanguage = own === undefined ? 'en' : language;
  const resolved = typeof text === 'string' ? text : selectPlural(text, Number(params?.count ?? 0), usedLanguage);
  return interpolate(resolved, params);
}

/** The locale tag of the current language, for Intl APIs, e.g. "de-DE". */
export function currentLocale(): string {
  return LOCALES[current];
}

/**
 * Formats a date and time in the current language; returns the input unchanged when it is not a date.
 * @param value - An ISO timestamp or a Date.
 * @param options - Intl options; defaults to a short date and time.
 */
export function formatDateTime(value: string | Date, options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' }): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(LOCALES[current], options);
}

/**
 * Formats a number in the current language.
 * @param value - The number.
 * @param options - Intl options.
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(LOCALES[current], options);
}

/**
 * Describes how long ago (or how far ahead) a time is, e.g. "2 minutes ago", "vor 2 Minuten", "il y a 2 minutes".
 * @param value - An ISO timestamp or a Date.
 * @param now - The reference time.
 */
export function formatRelative(value: string | Date, now: Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(LOCALES[current], { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit);
  }
  return format.format(0, 'second');
}

// Show the stored or browser language right away, before anything renders.
if (typeof window !== 'undefined') setLanguage(storedPreference() ?? browserLanguage());
