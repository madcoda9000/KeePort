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
import { cn } from '@/lib/utils';
import { ACCENTS, type AccentName } from '@shared/accent';
import messages from '@/i18n/dashboard';
import { formatDateTime, translate } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';

/** Admin sections the dashboard links to. */
export type DashboardTarget = 'vaults' | 'users' | 'webdav' | 'settings' | 'webdav-logs';

/** Days before expiry from which the admin certificate is shown as expiring soon. */
const CERTIFICATE_WARNING_DAYS = 30;

/** Catalog keys of the storage kinds. */
const STORAGE_LABELS: Record<DashboardData['storage']['kind'], keyof typeof messages.en> = {
  hostFolder: 'storageHostFolder',
  dockerVolume: 'storageDockerVolume',
  notMounted: 'storageNotMounted',
  unknown: 'storageUnknown'
};

/**
 * Formats a duration in seconds as days, hours and minutes, e.g. "3 d 4 h 12 min".
 * @param seconds - The duration in seconds.
 */
function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return translate(messages, 'uptimeDays', { days, hours, minutes });
  if (hours > 0) return translate(messages, 'uptimeHours', { hours, minutes });
  return translate(messages, 'uptimeMinutes', { minutes });
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
 * @param props - The title, icon, accent colour of the icon, value (null when unknown), detail line and optional action.
 */
