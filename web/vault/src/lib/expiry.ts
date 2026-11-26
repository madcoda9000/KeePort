/** How many days before its expiry date an entry counts as "expiring soon", unless the user chose otherwise. */
export const DEFAULT_EXPIRY_WARNING_DAYS = 30;

const DAY = 86400000;

/**
 * Returns the local midnight of a day as milliseconds.
 * @param date - Any moment of the day.
 */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Counts the calendar days from today until an expiry date: 0 for today, 1 for tomorrow, negative when it has passed.
 * @param expiry - The expiry date, or undefined when the entry does not expire.
 * @param now - The current time.
 */
export function daysUntilExpiry(expiry: Date | undefined, now: Date): number | null {
  if (!expiry || Number.isNaN(expiry.getTime())) return null;
  return Math.round((startOfDay(expiry) - startOfDay(now)) / DAY);
}

/**
 * Tells whether an entry expires within the warning period and has not expired yet.
 * @param entry - Whether the entry has expired and in how many days it expires.
 * @param warnDays - The warning period in days; 0 turns the warning off.
 */
export function isExpiringSoon(entry: { expired: boolean; expiresInDays: number | null }, warnDays: number): boolean {
  return warnDays > 0 && !entry.expired && entry.expiresInDays !== null && entry.expiresInDays <= warnDays;
}

/**
 * Returns the date a number of months from now as YYYY-MM-DD, for the quick choice in the entry form. A day that the
 * target month does not have becomes its last day (31 January + 1 month = 28 or 29 February).
 * @param months - How many months ahead.
 * @param now - The current time.
 */
export function expiryInMonths(months: number, now: Date): string {
  const target = new Date(now.getFullYear(), now.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(now.getDate(), lastDay));
  const pad = /**
   * Pads a number to two digits.
   * @param value - The number.
   */ (value: number) => String(value).padStart(2, '0');
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}
