import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  CalendarClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  HistoryIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldAlertIcon,
  SigmaIcon
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, type AuditCategory, type AuditEntry, type AuditFilter, type AuditPage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ACCENTS, type Accent } from '@shared/accent';
import { describeUserAgent } from '@shared/user-agent';
import messages from '@/i18n/audit-log';
import { formatDateTime, formatNumber, translate } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';

/** Catalog keys of the names and badge colours of the audit categories, in the order of the filter. */
const CATEGORIES: Record<AuditCategory, { label: keyof typeof messages.en; accent: Accent }> = {
  auth: { label: 'categoryAuth', accent: ACCENTS.sky },
  account: { label: 'categoryAccount', accent: ACCENTS.violet },
  user: { label: 'categoryUser', accent: ACCENTS.amber },
  vault: { label: 'categoryVault', accent: ACCENTS.emerald },
  webdav: { label: 'categoryWebdav', accent: ACCENTS.orange },
  settings: { label: 'categorySettings', accent: ACCENTS.fuchsia },
  share: { label: 'categoryShare', accent: ACCENTS.rose }
};

const PAGE_SIZES = [25, 50, 100] as const;

/** The editable filter form; dates are yyyy-mm-dd from the date inputs. */
interface FilterDraft {
  actor: string;
  action: string;
  category: string;
  from: string;
  to: string;
  failedOnly: boolean;
  search: string;
}

const EMPTY_DRAFT: FilterDraft = { actor: '', action: '', category: '', from: '', to: '', failedOnly: false, search: '' };

/**
 * Turns the form into API filters: a date range covers whole local days, so "to" is the start of the following day.
 * @param draft - The filter form values.
 */
function toFilter(draft: FilterDraft): AuditFilter {
  /**
   * Converts a yyyy-mm-dd date to the ISO time of local midnight, optionally a number of days later.
   * @param date - The date from a date input.
   * @param addDays - Days to add.
   */
  const startOfDay = (date: string, addDays = 0) => {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day + addDays).toISOString();
  };
  return {
    actor: draft.actor.trim() || undefined,
    action: draft.action || undefined,
    category: draft.category || undefined,
    from: draft.from ? startOfDay(draft.from) : undefined,
    to: draft.to ? startOfDay(draft.to, 1) : undefined,
    failedOnly: draft.failedOnly || undefined,
    search: draft.search.trim() || undefined
  };
}

/**
 * Formats a timestamp with seconds so consecutive events can be told apart.
 * @param value - The ISO timestamp of the event.
 */
function formatTime(value: string) {
  return formatDateTime(value, { dateStyle: 'short', timeStyle: 'medium' });
}

/**
 * Shows an action tag as a badge: red for failed actions, otherwise in the colour of its category.
 * @param props - The log entry and an optional click handler that filters by the tag.
 */
function ActionBadge({ entry, onSelect }: { entry: AuditEntry; onSelect?: (action: string) => void }) {
  const t = useT(messages);
  const className = cn(
    'font-mono text-[0.7rem] font-semibold',
    entry.success ? CATEGORIES[entry.category]?.accent.badge : 'border-destructive/40 bg-destructive/10 text-destructive'
  );
  if (!onSelect) return <Badge variant="outline" className={className}>{entry.action}</Badge>;
  return (
    <Badge asChild variant="outline" className={className}>
      <button type="button" title={t('showOnly', { action: entry.action })} onClick={/** Filters by this tag. */ () => onSelect(entry.action)}>
        {entry.action}
      </button>
    </Badge>
  );
}

/**
 * Shows one headline count with a tinted icon tile.
 * @param props - The label, icon, accent colour, value, and an optional action that applies a matching filter.
 */
