import assert from 'node:assert/strict';
import test from 'node:test';
import { PAGE_SIZES, matchesTableSearch, prepareTableRows, selectTablePage, timestampSortValue } from './table-data.ts';

test('filters the full list by the typed term, case-insensitively, before pagination', () => {
  const rows = Array.from({ length: 35 }, (_, index) => ({ name: `File ${index + 1}`, status: index >= 25 ? 'Active' : 'Deleted' }));
  const matching = prepareTableRows(rows, '  AcT ', (row, query) => matchesTableSearch(query, row.name, row.status));
  assert.equal(selectTablePage(matching, 0, 10).rows[0].name, 'File 26');
  assert.equal(matching.length, 10);
  assert.equal(prepareTableRows(rows, '  ', () => false).length, 35);
  assert.equal(prepareTableRows(rows, 'missing', (row, query) => matchesTableSearch(query, row.name)).length, 0);
});

test('sorts before paging, using natural text order and preserving source order', () => {
  const rows = Object.freeze(['Box 11', 'box 2', 'Box 1', 'Box 20']);
  const value = (row) => row;
  const matches = () => true;
  assert.deepEqual(prepareTableRows(rows, '', matches, { value, direction: 'ascending' }), ['Box 1', 'box 2', 'Box 11', 'Box 20']);
  assert.deepEqual(prepareTableRows(rows, '', matches, { value, direction: 'descending' }), ['Box 20', 'Box 11', 'box 2', 'Box 1']);
  const numbers = Array.from({ length: 20 }, (_, index) => index + 1);
  const ordered = prepareTableRows(numbers, '', matches, { value, direction: 'descending' });
  assert.deepEqual(selectTablePage(ordered, 0, 10).rows, [20, 19, 18, 17, 16, 15, 14, 13, 12, 11]);
});

test('sorts timestamps by time and puts missing values last in either direction', () => {
  const older = '2025-12-01T00:15:00+02:00';
  const newer = '2025-11-30T23:00:00Z';
  const dates = [newer, null, older];
  const value = timestampSortValue;
  assert.deepEqual(prepareTableRows(dates, '', () => true, { value, direction: 'ascending' }), [older, newer, null]);
  assert.deepEqual(prepareTableRows(dates, '', () => true, { value, direction: 'descending' }), [newer, older, null]);
});

test('exposes the three page sizes and clamps after rows are removed or filtered', () => {
  assert.deepEqual(PAGE_SIZES, [10, 20, 50]);
  const rows = Array.from({ length: 53 }, (_, index) => index + 1);
  for (const size of PAGE_SIZES) {
    const page = selectTablePage(rows, 0, size);
    assert.equal(page.rows.length, size);
    assert.equal(page.total, 53);
    assert.equal(page.pageCount, Math.ceil(53 / size));
    assert.equal(page.to, size);
  }
  assert.deepEqual(selectTablePage(rows, 2, 20).rows, rows.slice(40));
  assert.deepEqual(selectTablePage(rows.slice(0, 21), 2, 20), { rows: [21], total: 21, pageIndex: 1, pageCount: 2, from: 21, to: 21 });
  assert.deepEqual(selectTablePage([], 5, 10), { rows: [], total: 0, pageIndex: 0, pageCount: 1, from: 0, to: 0 });
});
