import { randomBelow } from './password.ts';

/** Separators the passphrase generator offers. */
export const PASSPHRASE_SEPARATORS = { hyphen: '-', space: ' ', dot: '.', underscore: '_', none: '' } as const;
export type PassphraseSeparator = keyof typeof PASSPHRASE_SEPARATORS;

export interface PassphraseOptions {
  words: number;
  separator: PassphraseSeparator;
  /** Starts every word with a capital letter. */
  capitalize: boolean;
  /** Adds one digit to a random word, for sites that require a number. */
  addNumber: boolean;
}

export const MIN_PASSPHRASE_WORDS = 4;
export const MAX_PASSPHRASE_WORDS = 10;

let wordlist: Promise<readonly string[]> | null = null;

/** Loads the EFF Large Wordlist once, as a separate file that is only fetched when passphrases are used. */
export function loadWordlist(): Promise<readonly string[]> {
  wordlist ??= import('./wordlists/eff-large.ts').then(/**
   * Selects the word list from the module.
   * @param module - The loaded word list module.
   */ (module) => module.EFF_LARGE_WORDLIST);
  return wordlist;
}

/**
 * Generates a passphrase from random words of the list, chosen with the browser's cryptographic random source.
 * @param options - The number of words, the separator, capitalization and whether to add a digit.
 * @param words - The word list, usually the EFF Large Wordlist.
 */
export function generatePassphrase(options: PassphraseOptions, words: readonly string[]): string {
  if (words.length < 2) throw new Error('The word list is empty.');
  const count = Math.min(MAX_PASSPHRASE_WORDS, Math.max(MIN_PASSPHRASE_WORDS, Math.round(options.words)));
  const chosen = Array.from({ length: count }, /** Picks one random word. */ () => words[randomBelow(words.length)]);
  const shaped = options.capitalize ? chosen.map(/**
   * Capitalizes a word.
   * @param word - One word.
   */ (word) => word.charAt(0).toUpperCase() + word.slice(1)) : chosen;
  if (options.addNumber) {
    const index = randomBelow(shaped.length);
    shaped[index] = `${shaped[index]}${randomBelow(10)}`;
  }
  return shaped.join(PASSPHRASE_SEPARATORS[options.separator]);
}

/**
 * Returns the entropy of passphrases generated with these options, in bits.
 * @param options - The passphrase options.
 * @param listSize - The number of words in the list.
 */
export function passphraseEntropyBits(options: PassphraseOptions, listSize: number): number {
  const count = Math.min(MAX_PASSPHRASE_WORDS, Math.max(MIN_PASSPHRASE_WORDS, Math.round(options.words)));
  const digit = options.addNumber ? Math.log2(10) + Math.log2(count) : 0;
  return Math.floor(count * Math.log2(listSize) + digit);
}
