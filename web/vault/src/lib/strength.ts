import { COMMON_PASSWORDS } from './wordlists/common-passwords.ts';
import messages from '../i18n/lib-strength.ts';
import { translate } from '../../../shared/i18n/core.ts';

/** Passwords below this estimate count as weak in the security report. */
export const WEAK_PASSWORD_BITS = 60;

/** Keyboard rows used to detect patterns such as "qwerty" or "asdf". */
const KEYBOARD_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'qwertzuiop', 'yxcvbnm'];

/** Common character substitutions ("leetspeak") reversed to find common passwords behind them. */
const SUBSTITUTIONS: Record<string, string> = { '@': 'a', '4': 'a', '0': 'o', '1': 'i', '!': 'i', '3': 'e', '$': 's', '5': 's', '7': 't' };

export interface StrengthEstimate {
  /** The estimated entropy in bits; an upper bound for passwords chosen by people. */
  bits: number;
  /** Whether the password counts as weak: below the threshold or based on a common password. */
  weak: boolean;
  /** Short reasons, e.g. "Common password" or "Keyboard pattern". */
  hints: string[];
}

/**
 * Returns the size of the character pool a password draws from.
 * @param password - The password.
 */
function poolSize(password: string): number {
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/\d/.test(password)) pool += 10;
  if (/[!-/:-@[-`{-~ ]/.test(password)) pool += 33;
  if (/[^\x20-\x7e]/.test(password)) pool += 100;
  return Math.max(pool, 1);
}

/**
 * Checks whether a character continues a run: the same character, the next or previous one (abc, 321), or the
 * neighbour on a keyboard row (qwe, asd).
 * @param previous - The previous character, lower case.
 * @param current - The current character, lower case.
 */
function continuesPattern(previous: string, current: string): 'repeat' | 'sequence' | 'keyboard' | null {
  if (previous === current) return 'repeat';
  const step = current.charCodeAt(0) - previous.charCodeAt(0);
  if (Math.abs(step) === 1 && /[a-z0-9]/.test(previous) && /[a-z0-9]/.test(current)) return 'sequence';
  for (const row of KEYBOARD_ROWS) {
    const index = row.indexOf(previous);
    if (index >= 0 && (row[index + 1] === current || row[index - 1] === current)) return 'keyboard';
  }
  return null;
}

/**
 * Checks whether a password is a common password, possibly with substitutions, capital letters or digits and
 * symbols appended (e.g. "P@ssw0rd2024!").
 * @param password - The password.
 */
function isBasedOnCommon(password: string): boolean {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return true;
  const stripped = lower.replace(/[\d!-/:-@[-`{-~]+$/, '');
  const plain = [...stripped].map(/**
   * Undoes a common substitution.
   * @param char - One character.
   */ (char) => SUBSTITUTIONS[char] ?? char).join('');
  return stripped.length >= 4 && (COMMON_PASSWORDS.has(stripped) || COMMON_PASSWORDS.has(plain));
}

/**
 * Estimates the strength of a password without sending it anywhere. Characters that continue a run, keyboard or
 * alphabet pattern add only one bit, years count as a small number, and passwords based on a common password are
 * always weak. The result reliably finds weak passwords; a high value is no guarantee of strength.
 * @param password - The password to rate.
 */
export function estimateStrength(password: string): StrengthEstimate {
  if (!password) return { bits: 0, weak: true, hints: [translate(messages, 'empty')] };
  const hints = new Set<string>();
  const perChar = Math.log2(poolSize(password));
  const lower = password.toLowerCase();
  let bits = 0;
  for (let i = 0; i < lower.length; i += 1) {
    const pattern = i > 0 ? continuesPattern(lower[i - 1], lower[i]) : null;
    if (pattern) {
      hints.add(translate(messages, pattern === 'repeat' ? 'repeated' : pattern === 'sequence' ? 'sequence' : 'keyboard'));
      bits += 1;
    } else {
      bits += perChar;
    }
  }
  for (const year of password.match(/(?:19|20)\d{2}/g) ?? []) {
    hints.add(translate(messages, 'year'));
    bits -= Math.max(0, year.length * perChar - 7);
  }
  if (password.length < 12) hints.add(translate(messages, 'short'));
  const common = isBasedOnCommon(password);
  if (common) hints.add(translate(messages, 'common'));
  const rounded = Math.max(0, Math.floor(common ? Math.min(bits, 20) : bits));
  return { bits: rounded, weak: common || rounded < WEAK_PASSWORD_BITS, hints: [...hints] };
}
