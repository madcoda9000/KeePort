import { useEffect, useState } from 'react';
import { CircleCheckIcon, CircleXIcon } from 'lucide-react';
import { api, type SignIn } from '@/lib/api';
import { describeUserAgent } from '@shared/user-agent';

/**
 * Formats a sign-in time with date and time of day.
 * @param value - The ISO timestamp of the attempt.
 */
function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Lists the latest sign-in attempts on the user's own account, so they can spot sign-ins that were not theirs.
 * Loads when shown, i.e. each time the account settings open.
 */
export function RecentSignIns() {
  const [signIns, setSignIns] = useState<SignIn[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Loads the list once when the component appears. */
  useEffect(() => {
    const controller = new AbortController();
    void api.listSignIns(controller.signal).then(
      /**
       * Shows the loaded attempts.
       * @param result - The attempts, newest first.
       */
      (result) => {
        if (!controller.signal.aborted) setSignIns(result);
      },
      /**
       * Shows a short error unless the request was aborted.
       * @param reason - The caught error to inspect.
       */
      (reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load recent sign-ins.');
      }
    );
    return /** Aborts the pending request when the dialog closes. */ () => controller.abort();
  }, []);

  return (
    <section className="grid gap-3" aria-labelledby="recent-sign-ins">
      <div className="space-y-1">
        <h3 id="recent-sign-ins" className="text-sm font-semibold">Recent sign-ins</h3>
        <p className="text-sm text-muted-foreground">
          The last 20 sign-in attempts on your account. If you see one that was not you, change your password and tell
          your administrator.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : signIns === null ? (
        <p role="status" className="text-sm text-muted-foreground">Loading…</p>
      ) : signIns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sign-ins recorded yet.</p>
      ) : (
        <ul className="grid divide-y rounded-lg border text-sm">
          {signIns.map(/**
           * Renders one attempt.
           * @param signIn - The attempt to show.
           * @param index - Its position, used as key together with the time.
           */ (signIn, index) => (
            <li key={`${signIn.occurredAt}-${index}`} className="flex items-start gap-3 px-3 py-2">
              {signIn.success ? (
                <CircleCheckIcon aria-label="Successful" className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <CircleXIcon aria-label="Failed" className="mt-0.5 size-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap justify-between gap-x-3">
                  <span className="font-medium">{signIn.success ? 'Signed in' : 'Failed sign-in'}</span>
                  <span className="text-muted-foreground tabular-nums">{formatTime(signIn.occurredAt)}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[describeUserAgent(signIn.userAgent), signIn.remoteIp].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
