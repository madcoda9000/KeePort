/** Character groups the password generator can use. */
export const CHARACTER_SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!#$%&()*+,-./:;<=>?@[]^_{|}~'
} as const;

/** Characters that are easy to confuse when read or typed by hand. */
const LOOK_ALIKES = new Set('Il1O0o');

export type CharacterSet = keyof typeof CHARACTER_SETS;

export interface PasswordOptions {
  length: number;
  sets: readonly CharacterSet[];
  /** Leaves out look-alike characters such as I, l, 1, O and 0. */
  avoidLookAlikes: boolean;
}

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Returns a uniformly distributed random integer below a limit, using rejection sampling on the Web Crypto API so no
 * value is more likely than another.
 * @param limit - The exclusive upper bound, at most 2^32.
 */
function randomBelow(limit: number): number {
  const buffer = new Uint32Array(1);
  const ceiling = Math.floor(0x100000000 / limit) * limit;
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < ceiling) return buffer[0] % limit;
  }
}

/**
 * Returns the characters of one group, without look-alikes when requested.
 * @param set - The character group.
 * @param avoidLookAlikes - Whether to leave out look-alike characters.
 */
function charactersOf(set: CharacterSet, avoidLookAlikes: boolean): string[] {
  return [...CHARACTER_SETS[set]].filter(/**
   * Drops look-alike characters if requested.
   * @param char - One character.
   */ (char) => !avoidLookAlikes || !LOOK_ALIKES.has(char));
}

/**
 * Generates a random password that contains at least one character of every chosen group.
 * @param options - The length, the character groups and whether to avoid look-alike characters.
 */
export function generatePassword(options: PasswordOptions): string {
  const groups = options.sets.map(/**
   * Resolves the characters of a group.
   * @param set - One chosen group.
   */ (set) => charactersOf(set, options.avoidLookAlikes)).filter(/**
   * Drops empty groups.
   * @param chars - The characters of one group.
   */ (chars) => chars.length > 0);
  if (!groups.length) throw new Error('Choose at least one character group.');
  const length = Math.min(MAX_PASSWORD_LENGTH, Math.max(MIN_PASSWORD_LENGTH, Math.round(options.length), groups.length));
  const all = groups.flat();
  // One character from every group guarantees that each chosen group appears; the rest is drawn from all characters.
  const chars = groups.map(/**
   * Picks one character of a group.
   * @param group - The characters of one group.
   */ (group) => group[randomBelow(group.length)]);
  while (chars.length < length) chars.push(all[randomBelow(all.length)]);
  // Fisher-Yates shuffle so the guaranteed characters are not always at the start.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomBelow(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * Estimates the strength of a generated password in bits of entropy.
 * @param options - The options the password is generated with.
 */
export function passwordEntropyBits(options: PasswordOptions): number {
  const pool = new Set(options.sets.flatMap(/**
   * Resolves the characters of a group.
   * @param set - One chosen group.
   */ (set) => charactersOf(set, options.avoidLookAlikes))).size;
  return pool > 1 ? Math.floor(options.length * Math.log2(pool)) : 0;
}

/**
 * Describes an entropy value in words for the strength indicator.
 * @param bits - The entropy in bits.
 */
export function strengthLabel(bits: number): 'Weak' | 'Fair' | 'Strong' | 'Very strong' {
  if (bits < 60) return 'Weak';
  if (bits < 80) return 'Fair';
  if (bits < 112) return 'Strong';
  return 'Very strong';
}
