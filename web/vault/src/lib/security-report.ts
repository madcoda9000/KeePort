import { ProtectedValue, type KdbxEntry } from 'kdbxweb';
import { estimateStrength } from './strength.ts';

/** The checks of the security report. */
export type SecurityIssue = 'weak' | 'reused' | 'old' | 'empty' | 'expired';

/** Passwords not changed for longer than this count as old. */
export const OLD_PASSWORD_DAYS = 365;

/** The data of one entry the report looks at. */
export interface ReportEntry {
  id: string;
  username: string;
  password: string;
  expired: boolean;
  hidden: boolean;
  passwordChanged: Date | undefined;
}

export interface SecurityReport {
  /** Entry IDs per check. */
  issues: Record<SecurityIssue, ReadonlySet<string>>;
  /** For entries with a reused password: how many entries share it. */
  reuseCounts: ReadonlyMap<string, number>;
  /** Entry IDs with at least one finding. */
  affected: ReadonlySet<string>;
}

/**
 * Reads the password of one state of an entry.
 * @param entry - The entry or one of its versions.
 */
function passwordOf(entry: KdbxEntry): string {
  const value = entry.fields.get('Password');
  if (value === undefined) return '';
  return value instanceof ProtectedValue ? value.getText() : String(value);
}

/**
 * Finds when the current password was set, using the history: the oldest consecutive state that already had it.
 * Other changes, e.g. to the notes, do not count. Without a differing version it is the creation time.
 * @param entry - The entry.
 */
export function passwordChangedAt(entry: KdbxEntry): Date | undefined {
  const current = passwordOf(entry);
  const states = [...entry.history, entry];
  let changed = entry.times.lastModTime;
  for (let i = states.length - 1; i >= 0; i -= 1) {
    if (passwordOf(states[i]) !== current) return changed;
    changed = states[i].times.lastModTime;
  }
  return entry.times.creationTime ?? changed;
}

/**
 * Builds the security report for the regular entries of a vault (no templates, no recycle bin). Everything is
 * computed in the browser; nothing is stored or sent.
 * @param entries - The entries of the vault.
 * @param now - The current time.
 */
export function buildReport(entries: readonly ReportEntry[], now: Date): SecurityReport {
  const issues: Record<SecurityIssue, Set<string>> = { weak: new Set(), reused: new Set(), old: new Set(), empty: new Set(), expired: new Set() };
  const byPassword = new Map<string, string[]>();
  const oldBefore = now.getTime() - OLD_PASSWORD_DAYS * 86400000;
  for (const entry of entries) {
    if (entry.hidden) continue;
    if (entry.expired) issues.expired.add(entry.id);
    if (!entry.password) {
      if (entry.username) issues.empty.add(entry.id);
      continue;
    }
    if (estimateStrength(entry.password).weak) issues.weak.add(entry.id);
    if (entry.passwordChanged && entry.passwordChanged.getTime() < oldBefore) issues.old.add(entry.id);
    const ids = byPassword.get(entry.password);
    if (ids) ids.push(entry.id);
    else byPassword.set(entry.password, [entry.id]);
  }
  const reuseCounts = new Map<string, number>();
  for (const ids of byPassword.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      issues.reused.add(id);
      reuseCounts.set(id, ids.length);
    }
  }
  const affected = new Set(Object.values(issues).flatMap(/**
   * Lists the IDs of one check.
   * @param ids - The entries of one check.
   */ (ids) => [...ids]));
  return { issues, reuseCounts, affected };
}