function StatTile({ label, icon, accent, value, onClick }: { label: string; icon: ReactNode; accent: Accent; value: number | null; onClick?: () => void }) {
  const t = useT(messages);
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2.5 font-medium">
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4', accent.tile)}>{icon}</span>
          {label}
        </CardDescription>
        <CardTitle className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
          {value === null ? '–' : formatNumber(value)}
        </CardTitle>
        {onClick && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={onClick}>{t('show')}</Button>
          </CardAction>
        )}
      </CardHeader>
    </Card>
  );
}

/** Shows the audit log with headline counts, filters, action badges, server-side paging and CSV export. */
export function AuditLogPanel() {
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<FilterDraft>(EMPTY_DRAFT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [data, setData] = useState<AuditPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reload, setReload] = useState(0);
  const t = useT(messages);

  /**
   * Returns the target to show; the server stores the sign-in channels in English, so those are translated here.
   * @param entry - The audit entry.
   */
  function targetLabel(entry: AuditEntry) {
    if (entry.targetType === 'session' && entry.targetName === 'Admin console') return t('sessionAdminConsole');
    if (entry.targetType === 'session' && entry.targetName === 'Web vault') return t('sessionWebVault');
    return entry.targetName;
  }

  const requestKey = JSON.stringify([applied, page, pageSize, reload]);
  const loading = loadedKey !== requestKey;

  /** Loads the current page whenever filters, paging or the refresh counter change, ignoring obsolete responses. */
  useEffect(() => {
    const controller = new AbortController();
    void api.listAudit(toFilter(applied), page, pageSize, controller.signal).then(
      /**
       * Publishes the loaded page.
       * @param result - The page returned by the Admin API.
       */
      (result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setError(null);
        setLoadedKey(requestKey);
      },
      /**
       * Reports a loading error unless the request was aborted.
       * @param reason - The caught error to inspect.
       */
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : translate(messages, 'loadFailed'));
        setLoadedKey(requestKey);
      }
    );
    return /** Aborts the pending request when the effect is cleaned up. */ () => controller.abort();
  }, [applied, page, pageSize, requestKey]);

  /**
   * Applies a filter set and returns to the first page.
   * @param next - The filters to apply; the form shows them too.
   */
  function apply(next: FilterDraft) {
    setDraft(next);
    setApplied(next);
    setPage(1);
  }

  /**
   * Applies the form when it is submitted.
   * @param event - The form submission event.
   */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply(draft);
  }

  /** Downloads the entries matching the applied filters as CSV. */
  async function exportCsv() {
    setExporting(true);
    try {
      const blob = await api.downloadAuditCsv(toFilter(applied));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `keeport-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  const stats = data?.stats;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const first = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data ? Math.min(data.total, data.page * data.pageSize) : 0;
  const filtered = JSON.stringify(applied) !== JSON.stringify(EMPTY_DRAFT);
  const actionsByCategory = (Object.keys(CATEGORIES) as AuditCategory[]).map(/**
   * Groups the known tags of one category for the select.
   * @param category - The category to group.
   */ (category) => ({
    category,
    actions: (data?.actions ?? []).filter(/**
     * Keeps the tags of this category.
     * @param item - One known tag.
     */ (item) => item.category === category).map(/**
     * Takes the tag name.
     * @param item - One known tag.
     */ (item) => item.action)
  }));

  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t('allEntries')} icon={<SigmaIcon />} accent={ACCENTS.violet} value={stats?.total ?? null} />
        <StatTile label={t('last24Hours')} icon={<HistoryIcon />} accent={ACCENTS.sky} value={stats?.last24Hours ?? null} />
        <StatTile label={t('last7Days')} icon={<CalendarClockIcon />} accent={ACCENTS.emerald} value={stats?.last7Days ?? null} />
        <StatTile
          label={t('failedSignIns')}
          icon={<ShieldAlertIcon />}
          accent={stats && stats.failedSignIns24Hours > 0 ? ACCENTS.rose : ACCENTS.amber}
          value={stats?.failedSignIns24Hours ?? null}
          onClick={stats && stats.failedSignIns24Hours > 0
            ? /** Shows the failed sign-ins. */ () => {
              const since = new Date(Date.now() - 86_400_000);
              const day = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
              apply({ ...EMPTY_DRAFT, action: 'LoginFailed', from: day });
            }
            : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('filters')}</CardTitle>
          <CardDescription>{t('filtersDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="audit-actor">{t('user')}</FieldLabel>
                <Input
                  id="audit-actor"
                  placeholder={t('userPlaceholder')}
                  value={draft.actor}
                  onChange={/**
                   * Updates the account filter.
                   * @param event - The input change event.
                   */ (event) => setDraft({ ...draft, actor: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="audit-action">{t('action')}</FieldLabel>
                <NativeSelect
                  id="audit-action"
                  className="w-full"
                  value={draft.action}
                  onChange={/**
                   * Updates the action filter.
                   * @param event - The select change event.
                   */ (event) => setDraft({ ...draft, action: event.target.value })}
                >
                  <NativeSelectOption value="">{t('allActions')}</NativeSelectOption>
                  {actionsByCategory.map(/**
                   * Renders the tags of one category as a group.
                   * @param group - The category and its tags.
                   */ (group) => (
                    <NativeSelectOptGroup key={group.category} label={t(CATEGORIES[group.category].label)}>
                      {group.actions.map(/**
                       * Renders one tag.
                       * @param action - The tag.
                       */ (action) => <NativeSelectOption key={action} value={action}>{action}</NativeSelectOption>)}
                    </NativeSelectOptGroup>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="audit-category">{t('area')}</FieldLabel>
                <NativeSelect
                  id="audit-category"
                  className="w-full"
                  value={draft.category}
                  onChange={/**
                   * Updates the category filter.
                   * @param event - The select change event.
                   */ (event) => setDraft({ ...draft, category: event.target.value })}
                >
                  <NativeSelectOption value="">{t('allAreas')}</NativeSelectOption>
                  {(Object.keys(CATEGORIES) as AuditCategory[]).map(/**
                   * Renders one category.
                   * @param category - The category.
                   */ (category) => <NativeSelectOption key={category} value={category}>{t(CATEGORIES[category].label)}</NativeSelectOption>)}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="audit-from">{t('from')}</FieldLabel>
                <Input
                  id="audit-from"
                  type="date"
                  value={draft.from}
                  max={draft.to || undefined}
                  onChange={/**
                   * Updates the start date.
                   * @param event - The input change event.
                   */ (event) => setDraft({ ...draft, from: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="audit-to">{t('to')}</FieldLabel>
                <Input
                  id="audit-to"
                  type="date"
                  value={draft.to}
                  min={draft.from || undefined}
                  onChange={/**
                   * Updates the end date.
                   * @param event - The input change event.
                   */ (event) => setDraft({ ...draft, to: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="audit-search">{t('search')}</FieldLabel>
                <Input
                  id="audit-search"
                  type="search"
                  placeholder={t('searchPlaceholder')}
                  value={draft.search}
                  onChange={/**
                   * Updates the free-text search.
                   * @param event - The input change event.
                   */ (event) => setDraft({ ...draft, search: event.target.value })}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="audit-failed"
                  checked={draft.failedOnly}
                  onCheckedChange={/**
                   * Toggles the failed-only filter.
                   * @param checked - The new checkbox state.
                   */ (checked) => setDraft({ ...draft, failedOnly: checked === true })}
                />
                <Label htmlFor="audit-failed">{t('failedOnly')}</Label>
              </div>
              <div className="flex gap-2 sm:ms-auto">
                <Button type="submit"><SearchIcon /> {t('search')}</Button>
                <Button type="button" variant="outline" disabled={!filtered && draft === EMPTY_DRAFT} onClick={/** Clears all filters. */ () => apply(EMPTY_DRAFT)}>
                  <RotateCcwIcon /> {t('reset')}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="gap-1 border-b py-5">
          <CardTitle>{t('trail')}</CardTitle>
          <CardDescription>
            {data
              ? `${t(filtered ? 'entriesMatching' : 'entries', { count: data.total })}. ${t('neverLogged')}`
              : t('trailDescription')}
          </CardDescription>
          <CardAction className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={exporting || !data?.total} onClick={/** Exports the filtered entries. */ () => void exportCsv()}>
              <DownloadIcon /> {exporting ? t('exporting') : t('exportCsv')}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={/** Reloads the current page. */ () => setReload((count) => count + 1)}>
              <RefreshCwIcon className={loading ? 'animate-spin' : undefined} /> {t('refresh')}
            </Button>
          </CardAction>
        </CardHeader>
        <Table aria-label={t('trail')}>
          <TableHeader className="bg-muted/45">
            <TableRow>
              <TableHead className="ps-6">{t('time')}</TableHead>
              <TableHead>{t('user')}</TableHead>
              <TableHead>{t('action')}</TableHead>
              <TableHead>{t('target')}</TableHead>
              <TableHead>{t('details')}</TableHead>
              <TableHead className="pe-6">{t('ipAddress')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data?.items.length ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {loading ? t('loading') : filtered ? t('noMatches') : t('nothingLogged')}
                </TableCell>
              </TableRow>
            ) : data.items.map(/**
             * Renders one audit entry.
             * @param entry - The entry to display.
             */ (entry) => (
              <TableRow key={entry.id}>
                <TableCell className="ps-6 whitespace-nowrap text-muted-foreground tabular-nums">{formatTime(entry.occurredAt)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {entry.actorName ?? <span className="text-muted-foreground">{t('system')}</span>}
                  {entry.actorName && !entry.actorId && <span className="ms-1.5 text-xs text-muted-foreground">{t('unknown')}</span>}
                </TableCell>
                <TableCell>
                  <ActionBadge entry={entry} onSelect={/**
                   * Filters by the clicked tag.
                   * @param action - The tag.
                   */ (action) => apply({ ...applied, action })} />
                </TableCell>
                <TableCell>
                  <div className="max-w-48 truncate" title={targetLabel(entry) ?? undefined}>{targetLabel(entry) ?? <span className="text-muted-foreground">—</span>}</div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {/* A width-limited block is needed because max-width on a table cell does not truncate in browsers. */}
                  <div className="max-w-80 truncate" title={entry.details ?? undefined}>{entry.details ?? '—'}</div>
                </TableCell>
                <TableCell className="pe-6 font-mono text-xs text-muted-foreground" title={describeUserAgent(entry.userAgent) ?? undefined}>
                  {entry.remoteIp ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4 text-sm">
          <span className="text-muted-foreground tabular-nums">
            {data && data.total > 0 ? t('showing', { first, last, total: data.total }) : t('noEntries')}
          </span>
          <div className="flex items-center gap-3">
            <Label htmlFor="audit-page-size" className="font-normal">{t('rowsPerPage')}</Label>
            <NativeSelect
              id="audit-page-size"
              size="sm"
              value={String(pageSize)}
              onChange={/**
               * Changes the page size and returns to the first page.
               * @param event - The select change event.
               */ (event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZES.map(/**
               * Renders one page size.
               * @param size - Rows per page.
               */ (size) => <NativeSelectOption key={size} value={String(size)}>{size}</NativeSelectOption>)}
            </NativeSelect>
            <span className="tabular-nums">{t('pageOf', { page: data?.page ?? 1, pages })}</span>
            <Button variant="outline" size="icon-sm" aria-label={t('previousPage')} disabled={loading || page <= 1} onClick={/** Goes back one page. */ () => setPage(page - 1)}>
              <ChevronLeftIcon />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label={t('nextPage')} disabled={loading || page >= pages} onClick={/** Goes forward one page. */ () => setPage(page + 1)}>
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
