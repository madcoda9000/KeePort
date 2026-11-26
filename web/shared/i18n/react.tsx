import { Fragment, useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { getLanguage, subscribeLanguage, translate, type Catalog, type Language, type Messages, type Params } from './core.ts';

/** Returns the current interface language and re-renders the component when it changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

/** A translate function bound to one catalog, with `rich` for texts that embed React elements. */
export interface Translator<T extends Messages> {
  (key: keyof T, params?: Params): string;
  /**
   * Translates a text and puts React elements into its {placeholders}, e.g. a link or bold text.
   * @param key - The text's key.
   * @param parts - Elements or values for the placeholders; a "count" also selects the plural form.
   */
  rich: (key: keyof T, parts: Record<string, ReactNode>) => ReactNode;
}

/**
 * Splits a translated text at {placeholders} and puts the given elements in their place.
 * @param text - The translated text, before placeholders are filled.
 * @param parts - Elements or values for the placeholders.
 */
export function fillParts(text: string, parts: Record<string, ReactNode>): ReactNode {
  const pieces = text.split(/(\{\w+\})/g);
  return pieces.map(/**
   * Renders one piece: a placeholder's element, or plain text.
   * @param piece - The text piece.
   * @param index - Its position, used as key.
   */ (piece, index) => {
    const match = /^\{(\w+)\}$/.exec(piece);
    if (match && match[1] in parts) return <Fragment key={index}>{parts[match[1]]}</Fragment>;
    return piece ? <Fragment key={index}>{piece}</Fragment> : null;
  });
}

/**
 * Returns a translate function for one catalog that follows the current language.
 * @param catalog - The catalog of the area, created with defineMessages.
 */
export function useT<T extends Messages>(catalog: Catalog<T>): Translator<T> {
  const language = useLanguage();
  // The language is a dependency so components re-render with new texts when it changes.
  const t = useCallback(/**
   * Translates one text.
   * @param key - The text's key.
   * @param params - Values for placeholders.
   */ (key: keyof T, params?: Params) => translate(catalog, key, params, language), [catalog, language]) as Translator<T>;
  t.rich = /**
   * Translates a text and fills placeholders with elements.
   * @param key - The text's key.
   * @param parts - Elements or values for the placeholders.
   */ (key, parts) => {
    const count = typeof parts.count === 'number' ? parts.count : undefined;
    // Translate with only the plain values filled in, so element placeholders survive for fillParts.
    const plain: Params = {};
    for (const [name, value] of Object.entries(parts)) {
      if (typeof value === 'string' || typeof value === 'number') plain[name] = value;
    }
    const text = translate(catalog, key, count === undefined ? plain : { ...plain, count }, language);
    return fillParts(text, parts);
  };
  return t;
}