function StatCard({
  title,
  icon,
  accent,
  value,
  detail,
  action
}: {
  title: string;
  icon: ReactNode;
  accent: AccentName;
  value: ReactNode | null;
  detail: ReactNode;
  action?: ReactNode;
}) {
  const t = useT(messages);
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2.5 font-medium">
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4', ACCENTS[accent].tile)}>{icon}</span>
          {title}
        </CardDescription>
        <CardTitle className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value ?? <span className="text-base text-muted-foreground">{t('notAvailable')}</span>}</CardTitle>
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
  const t = useT(messages);
  return (
    <TableCell className="tabular-nums">
      <span title={t('successfulSignIns')}>{counts.success}</span>
      <span className="text-muted-foreground"> / </span>
      <span title={t('failedSignIns')} className={counts.failure > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}>
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
  const t = useT(messages);

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
        setError(cause instanceof ApiError || cause instanceof Error ? cause.message : translate(messages, 'loadFailed'));
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
  if (data?.storage.needsAttention) attention.push({ text: t('attentionStorage'), target: 'settings', label: t('storageDetails') });
  if (counts && counts.conflictCopies > 0) attention.push({ text: t('attentionConflicts', { count: counts.conflictCopies }), target: 'vaults', label: t('vaultFiles') });
  if (certificateDays !== null && certificateDays < CERTIFICATE_WARNING_DAYS) attention.push({ text: t('attentionCertificate', { count: Math.max(certificateDays, 0) }) });
  if (logins && logins.adminLast24Hours.failure > 0) attention.push({ text: t('attentionFailedAdmin', { count: logins.adminLast24Hours.failure }) });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          {data && !error ? (
            <Badge variant="outline" className={cn('gap-1.5', ACCENTS.emerald.badge)}><CircleCheckIcon /> {t('running')}</Badge>
          ) : error ? (
            <Badge variant="destructive" className="gap-1.5"><CircleAlertIcon /> {t('statusUnavailable')}</Badge>
          ) : null}
          <span className="text-muted-foreground" aria-live="polite">
            {loadedAt ? t('updated', { time: formatDateTime(loadedAt, { timeStyle: 'medium' }) }) : loading ? t('loading') : ''}
          </span>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={refresh}>
          <RefreshCwIcon className={loading ? 'animate-spin' : undefined} /> {t('refresh')}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{t('loadFailedTitle')}</AlertTitle>
          <AlertDescription>
            {error}{data ? ` ${t('staleValues')}` : ''}
          </AlertDescription>
        </Alert>
      )}
      {data && data.errors.length > 0 && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{t('someUnavailable')}</AlertTitle>
          <AlertDescription>{data.errors.join(' ')}</AlertDescription>
        </Alert>
      )}
      {attention.length > 0 && (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>{t('needsAttention')}</AlertTitle>
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
              title={t('uptime')}
              accent="emerald"
              icon={<ActivityIcon />}
              value={server ? formatUptime(server.uptimeSeconds) : null}
              detail={server ? t('since', { time: formatDateTime(server.startedAt) }) : ''}
            />
            <StatCard
              title={t('vaults')}
              accent="sky"
              icon={<DatabaseIcon />}
              value={counts?.vaults ?? null}
              detail={counts ? `${t('deletedCount', { count: counts.deletedVaults })} · ${t('conflictCopies', { count: counts.conflictCopies })}` : t('totalsUnavailable')}
              action={<Button variant="ghost" size="icon-sm" aria-label={t('openVaultFiles')} onClick={/** Opens the vault files. */ () => onNavigate('vaults')}><ArrowRightIcon /></Button>}
            />
            <StatCard
              title={t('accounts')}
              accent="violet"
              icon={<UsersIcon />}
              value={counts ? counts.users + counts.admins : null}
              detail={counts
                ? `${t('userCount', { count: counts.users })} (${t('disabledCount', { count: counts.disabledUsers })}) · ${t('adminCount', { count: counts.admins })}${counts.disabledAdmins ? ` (${t('disabledCount', { count: counts.disabledAdmins })})` : ''}`
                : t('totalsUnavailable')}
              action={<Button variant="ghost" size="icon-sm" aria-label={t('openUsers')} onClick={/** Opens the users. */ () => onNavigate('users')}><ArrowRightIcon /></Button>}
            />
            <StatCard
              title={t('appPasswords')}
              accent="amber"
              icon={<NetworkIcon />}
              value={counts?.activeWebDavCredentials ?? null}
              detail={counts ? t('requestsLast24Hours', { count: counts.webDavRequestsLast24Hours }) : t('totalsUnavailable')}
              action={<Button variant="ghost" size="icon-sm" aria-label={t('openWebDav')} onClick={/** Opens the WebDAV credentials. */ () => onNavigate('webdav')}><ArrowRightIcon /></Button>}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('signIns')}</CardTitle>
                <CardDescription>
                  {logins
                    ? t('signInsDescription', { time: formatDateTime(logins.since) })
                    : t('signInsUnavailable')}
                </CardDescription>
              </CardHeader>
              {logins && (
                <CardContent className="px-0">
                  <Table aria-label={t('signIns')}>
                    <TableHeader className="bg-muted/45">
                      <TableRow>
                        <TableHead scope="col" className="ps-6">{t('where')}</TableHead>
                        <TableHead scope="col">{t('last24Hours')}</TableHead>
                        <TableHead scope="col">{t('last7Days')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="ps-6 font-medium">{t('adminConsole')}</TableCell>
                        <CountsCell counts={logins.adminLast24Hours} />
                        <CountsCell counts={logins.adminLast7Days} />
                      </TableRow>
                      <TableRow>
                        <TableCell className="ps-6 font-medium">{t('webVault')}</TableCell>
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
                <CardTitle>{t('webDavActivity')}</CardTitle>
                <CardDescription>{t('webDavActivityDescription')}</CardDescription>
                <CardAction>
                  <Button variant="outline" size="sm" onClick={/** Opens the WebDAV logs. */ () => onNavigate('webdav-logs')}>
                    {t('logs')} <ArrowRightIcon />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {counts ? (
                  <dl className="grid gap-2.5">
                    <Fact label={t('requests')}>{counts.webDavRequestsLast24Hours}</Fact>
                    <Fact label={t('errors')}>
                      <span className={counts.webDavErrorsLast24Hours > 0 ? 'font-medium text-destructive' : undefined}>{counts.webDavErrorsLast24Hours}</span>
                    </Fact>
                    <Fact label={t('staleWrites')}>{counts.webDavStaleWritesLast24Hours}</Fact>
                    <Fact label={t('lastRequest')}>{counts.lastWebDavRequestAt ? formatDateTime(counts.lastWebDavRequestAt) : t('noneLogged')}</Fact>
                    <p className="text-xs text-muted-foreground">{t('errorsHint')}</p>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('notAvailableSentence')}</p>
                )}
              </CardContent>
            </Card>

            {server && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><ServerIcon className="size-4 text-primary" /> {t('system')}</CardTitle>
                  <CardDescription>{t('systemDescription')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-2.5">
                    <Fact label={t('version')}>
                      {server.version}{server.commit && <span className="text-muted-foreground"> ({server.commit.slice(0, 12)})</span>}
                    </Fact>
                    <Fact label=".NET">{server.runtime}</Fact>
                    <Fact label={t('operatingSystem')}>{server.operatingSystem}</Fact>
                    <Fact label="Docker">{server.inDocker ? t('inDocker') : t('notInDocker')}</Fact>
                    <Fact label={t('started')}>{formatDateTime(server.startedAt)}</Fact>
                  </dl>
                </CardContent>
              </Card>
            )}

            {server && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><ShieldCheckIcon className="size-4 text-primary" /> {t('network')}</CardTitle>
                  <CardDescription>
                    {server.inDocker
                      ? t('networkDocker')
                      : t('networkPlain')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-2.5">
                    <Fact label={server.inDocker ? t('containerIps') : t('ipAddresses')}>
                      {server.addresses.length ? server.addresses.join(', ') : t('notAvailable')}
                    </Fact>
                    <Fact label={t('vaultPort')}>{server.vaultPorts.length ? server.vaultPorts.join(', ') : t('notAvailable')}</Fact>
                    <Fact label={t('adminPort')}>{server.adminPorts.length ? server.adminPorts.join(', ') : t('sameAsVault')}</Fact>
                    <Fact label={t('adminHttps')}>
                      {server.adminHttps ? t('httpsOn') : t('httpsOff')}
                    </Fact>
                    {server.adminCertificateNotAfter && (
                      <Fact label={t('certificateValidUntil')}>
                        <span className={certificateDays !== null && certificateDays < CERTIFICATE_WARNING_DAYS ? 'font-medium text-destructive' : undefined}>
                          {formatDateTime(server.adminCertificateNotAfter)}
                        </span>
                      </Fact>
                    )}
                    {server.adminCertificateFingerprint && (
                      <Fact label={t('fingerprint')}><span className="font-mono text-xs break-all">{server.adminCertificateFingerprint}</span></Fact>
                    )}
                    <Fact label={t('trustedProxies')}>{server.trustedProxies}</Fact>
                  </dl>
                </CardContent>
              </Card>
            )}

            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><HardDriveIcon className="size-4 text-primary" /> {t('dataStorage')}</CardTitle>
                <CardDescription>{t('dataStorageDescription')}</CardDescription>
                <CardAction>
                  <Button variant="outline" size="sm" onClick={/** Opens the settings with the storage details. */ () => onNavigate('settings')}>
                    {t('details')} <ArrowRightIcon />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-2.5">
                  <Fact label={t('kind')}>
                    <span className="inline-flex items-center gap-2">
                      {t(STORAGE_LABELS[data.storage.kind])}
                      {data.storage.needsAttention && <Badge variant="destructive">{t('checkBackups')}</Badge>}
                    </span>
                  </Fact>
                  <Fact label={t('dataDirectory')}>{data.storage.dataDir}</Fact>
                  {data.storage.source && <Fact label={t('sourceOnHost')}><span className="break-all">{data.storage.source}</span></Fact>}
                </dl>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
