import { useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PAGE_SIZES, prepareTableRows, selectTablePage, type PageSize, type SortDirection, type SortValue } from './table-data';
import messages from '@shared/i18n/messages/data-table';
import { useT } from '@shared/i18n/react';

export interface TableColumn<T> {
  id: string;
  label: string;
  sortValue?: (row: T) => SortValue;
  className?: string;
}

/** The rows a table currently shows, handed to the optional leading header and toolbar. */
export interface DataTableView<T> {
  /** The rows on the current page. */
  pageRows: readonly T[];
  /** All rows matching the search or browse filter, across all pages. */
  results: readonly T[];
}

interface DataTableProps<T> {
  label: string;
  rows: readonly T[];
  columns: readonly TableColumn<T>[];
  searchLabel: string;
  matches: (row: T, query: string) => boolean;
  emptyMessage: string;
  renderRow: (row: T) => ReactNode;
  /** Restricts the rows while the search box is empty, e.g. to one folder; a search always covers all rows. */
  browseFilter?: (row: T) => boolean;
  /** Renders an extra first header cell, e.g. a select-all checkbox; rows must then render a matching first cell. */
  leadingHeader?: (view: DataTableView<T>) => ReactNode;
  /** Renders content between the search box and the table, e.g. an action bar for selected rows. */
  toolbar?: (view: DataTableView<T>) => ReactNode;
  /** Controls shown to the right of the search box, e.g. a column chooser. */
  searchActions?: ReactNode;
}

/**
 * Adds live search, accessible column sorting and paging to a shadcn table.
 * @param props - The complete rows, column definitions, search predicate, row renderer, and labels for the table and empty state.
 */
export function DataTable<T>({
  label,
  rows,
  columns,
  searchLabel,
  matches,
  emptyMessage,
  renderRow,
  browseFilter,
  leadingHeader,
  toolbar,
  searchActions
}: DataTableProps<T>) {
  const pageSizeId = useId();
  const t = useT(messages);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ columnId: string; direction: SortDirection } | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(PAGE_SIZES[0]);

  const results = useMemo(/** Prepares the filtered, sorted rows from the current query and column. */ () => {
    const value = columns.find(/**
     * Finds the column providing the active sort key.
     * @param column - The column metadata, including its label and optional sort-key function.
     */ (column) => column.id === sort?.columnId)?.sortValue;
    const scoped = browseFilter && !query.trim() ? rows.filter(browseFilter) : rows;
    return prepareTableRows(scoped, query, matches, value && sort ? { value, direction: sort.direction } : undefined);
  }, [rows, columns, matches, query, sort, browseFilter]);
  const page = selectTablePage(results, pageIndex, pageSize);
  if (pageIndex > page.pageIndex) {
    setPageIndex(page.pageIndex);
  }
  const view: DataTableView<T> = { pageRows: page.rows, results };

  /**
   * Toggles the direction of a column, starting on the first page.
   * @param columnId - The ID of the column requested for sorting.
   */
  function sortBy(columnId: string) {
    /**
     * Reverses the current column's order or starts a different column ascending.
     * @param current - The active sort state, or null when no column is selected.
     */
    setSort((current) => ({
      columnId,
      direction: current?.columnId === columnId && current.direction === 'ascending' ? 'descending' : 'ascending'
    }));
    setPageIndex(0);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <div className="relative w-full sm:max-w-sm">
          <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            type="search"
            aria-label={searchLabel}
            placeholder={`${searchLabel}…`}
            value={query}
            onChange={/**
             * Updates live search and returns to the first page.
             * @param event - The live search input change event.
             */ (event) => {
              setQuery(event.target.value);
              setPageIndex(0);
            }}
          />
        </div>
        {searchActions}
      </div>
      {toolbar?.(view)}
      <Table aria-label={label}>
        <TableHeader className="bg-muted/45">
          <TableRow>
            {leadingHeader && <TableHead scope="col" className="w-10 ps-6 pe-0">{leadingHeader(view)}</TableHead>}
            {columns.map(/**
             * Renders a sortable header or a plain label depending on the column.
             * @param column - The column metadata, including its label and optional sort-key function.
             * @param index - The zero-based index in the source collection.
             */ (column, index) => {
              const direction = sort?.columnId === column.id ? sort.direction : undefined;
              const Icon = direction === 'ascending' ? ArrowUpIcon : direction === 'descending' ? ArrowDownIcon : ArrowUpDownIcon;
              return (
                <TableHead
                  key={column.id}
                  scope="col"
                  aria-sort={direction}
                  className={index === 0 && !leadingHeader ? `ps-6 ${column.className ?? ''}` : column.className}
                >
                  {column.sortValue ? (
                    <Button type="button" variant="ghost" size="sm" className="-ms-2 px-2" onClick={/** Changes the sort order for this column. */ () => sortBy(column.id)}>
                      {column.label}<Icon aria-hidden="true" className="text-muted-foreground" />
                    </Button>
                  ) : column.label}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.rows.length ? page.rows.map(renderRow) : (
            <TableRow>
              <TableCell colSpan={columns.length + (leadingHeader ? 1 : 0)} className="h-24 text-center text-muted-foreground">
                {query.trim() ? t('noMatches') : emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t px-4 py-3 text-sm sm:px-6">
        <span className="text-muted-foreground" aria-live="polite">
          {page.total ? t('showing', { from: page.from, to: page.to, total: page.total }) : t('noResults')}
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor={pageSizeId}>{t('rowsPerPage')}</Label>
            <NativeSelect
              id={pageSizeId}
              size="sm"
              value={pageSize}
              onChange={/**
               * Applies the selected page size and returns to the first page.
               * @param event - The page-size selector change event.
               */ (event) => {
                setPageSize(Number(event.target.value) as PageSize);
                setPageIndex(0);
              }}
            >
              {PAGE_SIZES.map(/**
               * Renders one page-size option per supported row count.
               * @param size - One of the supported maximum row counts per page.
               */ (size) => <NativeSelectOption key={size} value={size}>{size}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="flex items-center gap-2">
            <span className="tabular-nums">{t('pageOf', { page: page.pageIndex + 1, pages: page.pageCount })}</span>
            <Button type="button" size="icon-sm" variant="outline" aria-label={t('previousPage')} disabled={page.pageIndex === 0} onClick={/** Moves back one result page. */ () => setPageIndex(page.pageIndex - 1)}>
              <ChevronLeftIcon aria-hidden="true" />
            </Button>
            <Button type="button" size="icon-sm" variant="outline" aria-label={t('nextPage')} disabled={page.pageIndex + 1 === page.pageCount} onClick={/** Moves forward one result page. */ () => setPageIndex(page.pageIndex + 1)}>
              <ChevronRightIcon aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
