import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIcon,
  ArrowRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  DatabaseIcon,
  HardDriveIcon,
  NetworkIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldCheckIcon,
  UsersIcon
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, ApiError, type DashboardData, type LoginCounts } from '@/lib/api';

/** Admin sections the dashboard links to. */
export type DashboardTarget = 'vaults' | 'users' | 'webdav' | 'settings' | 'webdav-logs';

/** Days before expiry from which the admin certificate is shown as expiring soon. */
const CERTIFICATE_WARNING_DAYS = 30;

const STORAGE_LABELS: Record<DashboardData['storage']['kind'], string> = {
  hostFolder: 'Host folder',
  dockerVolume: 'Docker volume',
  notMounted: 'Not mounted',
  unknown: 'Unknown (not in Docker)'
};

/**
 * Formats a duration in seconds as days, hours and minutes, e.g. "3 d 4 h 12 min".
 * @param seconds - The duration in seconds.
 */
function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} d ${hours} h ${minutes} min`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

/**
 * Formats a timestamp for the current locale.
 * @param value - An ISO timestamp.
 */
function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Returns the whole days until a date, negative when it is in the past.
 * @param value - An ISO timestamp.
 * @param now - The reference time.
 */
function daysUntil(value: string, now: Date) {
  return Math.floor((new Date(value).getTime() - now.getTime()) / 86400000);
}

/**
 * Shows one labelled value in a definition list.
 * @param props - The label and the value to show.
 */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm wrap-break-word">{children}</dd>
    </div>
  );
}

/**
 * Shows a headline number with a short description, or a placeholder when the value is unknown.
 * @param props - The title, icon, value (null when unknown), detail line and optional action.
 */
function StatCard({
  title,
  icon,
  value,
  detail,
  action
}: {
  title: string;
  icon: ReactNode;
  value: ReactNode | null;
  detail: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2 [&_svg]:size-4">{icon}{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value ?? <span className="text-base text-muted-foreground">Not available</span>}</CardTitle>
        <CardDescription>{detail}</CardDescription>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
    </Card>
  );
}

/**
 * Shows success and failure counts, making failed sign-ins stand out.
 * @param props - The counts to show.
 */
function CountsCell({ counts }: { counts: LoginCounts }) {
  return (
    <TableCell className="tabular-nums">
      <span title="Successful sign-ins">{counts.success}</span>
      <span className="text-muted-foreground"> / </span>
      <span title="Failed sign-ins" className={counts.failure > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}>
        {counts.failure}
      </span>
    </TableCell>
  );
}

/**
 * The admin dashboard: service status, version, network and admin access, data storage, totals, sign-ins and WebDAV
 * activity of the KeePort instance. Values the server could not read are shown as "Not available", never as zero.
 * @param props - The callback that opens another admin section.
 */
export function DashboardPanel({ onNavigate }: { onNavigate: (target: DashboardTarget) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  /** Loads the dashboard on opening and on refresh, keeping the previous data visible if a request fails. */
  useEffect(() => {
    const controller = new AbortController();
    void api.getDashboard(controller.signal).then(
      /**
       * Publishes the loaded dashboard and clears a previous error.
       * @param next - The dashboard returned by the Admin API.
       */
      (next) => {
        if (controller.signal.aborted) return;
        setData(next);
        setError(null);
        setLoadedAt(new Date());
        setLoading(false);
      },
      /**
       * Reports a loading error unless the request was aborted.
       * @param cause - The caught error to inspect.
       */
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof ApiError || cause instanceof Error ? cause.message : 'The dashboard could not be loaded.');
        setLoading(false);
      }
    );
    return /** Cancels the pending request when the dashboard closes or refreshes. */ () => controller.abort();
  }, [loadAttempt]);

  /** Starts a new load of the dashboard. */
  function refresh() {
    setLoading(true);
    /**
     * Increments the load counter, which reruns the loading effect.
     * @param attempt - The previous counter value.
     */
    setLoadAttempt((attempt) => attempt + 1);
  }

  // The server's collection time is the reference for relative values such as the certificate's remaining days.
  const now = data ? new Date(data.generatedAt) : null;
  const counts = data?.counts ?? null;
  const logins = data?.logins ?? null;
  const server = data?.server;
  const certificateDays = server?.adminCertificateNotAfter && now ? daysUntil(server.adminCertificateNotAfter, now) : null;

  const attention: { text: string; target?: DashboardTarget; label?: string }[] = [];
  if (data?.storage.needsAttention) attention.push({ text: 'The data is not stored in a host folder and may be missing from NAS backups.', target: 'settings', label: 'Storage details' });
  if (counts && counts.conflictCopies > 0) attention.push({ text: `${counts.conflictCopies} conflict ${counts.conflictCopies === 1 ? 'copy waits' : 'copies wait'} for review.`, target: 'vaults', label: 'Vault files' });
  if (certificateDays !== null && certificateDays < CERTIFICATE_WARNING_DAYS) attention.push({ text: `The admin certificate expires in ${Math.max(certificateDays, 0)} days. KeePort renews it on the next restart.` });
  if (logins && logins.adminLast24Hours.failure > 0) attention.push({ text: `${logins.adminLast24Hours.failure} failed admin sign-in${logins.adminLast24Hours.failure === 1 ? '' : 's'} in the last 24 hours.` });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          {data && !error ? (
            <Badge variant="secondary" className="gap-1.5"><CircleCheckIcon className="text-emerald-600 dark:text-emerald-400" /> KeePort is running</Badge>
          ) : error ? (
            <Badge variant="destructive" className="gap-1.5"><CircleAlertIcon /> Status not available</Badge>
          ) : null}
          <span className="text-muted-foreground" aria-live="polite">
            {loadedAt ? `Updated ${loadedAt.toLocaleTimeString()}` : loading ? 'Loading…' : ''}
          </span>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={refresh}>
          <RefreshCwIcon className={loading ? 'animate-spin' : undefined} /> Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>The dashboard could not be loaded</AlertTitle>
          <AlertDescription>
            {error}{data ? ' The values below are from the last successful update.' : ''}
          </AlertDescription>
        </Alert>
      )}
      {data && data.errors.length > 0 && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Some values are not available</AlertTitle>
          <AlertDescription>{data.errors.join(' ')}</AlertDescription>
        </Alert>
      )}
      {attention.length > 0 && (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>Needs attention</AlertTitle>
          <AlertDescription>
            <ul className="grid gap-1.5">
              {attention.map(/**
               * Renders one item that needs attention, with a link to the section that deals with it.
               * @param item - The message and optional target section.
               */ (item) => (
                <li key={item.text} className="flex flex-wrap items-center gap-x-2">
                  <span>{item.text}</span>
                  {item.target && (
                    <Button variant="link" size="sm" className="h-auto p-0" onClick={/** Opens the related section. */ () => item.target && onNavigate(item.target)}>
                      {item.label} <ArrowRightIcon />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {!data && loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map(/**
           * Renders a placeholder card while loading.
           * @param index - The placeholder index.
           */ (index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
        </div>
      ) : data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Uptime"
              icon={<ActivityIcon />}
              value={server ? formatUptime(server.uptimeSeconds) : null}
              detail={server ? `Since ${formatDateTime(server.startedAt)}` : ''}
            />
            <StatCard
              title="Vaults"
              icon={<DatabaseIcon />}
              value={counts?.vaults ?? null}
              detail={counts ? `${counts.deletedVaults} deleted · ${counts.conflictCopies} conflict ${counts.conflictCopies === 1 ? 'copy' : 'copies'}` : 'Totals not available'}
              action={<Button variant="ghost" size="icon-sm" aria-label="Open vault files" onClick={/** Opens the vault files. */ () => onNavigate('vaults')}><ArrowRightIcon /></Button>}
            />
            <StatCard
              title="Accounts"
              icon={<UsersIcon />}
              value={counts ? counts.users + counts.admins : null}
              detail={counts
                ? `${counts.users} ${counts.users === 1 ? 'user' : 'users'} (${counts.disabledUsers} disabled) · ${counts.admins} ${counts.admins === 1 ? 'admin' : 'admins'}${counts.disabledAdmins ? ` (${counts.disabledAdmins} disabled)` : ''}`
                : 'Totals not available'}
              action={<Button variant="ghost" size="icon-sm" aria-label="Open users" onClick={/** Opens the users. */ () => onNavigate('users')}><ArrowRightIcon /></Button>}
            />
            <StatCard
              title="WebDAV app passwords"
              icon={<NetworkIcon />}
              value={counts?.activeWebDavCredentials ?? null}
              detail={counts ? `${counts.webDavRequestsLast24Hours} ${counts.webDavRequestsLast24Hours === 1 ? 'request' : 'requests'} in the last 24 hours` : 'Totals not available'}
              action={<Button variant="ghost" size="icon-sm" aria-label="Open WebDAV credentials" onClick={/** Opens the WebDAV credentials. */ () => onNavigate('webdav')}><ArrowRightIcon /></Button>}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Sign-ins</CardTitle>
                <CardDescription>
                  {logins
                    ? `Successful / failed sign-ins. Counted since ${formatDateTime(logins.since)}; rate-limited requests are not included.`
                    : 'Sign-in counts are not available.'}
                </CardDescription>
              </CardHeader>
              {logins && (
                <CardContent className="px-0">
                  <Table aria-label="Sign-ins">
                    <TableHeader className="bg-muted/45">
                      <TableRow>
                        <TableHead scope="col" className="ps-6">Where</TableHead>
                        <TableHead scope="col">Last 24 hours</TableHead>
                        <TableHead scope="col">Last 7 days</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="ps-6 font-medium">Admin console</TableCell>
                        <CountsCell counts={logins.adminLast24Hours} />
                        <CountsCell counts={logins.adminLast7Days} />
                      </TableRow>
                      <TableRow>
                        <TableCell className="ps-6 font-medium">Web vault</TableCell>
                        <CountsCell counts={logins.vaultLast24Hours} />
                        <CountsCell counts={logins.vaultLast7Days} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>WebDAV activity</CardTitle>
                <CardDescription>Requests from KeePass apps in the last 24 hours, from the request log.</CardDescription>
                <CardAction>
                  <Button variant="outline" size="sm" onClick={/** Opens the WebDAV logs. */ () => onNavigate('webdav-logs')}>
                    Logs <ArrowRightIcon />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {counts ? (
                  <dl className="grid gap-2.5">
                    <Fact label="Requests">{counts.webDavRequestsLast24Hours}</Fact>
                    <Fact label="Errors">
                      <span className={counts.webDavErrorsLast24Hours > 0 ? 'font-medium text-destructive' : undefined}>{counts.webDavErrorsLast24Hours}</span>
                    </Fact>
                    <Fact label="Outdated saves (412)">{counts.webDavStaleWritesLast24Hours}</Fact>
                    <Fact label="Last request">{counts.lastWebDavRequestAt ? formatDateTime(counts.lastWebDavRequestAt) : 'None logged yet'}</Fact>
                    <p className="text-xs text-muted-foreground">Errors are answers with status 400 or higher, without the 401 sign-in prompt every KeePass app receives first.</p>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">Not available.</p>
                )}
              </CardContent>
            </Card>

            {server && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><ServerIcon className="size-4" /> System</CardTitle>
                  <CardDescription>The running KeePort application. Docker's own status and engine version are not visible from inside the container.</CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-2.5">
                    <Fact label="KeePort version">
                      {server.version}{server.commit && <span className="text-muted-foreground"> ({server.commit.slice(0, 12)})</span>}
                    </Fact>
                    <Fact label=".NET">{server.runtime}</Fact>
                    <Fact label="Operating system">{server.operatingSystem}</Fact>
                    <Fact label="Docker">{server.inDocker ? 'Runs in a Docker container' : 'Not in Docker'}</Fact>
                    <Fact label="Started">{formatDateTime(server.startedAt)}</Fact>
                  </dl>
                </CardContent>
              </Card>
            )}

            {server && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><ShieldCheckIcon className="size-4" /> Network & admin access</CardTitle>
                  <CardDescription>
                    {server.inDocker
                      ? 'Addresses and ports inside the container. The host ports come from your .env file.'
                      : 'Addresses and ports of this KeePort instance.'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-2.5">
                    <Fact label={server.inDocker ? 'Container IPs' : 'IP addresses'}>
                      {server.addresses.length ? server.addresses.join(', ') : 'Not available'}
                    </Fact>
                    <Fact label="Vault & WebDAV port">{server.vaultPorts.length ? server.vaultPorts.join(', ') : 'Not available'}</Fact>
                    <Fact label="Admin port">{server.adminPorts.length ? server.adminPorts.join(', ') : 'Same as the vault'}</Fact>
                    <Fact label="Admin HTTPS">
                      {server.adminHttps ? 'On, with a self-signed certificate' : 'Off (KEEPORT_ADMIN_HTTPS=false or no separate admin port)'}
                    </Fact>
                    {server.adminCertificateNotAfter && (
                      <Fact label="Certificate valid until">
                        <span className={certificateDays !== null && certificateDays < CERTIFICATE_WARNING_DAYS ? 'font-medium text-destructive' : undefined}>
                          {formatDateTime(server.adminCertificateNotAfter)}
                        </span>
                      </Fact>
                    )}
                    {server.adminCertificateFingerprint && (
                      <Fact label="SHA-256 fingerprint"><span className="font-mono text-xs break-all">{server.adminCertificateFingerprint}</span></Fact>
                    )}
                    <Fact label="Trusted proxies">{server.trustedProxies}</Fact>
                  </dl>
                </CardContent>
              </Card>
            )}

            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><HardDriveIcon className="size-4" /> Data storage</CardTitle>
                <CardDescription>Where KeePort keeps its database and vault files.</CardDescription>
                <CardAction>
                  <Button variant="outline" size="sm" onClick={/** Opens the settings with the storage details. */ () => onNavigate('settings')}>
                    Details <ArrowRightIcon />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-2.5">
                  <Fact label="Kind">
                    <span className="inline-flex items-center gap-2">
                      {STORAGE_LABELS[data.storage.kind]}
                      {data.storage.needsAttention && <Badge variant="destructive">Check backups</Badge>}
                    </span>
                  </Fact>
                  <Fact label="Data directory">{data.storage.dataDir}</Fact>
                  {data.storage.source && <Fact label="Source on the host"><span className="break-all">{data.storage.source}</span></Fact>}
                </dl>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
