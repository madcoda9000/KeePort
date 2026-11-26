import { useEffect, useState, type FormEvent } from 'react';
import { MailCheckIcon, MailWarningIcon, SendIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { api, type EmailSettings, type EmailSettingsResponse } from '@/lib/api';
import { cn } from '@/lib/utils';
import messages from '@/i18n/email-settings';
import { ACCENTS } from '@shared/accent';
import { formatDateTime, formatNumber, translate } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';

type Security = EmailSettings['security'];

/** The editable form state; numbers and optional texts are kept as strings while typing. */
type Draft = {
  host: string;
  port: string;
  security: Security;
  username: string;
  password: string;
  removePassword: boolean;
  fromAddress: string;
  fromName: string;
  publicUrl: string;
  warnFailedSignIns: boolean;
  warnCertificate: boolean;
  warnStorage: boolean;
  warnDiskSpace: boolean;
  logDays: string;
};

type WarningKey = 'warnFailedSignIns' | 'warnCertificate' | 'warnStorage' | 'warnDiskSpace';

const WARNINGS: readonly WarningKey[] = ['warnFailedSignIns', 'warnCertificate', 'warnStorage', 'warnDiskSpace'];

/** The usual port of each connection security, filled in when the security changes and the port was the default of another. */
const DEFAULT_PORTS: Record<Security, number> = { starttls: 587, ssl: 465, none: 25 };

/**
 * Turns the saved settings into the editable form state.
 * @param settings - The settings returned by the server.
 */
function toDraft(settings: EmailSettings): Draft {
  return {
    host: settings.host ?? '',
    port: String(settings.port || 587),
    security: settings.security,
    username: settings.username ?? '',
    password: '',
    removePassword: false,
    fromAddress: settings.fromAddress ?? '',
    fromName: settings.fromName ?? 'KeePort',
    publicUrl: settings.publicUrl ?? '',
    warnFailedSignIns: settings.warnFailedSignIns,
    warnCertificate: settings.warnCertificate,
    warnStorage: settings.warnStorage,
    warnDiskSpace: settings.warnDiskSpace,
    logDays: String(settings.logRetentionDays ?? 30)
  };
}

/**
 * Turns a trimmed text into null when it is empty.
 * @param value - The text from the form.
 */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Loads and edits the SMTP settings and admin warnings, sends a test e-mail and shows the outgoing queue. */
export function EmailSettingsPanel() {
  const t = useT(messages);
  const [data, setData] = useState<EmailSettingsResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  /** Loads the settings on mount and on retry, aborting obsolete requests. */
  useEffect(() => {
    const controller = new AbortController();
    void api.getEmailSettings(controller.signal).then(
      /**
       * Shows the loaded settings and fills the form.
       * @param response - The settings, their status and the queue.
       */
      (response) => {
        if (!controller.signal.aborted) {
          setData(response);
          setDraft(toDraft(response.settings));
        }
      },
      /**
       * Reports a loading error unless the request was aborted.
       * @param error - The caught error to inspect.
       */
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setMessage({ text: error instanceof Error ? error.message : translate(messages, 'loadFailed'), error: true });
        }
      }
    );
    return /** Aborts the pending settings load when the effect is cleaned up. */ () => controller.abort();
  }, [loadAttempt]);

  /**
   * Changes one field of the form.
   * @param patch - The fields to change.
   */
  function update(patch: Partial<Draft>) {
    /**
     * Merges the change into the current form state.
     * @param current - The form state before the change.
     */
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  /**
   * Changes the connection security and, if the port was still the usual one of the old security, the port as well.
   * @param security - The newly chosen security.
   */
  function changeSecurity(security: Security) {
    if (!draft) return;
    const portIsDefault = Number(draft.port) === DEFAULT_PORTS[draft.security];
    update({ security, ...(portIsDefault ? { port: String(DEFAULT_PORTS[security]) } : {}) });
  }

  /**
   * Validates and saves the settings, keeping the form if saving fails.
   * @param event - The submission event of the e-mail settings form.
   */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    const port = Number(draft.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setMessage({ text: t('invalidPort'), error: true });
      return;
    }
    const logRetentionDays = Number(draft.logDays);
    if (!Number.isInteger(logRetentionDays) || logRetentionDays < 1 || logRetentionDays > 365) {
      setMessage({ text: t('invalidLogDays'), error: true });
      return;
    }
    const settings: EmailSettings = {
      host: orNull(draft.host),
      port,
      security: draft.security,
      username: orNull(draft.username),
      password: draft.removePassword ? '' : draft.password ? draft.password : null,
      hasPassword: data?.settings.hasPassword ?? false,
      fromAddress: orNull(draft.fromAddress),
      fromName: orNull(draft.fromName),
      publicUrl: orNull(draft.publicUrl),
      warnFailedSignIns: draft.warnFailedSignIns,
      warnCertificate: draft.warnCertificate,
      warnStorage: draft.warnStorage,
      warnDiskSpace: draft.warnDiskSpace,
      logRetentionDays
    };
    setBusy('save');
    setMessage(null);
    try {
      const response = await api.updateEmailSettings(settings);
      setData(response);
      setDraft(toDraft(response.settings));
      setMessage({ text: t('saved'), error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : t('saveFailed'), error: true });
    } finally {
      setBusy(null);
    }
  }

  /** Sends a test e-mail to the signed-in admin and reloads the queue status afterwards. */
  async function sendTest() {
    if (busy) return;
    setBusy('test');
    setMessage(null);
    try {
      const result = await api.sendTestEmail();
      setMessage({ text: t('testSent', { email: result.sentTo }), error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : t('testFailed'), error: true });
    } finally {
      setBusy(null);
    }
    try {
      setData(await api.getEmailSettings());
    } catch {
      /* the queue status is only informational */
    }
  }

  const saved = data?.settings;
  const canTest = Boolean(saved?.host && saved.fromAddress);
  const missing = saved
    ? [
        !saved.host && t('missingHost'),
        !saved.fromAddress && t('missingFrom'),
        !saved.publicUrl && t('missingPublicUrl')
      ].filter(/**
       * Keeps only the names of missing settings.
       * @param item - A missing setting's name, or false when it is set.
       */ (item): item is string => Boolean(item))
    : [];

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t('title')}
          {data && (
            data.configured ? (
              <Badge variant="outline" className={cn('gap-1', ACCENTS.emerald.badge)}>
                <MailCheckIcon /> {t('ready')}
              </Badge>
            ) : (
              <Badge variant="outline" className={cn('gap-1', ACCENTS.amber.badge)}>
                <MailWarningIcon /> {t('notSetUp')}
              </Badge>
            )
          )}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        {data && !data.configured && missing.length > 0 && (
          <p className={cn('text-sm', ACCENTS.amber.text)}>{t('missing', { fields: missing.join(t('listSeparator')) })}</p>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {message && (
          <Alert variant={message.error ? 'destructive' : 'default'}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
        {draft && data ? (
          <form className="grid gap-5" onSubmit={save}>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                <Field>
                  <FieldLabel htmlFor="email-host">{t('host')}</FieldLabel>
                  <Input
                    id="email-host"
                    autoComplete="off"
                    placeholder={t('hostPlaceholder')}
                    disabled={busy !== null}
                    value={draft.host}
                    onChange={/**
                     * Updates the SMTP server.
                     * @param event - The input change event.
                     */ (event) => update({ host: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="email-port">{t('port')}</FieldLabel>
                  <Input
                    id="email-port"
                    type="number"
                    min={1}
                    max={65535}
                    step={1}
                    required
                    disabled={busy !== null}
                    value={draft.port}
                    onChange={/**
                     * Updates the SMTP port.
                     * @param event - The input change event.
                     */ (event) => update({ port: event.target.value })}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="email-security">{t('security')}</FieldLabel>
                <NativeSelect
                  id="email-security"
                  className="w-full"
                  disabled={busy !== null}
                  value={draft.security}
                  onChange={/**
                   * Updates the connection security.
                   * @param event - The select change event.
                   */ (event) => changeSecurity(event.target.value as Security)}
                >
                  <NativeSelectOption value="starttls">{t('securityStartTls')}</NativeSelectOption>
                  <NativeSelectOption value="ssl">{t('securitySsl')}</NativeSelectOption>
                  <NativeSelectOption value="none">{t('securityNone')}</NativeSelectOption>
                </NativeSelect>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="email-username">{t('username')}</FieldLabel>
                  <Input
                    id="email-username"
                    autoComplete="off"
                    disabled={busy !== null}
                    value={draft.username}
                    onChange={/**
                     * Updates the SMTP username.
                     * @param event - The input change event.
                     */ (event) => update({ username: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="email-password">{t('password')}</FieldLabel>
                  <Input
                    id="email-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder={data.settings.hasPassword ? t('passwordStored') : undefined}
                    disabled={busy !== null || draft.removePassword}
                    value={draft.password}
                    onChange={/**
                     * Updates the new SMTP password.
                     * @param event - The input change event.
                     */ (event) => update({ password: event.target.value })}
                  />
                </Field>
              </div>
              {data.settings.hasPassword && (
                <Field orientation="horizontal">
                  <Checkbox
                    id="email-remove-password"
                    checked={draft.removePassword}
                    disabled={busy !== null}
                    onCheckedChange={/**
                     * Marks the stored password for removal on save.
                     * @param checked - The new checkbox state.
                     */ (checked) => update({ removePassword: checked === true, password: '' })}
                  />
                  <FieldLabel htmlFor="email-remove-password" className="font-normal">{t('removePassword')}</FieldLabel>
                </Field>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="email-from-address">{t('fromAddress')}</FieldLabel>
                  <Input
                    id="email-from-address"
                    type="email"
                    autoComplete="off"
                    maxLength={254}
                    disabled={busy !== null}
                    value={draft.fromAddress}
                    onChange={/**
                     * Updates the sender address.
                     * @param event - The input change event.
                     */ (event) => update({ fromAddress: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="email-from-name">{t('fromName')}</FieldLabel>
                  <Input
                    id="email-from-name"
                    autoComplete="off"
                    disabled={busy !== null}
                    value={draft.fromName}
                    onChange={/**
                     * Updates the sender name.
                     * @param event - The input change event.
                     */ (event) => update({ fromName: event.target.value })}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="email-public-url">{t('publicUrl')}</FieldLabel>
                <Input
                  id="email-public-url"
                  type="url"
                  autoComplete="off"
                  aria-describedby="email-public-url-help"
                  disabled={busy !== null}
                  value={draft.publicUrl}
                  onChange={/**
                   * Updates the web vault address used in links.
                   * @param event - The input change event.
                   */ (event) => update({ publicUrl: event.target.value })}
                />
                <FieldDescription id="email-public-url-help">{t('publicUrlHelp')}</FieldDescription>
              </Field>
            </FieldGroup>
            <Separator />
            <div className="grid gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">{t('warningsTitle')}</h3>
                <p className="text-sm text-muted-foreground">{t('warningsHelp')}</p>
              </div>
              {WARNINGS.map(/**
               * Renders the checkbox of one admin warning.
               * @param key - The warning's settings field.
               */ (key) => (
                <Field key={key} orientation="horizontal">
                  <Checkbox
                    id={`email-${key}`}
                    checked={draft[key]}
                    disabled={busy !== null}
                    onCheckedChange={/**
                     * Turns the warning on or off.
                     * @param checked - The new checkbox state.
                     */ (checked) => update({ [key]: checked === true })}
                  />
                  <FieldLabel htmlFor={`email-${key}`} className="font-normal">{t(key)}</FieldLabel>
                </Field>
              ))}
            </div>
            <Field>
              <FieldLabel htmlFor="email-log-days">{t('logDays')}</FieldLabel>
              <Input
                id="email-log-days"
                type="number"
                min={1}
                max={365}
                step={1}
                required
                aria-describedby="email-log-days-help"
                disabled={busy !== null}
                value={draft.logDays}
                onChange={/**
                 * Updates how long the e-mail log keeps entries.
                 * @param event - The input change event.
                 */ (event) => update({ logDays: event.target.value })}
              />
              <FieldDescription id="email-log-days-help">{t('logDaysHelp')}</FieldDescription>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy !== null}>{busy === 'save' ? t('saving') : t('save')}</Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null || !canTest}
                onClick={/** Sends a test e-mail to the signed-in admin. */ () => void sendTest()}
              >
                <SendIcon />
                {busy === 'test' ? t('sendingTest') : t('sendTest')}
              </Button>
            </div>
            {!canTest && <p className="text-sm text-muted-foreground">{t('testHelp')}</p>}
            <Separator />
            <div className="grid gap-1 text-sm">
              <h3 className="font-semibold">{t('queueTitle')}</h3>
              <p className="text-muted-foreground">
                {t('queueCounts', {
                  waiting: formatNumber(data.queue.waiting),
                  sent: formatNumber(data.queue.sentLast7Days),
                  failed: formatNumber(data.queue.failedLast7Days)
                })}
              </p>
              <p className="text-muted-foreground">
                {data.queue.lastSentAt ? t('lastSent', { time: formatDateTime(data.queue.lastSentAt) }) : t('neverSent')}
              </p>
              {data.queue.lastError && (
                <p className="break-words text-destructive">{t('lastError', { error: data.queue.lastError })}</p>
              )}
            </div>
          </form>
        ) : message ? (
          <Button type="button" variant="outline" className="w-fit" onClick={/** Clears the error and retries loading the settings. */ () => {
            setMessage(null);
            /**
             * Advances the retry counter to trigger a fresh load.
             * @param attempt - The current attempt counter.
             */
            setLoadAttempt((attempt) => attempt + 1);
          }}>
            {t('retry')}
          </Button>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">{t('loading')}</p>
        )}
      </CardContent>
    </Card>
  );
}
