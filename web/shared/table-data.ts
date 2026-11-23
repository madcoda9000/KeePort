export const PAGE_SIZES = [10, 20, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export type SortDirection = 'ascending' | 'descending';
export type SortValue = string | number | null | undefined;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Checks a normalized search term against display values without matching across fields.
 * @param query - The normalized search term to check in each non-missing display value.
 * @param fields - Display values to check individually for the query.
 */
export function matchesTableSearch(query: string, ...fields: SortValue[]) {
  return fields.some(/**
   * Checks only non-missing fields for the normalized query.
   * @param field - The candidate display value, possibly null or undefined.
   */ (field) => field != null && String(field).toLowerCase().includes(query));
}

/**
 * Gives a date column a numeric sort key and keeps missing timestamps distinct.
 * @param value - The timestamp string, or null when the date is missing.
 */
export function timestampSortValue(value: string | null) {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isNaN(timestamp) ? null : timestamp;
}

/**
 * Orders text naturally, numbers numerically, and missing values last in both directions.
 * @param left - The first column value.
 * @param right - The second column value.
 * @param direction - The requested ascending or descending sort direction.
 */
function compareValues(left: SortValue, right: SortValue, direction: SortDirection) {
  if (left == null) return right == null ? 0 : 1;
  if (right == null) return -1;
  const order = typeof left === 'number' && typeof right === 'number'
    ? left - right
    : collator.compare(String(left), String(right));
  return direction === 'ascending' ? order : -order;
}

/**
 * Searches and orders results across all pages without mutating the input.
 * @param rows - The full, unsliced input collection.
 * @param query - The search text before trimming and case normalization.
 * @param matches - The predicate used to test a row against the normalized query.
 * @param sort - The optional sort-key selector and direction.
 */
export function prepareTableRows<T>(
  rows: readonly T[],
  query: string,
  matches: (row: T, query: string) => boolean,
  sort?: { value: (row: T) => SortValue; direction: SortDirection }
) {
  const term = query.trim().toLowerCase();
  const filtered = term ? rows.filter(/**
   * Applies the supplied search predicate to each row.
   * @param row - A candidate row from the input collection.
   */ (row) => matches(row, term)) : rows;
  return sort
    ? [...filtered].sort(/**
     * Compares the selected column values using the active direction.
     * @param left - The first matching row to compare.
     * @param right - The second matching row to compare.
     */ (left, right) => compareValues(sort.value(left), sort.value(right), sort.direction))
    : filtered;
}

/**
 * Slices an in-range page after filtering and sorting.
 * @param rows - The already filtered and sorted rows to paginate.
 * @param pageIndex - The requested zero-based page index, clamped to the available results.
 * @param pageSize - The maximum number of rows to include on one page.
 */
export function selectTablePage<T>(rows: readonly T[], pageIndex: number, pageSize: PageSize) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const index = Math.max(0, Math.min(pageIndex, pageCount - 1));
  const start = index * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  return { rows: pageRows, total: rows.length, pageIndex: index, pageCount, from: pageRows.length ? start + 1 : 0, to: start + pageRows.length };
}
