import { useEffect, useMemo, useState } from 'react';
import { RefreshCwIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { TableCell, TableRow } from '@/components/ui/table';
import { api, type EmailLogEntry, type EmailLogStatus } from '@/lib/api';
import { cn } from '@/lib/utils';
import { DataTable, type TableColumn } from '@shared/data-table';
import { matchesTableSearch, timestampSortValue, type SortValue } from '@shared/table-data';
import { ACCENTS } from '@shared/accent';
import messages from '@/i18n/email-logs';
import { formatDateTime, formatNumber, translate } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';

const STATUSES: readonly EmailLogStatus[] = ['waiting', 'retrying', 'sent', 'failed'];

/** The badge colour of each send state: sent is calm, waiting neutral, retrying a warning, given up an error. */
const STATUS_BADGE: Record<EmailLogStatus, string> = {
  waiting: '',
  retrying: ACCENTS.amber.badge,
  sent: ACCENTS.emerald.badge,
  failed: ''
};

/**
 * Names an e-mail kind in the current language, falling back to the technical name for kinds this console does not know.
 * @param kind - The template name from the server.
 */
function kindName(kind: string) {
  const key = `kind_${kind}`;
  return key in messages.en ? translate(messages, key as keyof typeof messages.en) : kind;
}

/**
 * Names a send state in the current language.
 * @param status - The send state.
 */
function statusName(status: EmailLogStatus) {
  return translate(messages, `status_${status}`);
}

/**
 * Formats a timestamp with seconds so e-mails sent close together can be told apart.
 * @param value - The ISO timestamp.
 */
function formatTime(value: string) {
  return formatDateTime(value, { dateStyle: 'short', timeStyle: 'medium' });
}

/**
 * Builds a table column whose header follows the current language.
 * @param id - The column ID.
 * @param label - The catalog key of the column header.
 * @param sortValue - Picks the value the column sorts by.
 * @param className - Optional CSS classes of the header cell.
 */
function column(
  id: string,
  label: keyof typeof messages.en,
  sortValue: (entry: EmailLogEntry) => SortValue,
  className?: string
): TableColumn<EmailLogEntry> {
  return {
    id,
    /** The header in the current language. */
    get label() {
      return translate(messages, label);
    },
    sortValue,
    className
  };
}

const LOG_COLUMNS: readonly TableColumn<EmailLogEntry>[] = [
  /**
   * Sorts by the time the e-mail was queued.
   * @param entry - The log entry supplying this column's sort value.
   */
  column('time', 'time', (entry) => timestampSortValue(entry.createdAt)),
  /**
   * Sorts by the translated kind.
   * @param entry - The log entry supplying this column's sort value.
   */
  column('kind', 'kind', (entry) => kindName(entry.kind)),
  /**
   * Sorts by recipient address.
   * @param entry - The log entry supplying this column's sort value.
   */
  column('recipient', 'recipient', (entry) => entry.recipient),
  /**
   * Sorts by subject line.
   * @param entry - The log entry supplying this column's sort value.
   */
  column('subject', 'subject', (entry) => entry.subject),
  /**
   * Sorts by the translated send state.
   * @param entry - The log entry supplying this column's sort value.
   */
  column('status', 'status', (entry) => statusName(entry.status)),
  /**
   * Sorts by the number of failed attempts.
   * @param entry - The log entry supplying this column's sort value.
   */
  column('attempts', 'attempts', (entry) => entry.attempts, 'text-end'),
  /**
   * Sorts by the last error.
   * @param entry - The log entry supplying this column's sort value.
   */
  column('error', 'error', (entry) => entry.lastError ?? '')
];

/** Shows the e-mail log with a status filter, search, sorting, paging and manual refresh. */
export function EmailLogsPanel() {
  const [entries, setEntries] = useState<EmailLogEntry[]>([]);
  const [days, setDays] = useState<number | null>(null);
  const [status, setStatus] = useState<EmailLogStatus | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const t = useT(messages);

  /** Loads the log and the retention on mount and on refresh, ignoring answers of obsolete requests. */
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([api.listEmailLogs(controller.signal), api.getEmailSettings(controller.signal)]).then(
      /**
       * Publishes the loaded entries and retention and clears a previous error.
       * @param result - The log entries, newest first, and the e-mail settings.
       */
      ([log, settings]) => {
        if (controller.signal.aborted) return;
        setEntries(log);
        setDays(settings.settings.logRetentionDays ?? 30);
        setError(null);
        setLoading(false);
      },
      /**
       * Reports a loading error unless the request was aborted.
       * @param reason - The caught error to inspect.
       */
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : translate(messages, 'loadFailed'));
        setLoading(false);
      }
    );
    return /** Aborts the pending requests when the effect is cleaned up. */ () => controller.abort();
  }, [loadAttempt]);

  const rows = useMemo(
    /** Keeps the entries of the chosen send state. */
    () => (status === 'all' ? entries : entries.filter(/**
     * Tells whether an entry has the chosen state.
     * @param entry - One log entry.
     */ (entry) => entry.status === status)),
    [entries, status]
  );

  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="gap-1 border-b py-5">
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description', { days: formatNumber(days ?? 30) })}</CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={/** Reloads the log from the server. */ () => {
                setLoading(true);
                /**
                 * Advances the load counter to trigger a fresh load.
                 * @param attempt - The current counter.
                 */
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              <RefreshCwIcon className={loading ? 'animate-spin' : undefined} />
              {t('refresh')}
            </Button>
          </CardAction>
        </CardHeader>
        <DataTable
          label={t('title')}
          rows={rows}
          columns={LOG_COLUMNS}
          searchLabel={t('search')}
          emptyMessage={loading ? t('loading') : t('empty')}
          searchActions={
            <div className="flex items-center gap-2">
              <Label htmlFor="email-log-status" className="text-sm text-muted-foreground">{t('statusFilter')}</Label>
              <NativeSelect
                id="email-log-status"
                value={status}
                onChange={/**
                 * Changes the shown send state.
                 * @param event - The select change event.
                 */ (event) => setStatus(event.target.value as EmailLogStatus | 'all')}
              >
                <NativeSelectOption value="all">{t('allStatuses')}</NativeSelectOption>
                {STATUSES.map(/**
                 * Renders the option of one send state.
                 * @param value - The send state.
                 */ (value) => (
                  <NativeSelectOption key={value} value={value}>{statusName(value)}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          }
          matches={/**
           * Searches every displayed value of a log entry.
           * @param entry - The log entry whose displayed values are searched.
           * @param query - The normalized search text.
           */ (entry, query) => matchesTableSearch(
            query, formatTime(entry.createdAt), kindName(entry.kind), entry.recipient, entry.subject, statusName(entry.status), entry.lastError
          )}
          renderRow={/**
           * Renders one logged e-mail.
           * @param entry - The log entry to display.
           */ (entry) => (
            <TableRow key={entry.id}>
              <TableCell className="ps-6 whitespace-nowrap text-muted-foreground tabular-nums">{formatTime(entry.createdAt)}</TableCell>
              <TableCell className="whitespace-nowrap">{kindName(entry.kind)}</TableCell>
              <TableCell>
                <div className="max-w-56 truncate" title={entry.recipient}>{entry.recipient}</div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {/* A width-limited block is needed because max-width on a table cell does not truncate in browsers. */}
                <div className="max-w-64 truncate" title={entry.subject}>{entry.subject}</div>
              </TableCell>
              <TableCell>
                <Badge
                  variant={entry.status === 'failed' ? 'destructive' : entry.status === 'waiting' ? 'secondary' : 'outline'}
                  className={cn(STATUS_BADGE[entry.status])}
                  title={entry.nextAttemptAt ? t('nextAttempt', { time: formatTime(entry.nextAttemptAt) }) : undefined}
                >
                  {statusName(entry.status)}
                </Badge>
              </TableCell>
              <TableCell className="text-end text-muted-foreground tabular-nums">{entry.attempts}</TableCell>
              <TableCell className="text-xs">
                {entry.lastError ? (
                  <div className="max-w-72 truncate text-destructive" title={entry.lastError}>{entry.lastError}</div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          )}
        />
      </Card>
    </>
  );
}
