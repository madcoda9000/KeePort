import { useEffect, useState } from 'react';
import { RefreshCwIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TableCell, TableRow } from '@/components/ui/table';
import { api, type WebDavRequestLogEntry } from '@/lib/api';
import { DataTable, type TableColumn } from '@shared/data-table';
import { matchesTableSearch, timestampSortValue } from '@shared/table-data';

const LOG_COLUMNS: readonly TableColumn<WebDavRequestLogEntry>[] = [
  /**
   * Sorts by request time, not the formatted date.
   * @param entry - The log entry supplying this column's sort value.
   */
  { id: 'time', label: 'Time', sortValue: (entry) => timestampSortValue(entry.occurredAt) },
  /**
   * Sorts by HTTP method.
   * @param entry - The log entry supplying this column's sort value.
   */
  { id: 'method', label: 'Method', sortValue: (entry) => entry.method },
  /**
   * Sorts by requested path.
   * @param entry - The log entry supplying this column's sort value.
   */
  { id: 'path', label: 'Path', sortValue: (entry) => entry.path },
  /**
   * Sorts by numeric HTTP status code.
   * @param entry - The log entry supplying this column's sort value.
   */
  { id: 'status', label: 'Status', sortValue: (entry) => entry.status },
  /**
   * Sorts by WebDAV username, keeping unauthenticated requests distinct.
   * @param entry - The log entry supplying this column's sort value.
   */
  { id: 'credential', label: 'Credential', sortValue: (entry) => entry.credential },
  /**
   * Sorts by client IP address.
   * @param entry - The log entry supplying this column's sort value.
   */
  { id: 'ip', label: 'Client IP', sortValue: (entry) => entry.remoteIp },
  /**
   * Sorts by the summarized request headers.
   * @param entry - The log entry supplying this column's sort value.
   */
  { id: 'details', label: 'Details', sortValue: (entry) => describeDetails(entry) },
  /**
   * Sorts by processing time in milliseconds.
   * @param entry - The log entry supplying this column's sort value.
   */
  { id: 'duration', label: 'Duration', sortValue: (entry) => entry.durationMs, className: 'text-end' }
];

/**
 * Formats a timestamp with seconds so consecutive requests can be told apart.
 * @param value - The ISO timestamp of the request.
 */
function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}

/**
 * Formats a request body size in bytes, kilobytes, or megabytes.
 * @param size - The declared request body size in bytes.
 */
function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Summarizes the precondition, move and size headers that matter for diagnosing clients.
 * @param entry - The log entry whose request headers are summarized.
 */
function describeDetails(entry: WebDavRequestLogEntry) {
  const parts: string[] = [];
  if (entry.ifMatch) parts.push('If-Match');
  if (entry.depth) parts.push(`Depth ${entry.depth}`);
  if (entry.destination) parts.push(`→ ${entry.destination}`);
  if (entry.overwrite) parts.push(`Overwrite ${entry.overwrite}`);
  if (entry.contentLength != null) parts.push(formatBytes(entry.contentLength));
  return parts.join(' · ');
}

/**
 * Picks a badge style by status class: errors stand out, redirects and successes stay neutral.
 * @param status - The HTTP status code returned to the client.
 */
function statusVariant(status: number) {
  if (status >= 500 || (status >= 400 && status !== 401)) return 'destructive' as const;
  if (status === 401) return 'outline' as const;
  return 'secondary' as const;
}

/** Shows the retained WebDAV request log with search, sorting, paging and manual refresh. */
export function WebDavLogsPanel() {
  const [entries, setEntries] = useState<WebDavRequestLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);

  /** Loads the log on mount and on refresh, ignoring responses of obsolete requests. */
  useEffect(() => {
    const controller = new AbortController();
    void api.listWebDavLogs(controller.signal).then(
      /**
       * Publishes the loaded entries and clears a previous error.
       * @param result - The log entries returned by the Admin API, newest first.
       */
      (result) => {
        if (controller.signal.aborted) return;
        setEntries(result);
        setError(null);
        setLoading(false);
      },
      /**
       * Reports a loading error unless the request was aborted.
       * @param reason - The caught error to inspect.
       */
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'Could not load WebDAV logs.');
        setLoading(false);
      }
    );
    return /** Aborts the pending log request when the effect is cleaned up. */ () => controller.abort();
  }, [loadAttempt]);

  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="gap-1 border-b py-5">
          <CardTitle>WebDAV requests</CardTitle>
          <CardDescription>
            The latest 5,000 requests from KeePass clients. Passwords and file contents are never logged.
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={/** Reloads the log from the server. */ () => {
                setLoading(true);
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              <RefreshCwIcon className={loading ? 'animate-spin' : undefined} />
              Refresh
            </Button>
          </CardAction>
        </CardHeader>
        <DataTable
          label="WebDAV requests"
          rows={entries}
          columns={LOG_COLUMNS}
          searchLabel="Search WebDAV logs"
          emptyMessage={loading ? 'Loading WebDAV logs…' : 'No WebDAV requests logged yet.'}
          matches={/**
           * Searches every displayed value of a log entry.
           * @param entry - The log entry whose displayed values are searched.
           * @param query - The normalized search text.
           */ (entry, query) => matchesTableSearch(
            query, formatTime(entry.occurredAt), entry.method, entry.path, entry.status,
            entry.credential ?? 'unauthenticated', entry.remoteIp, describeDetails(entry)
          )}
          renderRow={/**
           * Renders one logged request.
           * @param entry - The log entry to display.
           */ (entry) => (
            <TableRow key={entry.id}>
              <TableCell className="ps-6 whitespace-nowrap text-muted-foreground tabular-nums">{formatTime(entry.occurredAt)}</TableCell>
              <TableCell className="font-mono text-xs">{entry.method}</TableCell>
              <TableCell className="font-mono text-xs">
                <div className="max-w-64 truncate" title={entry.path}>{entry.path}</div>
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(entry.status)} className="tabular-nums">{entry.status}</Badge>
              </TableCell>
              <TableCell>{entry.credential ?? <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{entry.remoteIp ?? '—'}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {/* A width-limited block is needed because max-width on a table cell does not truncate in browsers. */}
                <div className="max-w-56 truncate" title={describeDetails(entry)}>{describeDetails(entry) || '—'}</div>
              </TableCell>
              <TableCell className="text-end text-muted-foreground tabular-nums">{entry.durationMs} ms</TableCell>
            </TableRow>
          )}
        />
      </Card>
    </>
  );
}
