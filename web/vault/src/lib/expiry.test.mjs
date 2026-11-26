import assert from 'node:assert/strict';
import test from 'node:test';
import { daysUntilExpiry, expiryInMonths, isExpiringSoon } from './expiry.ts';
import { buildReport } from './security-report.ts';

const now = new Date(2026, 10, 26, 15, 30);

/** Verifies the day count around today, tomorrow and the edge of the warning period. */
test('counts calendar days until the expiry date', () => {
  assert.equal(daysUntilExpiry(undefined, now), null);
  assert.equal(daysUntilExpiry(new Date(2026, 10, 26, 23, 59), now), 0);
  assert.equal(daysUntilExpiry(new Date(2026, 10, 27, 0, 1), now), 1);
  assert.equal(daysUntilExpiry(new Date(2026, 11, 26), now), 30);
  assert.equal(daysUntilExpiry(new Date(2026, 11, 27), now), 31);
  assert.equal(daysUntilExpiry(new Date(2026, 10, 20), now), -6);
});

/** Verifies which entries count as expiring soon. */
test('marks entries expiring within the warning period', () => {
  assert.equal(isExpiringSoon({ expired: false, expiresInDays: 0 }, 30), true);
  assert.equal(isExpiringSoon({ expired: false, expiresInDays: 30 }, 30), true);
  assert.equal(isExpiringSoon({ expired: false, expiresInDays: 31 }, 30), false);
  assert.equal(isExpiringSoon({ expired: true, expiresInDays: 0 }, 30), false, 'expired entries are not "soon"');
  assert.equal(isExpiringSoon({ expired: false, expiresInDays: null }, 30), false, 'no expiry date');
  assert.equal(isExpiringSoon({ expired: false, expiresInDays: 5 }, 0), false, '0 turns it off');
});

/** Verifies the quick choice, including months with fewer days. */
test('sets an expiry date months ahead', () => {
  assert.equal(expiryInMonths(1, now), '2026-12-26');
  assert.equal(expiryInMonths(3, now), '2027-02-26');
  assert.equal(expiryInMonths(12, now), '2027-11-26');
  assert.equal(expiryInMonths(1, new Date(2027, 0, 31)), '2027-02-28');
});

/** Verifies the "Expiring soon" check of the security report. */
test('the security report lists entries expiring soon', () => {
  const base = { username: '', password: 'Correct horse 9 battery!', hidden: false, passwordChanged: now };
  const entries = [
    { ...base, id: 'soon', expired: false, expiresInDays: 5 },
    { ...base, id: 'later', expired: false, expiresInDays: 40 },
    { ...base, id: 'gone', expired: true, expiresInDays: -2 },
    { ...base, id: 'hidden', expired: false, expiresInDays: 1, hidden: true }
  ].map(/**
   * Gives each entry its own password.
   * @param entry - One entry.
   */ (entry) => ({ ...entry, password: `${entry.password} ${entry.id}` }));
  const report = buildReport(entries, now, undefined, 30);
  assert.deepEqual([...report.issues.expiring], ['soon']);
  assert.deepEqual([...report.issues.expired], ['gone']);
  assert.equal(buildReport(entries, now).issues.expiring.size, 0, 'off without a warning period');
});
