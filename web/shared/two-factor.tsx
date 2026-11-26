import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CheckIcon, CopyIcon, DownloadIcon, FingerprintIcon, KeyRoundIcon, MailIcon, ShieldCheckIcon, SmartphoneIcon } from 'lucide-react';
import { encode } from 'uqr';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ACCENTS } from '@shared/accent';
import { formatDateTime } from '@shared/i18n/core';
import messages from '@shared/i18n/messages/two-factor';
import { useT } from '@shared/i18n/react';
import type { MfaApi, MfaChallenge, MfaMethod, MfaStatus } from '@shared/two-factor-api';
import { createPasskey, getPasskey, isPasskeyCancel, isPasskeyDuplicate, passkeyBlocker } from '@shared/passkey';
import { describeUserAgent } from '@shared/user-agent';

/**
 * Reads the message of a failed request.
 * @param reason - The error.
 * @param fallback - The text for errors without a message.
 */
function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

/**
 * Reads the message of a failed passkey step, with a plain text when the user closed the browser's dialog.
 * @param reason - The error.
 * @param t - The translator of the two-factor texts.
 */
function passkeyErrorText(reason: unknown, t: (key: 'passkeyCancelled' | 'passkeyDuplicate' | 'failed') => string) {
  if (isPasskeyCancel(reason)) return t('passkeyCancelled');
  if (isPasskeyDuplicate(reason)) return t('passkeyDuplicate');
  return errorText(reason, t('failed'));
}

/**
 * Keeps only the digits of a typed code, at most six.
 * @param value - The typed text.
 */
function digitsOnly(value: string) {
  return value.replace(/\D/g, '').slice(0, 6);
}

/**
 * A field for a 6-digit code that phones and password managers can fill in.
 * @param props - The field ID, label, value and change handler.
 */
function CodeInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field className="w-44">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoFocus
        className="font-mono tracking-[0.3em]"
        value={value}
        onChange={/**
         * Keeps the digits of the typed code.
         * @param event - The input change event.
         */ (event) => onChange(digitsOnly(event.target.value))}
      />
    </Field>
  );
}

/**
 * Draws a QR code as SVG; each dark module is one square of the path.
 * @param props - The text to encode and the accessible label.
 */
function QrCode({ text, label }: { text: string; label: string }) {
  const { path, size } = useMemo(/** Encodes the text and builds the SVG path. */ () => {
    const qr = encode(text, { border: 2, ecc: 'M' });
    let d = '';
    qr.data.forEach(/**
     * Adds the dark modules of one row.
     * @param row - The modules of the row.
     * @param y - The row index.
     */ (row, y) => row.forEach(/**
      * Adds one dark module.
      * @param dark - Whether the module is dark.
      * @param x - The column index.
      */ (dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }));
    return { path: d, size: qr.size };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges" className="size-44 rounded-md border bg-white">
      <path d={path} fill="#000" />
    </svg>
  );
}

/**
 * Shows new recovery codes once, with copy and download, until the user confirms they saved them.
 * @param props - The codes, the account name for the file, and the callback when done.
 */
function RecoveryCodes({ codes, username, onDone }: { codes: string[]; username: string; onDone: () => void }) {
  const t = useT(messages);
  const [copied, setCopied] = useState(false);
  const text = `${t('codesFileHeader', { username })}\n\n${codes.join('\n')}\n`;

  /** Copies all codes to the clipboard. */
  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  /** Saves the codes as a text file. */
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `keeport-recovery-codes-${username}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-3 rounded-lg border border-primary/25 bg-accent/40 p-4">
      <h4 className="text-sm font-semibold">{t('codesTitle')}</h4>
      <p className="text-sm text-muted-foreground">{t('codesShowOnce')}</p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm" aria-label={t('codesTitle')}>
        {codes.map(/**
         * Shows one code.
         * @param code - The code.
         */ (code) => <li key={code}>{code}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={/** Copies the codes. */ () => void copy()}>
          {copied ? <CheckIcon /> : <CopyIcon />} {copied ? t('copied') : t('copyCodes')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <DownloadIcon /> {t('downloadCodes')}
        </Button>
        <Button type="button" size="sm" onClick={onDone}>{t('done')}</Button>
      </div>
    </div>
  );
}

/**
 * A small inline form that asks for the account password, optionally with more fields, and submits it.
 * @param props - The help text, the submit label, extra fields, whether it can be submitted, and the handlers.
 */
function PasswordStep({
  id,
  help,
  submitLabel,
  children,
  canSubmit = true,
  busy,
  onSubmit,
  onCancel
}: {
  id: string;
  help?: string;
  submitLabel: string;
  children?: ReactNode;
  canSubmit?: boolean;
  busy: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const t = useT(messages);
  const [password, setPassword] = useState('');

  /**
   * Submits the password.
   * @param event - The form submission event.
   */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(password);
  }

  return (
    <form className="grid gap-3" onSubmit={submit}>
      {help && <p className="text-sm text-muted-foreground">{help}</p>}
      <Field className="max-w-72">
        <FieldLabel htmlFor={id}>{t('passwordLabel')}</FieldLabel>
        <Input
          id={id}
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          value={password}
          onChange={/**
           * Stores the typed password.
           * @param event - The input change event.
           */ (event) => setPassword(event.target.value)}
        />
      </Field>
      {children}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !password || !canSubmit}>{submitLabel}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
      </div>
    </form>
  );
}

type Step =
  | { kind: 'idle' }
  | { kind: 'totpPassword' }
  | { kind: 'totpScan'; secret: string; uri: string }
  | { kind: 'totpOff' }
  | { kind: 'emailOn' }
  | { kind: 'emailOff' }
  | { kind: 'newCodes' }
  | { kind: 'passkeyAdd' }
  | { kind: 'passkeyRemove'; id: string; name: string }
  | { kind: 'codes'; codes: string[] };

/**
 * The two-factor section of the profile: authenticator app, e-mail codes and recovery codes, each set up inline.
 * @param props - The account name, the app's two-factor API calls, a callback after every change, whether to show
 * the hint that the administrator requires a second factor, and whether to show the title (off when the surrounding
 * area already has it).
 */
export function TwoFactorSettings({ username, api, onChange, showRequiredHint = true, showTitle = true }: { username: string; api: MfaApi; onChange?: (status: MfaStatus) => void; showRequiredHint?: boolean; showTitle?: boolean }) {
  const t = useT(messages);
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [passkeyName, setPasskeyName] = useState('');
  const blocker = passkeyBlocker();

  /** Loads the current state once. */
  useEffect(() => {
    let cancelled = false;
    api.status().then(
      /**
       * Shows the loaded state.
       * @param loaded - The state.
       */ (loaded) => {
        if (!cancelled) setStatus(loaded);
      },
      /**
       * Shows why the state could not be loaded.
       * @param reason - The error.
       */ (reason: unknown) => {
        if (!cancelled) setError(errorText(reason, t('failed')));
      });
    return /** Ignores a late answer. */ () => {
      cancelled = true;
    };
  }, [api, t]);

  /**
   * Opens a step and clears the inputs and messages of the previous one.
   * @param next - The step to show.
   */
  function open(next: Step) {
    setStep(next);
    setCode('');
    setUseRecovery(false);
    setCopiedKey(false);
    setPasskeyName(next.kind === 'passkeyAdd' ? describeUserAgent(navigator.userAgent) ?? '' : '');
    setError(null);
    setNotice(null);
  }

  /**
   * Runs a request, shows its error, and applies a new state with recovery codes if any.
   * @param action - The request.
   * @param successNotice - The notice after success when no codes are shown.
   */
  async function run(action: () => Promise<{ status: MfaStatus; recoveryCodes: string[] } | void>, successNotice?: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result) {
        setStatus(result.status);
        onChange?.(result.status);
        if (result.recoveryCodes.length > 0) {
          open({ kind: 'codes', codes: result.recoveryCodes });
        } else {
          open({ kind: 'idle' });
          if (successNotice) setNotice(successNotice);
        }
      }
    } catch (reason) {
      setError(passkeyErrorText(reason, t));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Adds a passkey: checks the password, lets the browser create the passkey and stores it.
   * @param password - The account password.
   */
  async function addPasskey(password: string) {
    const name = passkeyName.trim() || describeUserAgent(navigator.userAgent) || 'Passkey';
    await run(/** Runs the ceremony. */ async () => {
      const ceremony = await api.passkeyOptions(password);
      const response = await createPasskey(ceremony.options);
      return api.addPasskey(ceremony.challengeId, name, response);
    }, t('passkeyAdded'));
  }

  /**
   * Starts setting up the authenticator app.
   * @param password - The account password.
   */
  async function startTotp(password: string) {
    setBusy(true);
    setError(null);
    try {
      const setup = await api.startTotp(password);
      open({ kind: 'totpScan', secret: setup.secret, uri: setup.uri });
    } catch (reason) {
      setError(errorText(reason, t('failed')));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Finishes the setup with a code from the app.
   * @param event - The form submission event.
   */
  function confirmTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(/** Sends the code. */ () => api.confirmTotp(code), t('turnedOn'));
  }

  /**
   * Copies the key for typing it into the app.
   * @param secret - The key.
   */
  async function copyKey(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopiedKey(true);
    } catch {
      setCopiedKey(false);
    }
  }

  if (!status) {
    return (
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">{t('title')}</h3>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </section>
    );
  }

  const totpOn = status.totpEnabledAt !== null;
  const emailOn = status.emailEnabledAt !== null;
  const anyOn = totpOn || emailOn || status.passkeys.length > 0;
  const onBadge = (
    <Badge variant="outline" className={cn('gap-1', ACCENTS.emerald.badge)}>
      <CheckIcon /> {t('on')}
    </Badge>
  );

  return (
    <section className="grid gap-4" aria-labelledby="two-factor-title">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 id="two-factor-title" className={showTitle ? 'text-sm font-semibold' : 'sr-only'}>{t('title')}</h3>
          {status.active ? onBadge : <Badge variant="outline">{t('off')}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{t('help')}</p>
        {status.required && showRequiredHint && <p className="text-sm font-medium">{t('requiredHint')}</p>}
      </div>
      {notice && (
        <Alert role="status" className="border-primary/25 bg-accent text-accent-foreground">
          <ShieldCheckIcon />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {step.kind === 'codes' ? (
        <RecoveryCodes codes={step.codes} username={username} onDone={/** Hides the codes. */ () => open({ kind: 'idle' })} />
      ) : (
        <>
          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex gap-3">
                <FingerprintIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{t('passkeysTitle')}</p>
                  <p className="text-sm text-muted-foreground">{t('passkeysHelp')}</p>
                  {blocker && (
                    <p className="text-sm text-muted-foreground">{blocker === 'domain' ? t('passkeysBlockedDomain') : t('passkeysBlockedBrowser')}</p>
                  )}
                </div>
              </div>
              {step.kind === 'idle' && !blocker && (
                <Button type="button" size="sm" variant={status.passkeys.length > 0 ? 'outline' : 'default'} onClick={/** Opens adding a passkey. */ () => open({ kind: 'passkeyAdd' })}>
                  {t('addPasskey')}
                </Button>
              )}
            </div>
            {status.passkeys.length > 0 && (
              <ul className="grid gap-2" aria-label={t('passkeysTitle')}>
                {status.passkeys.map(/**
                 * Shows one passkey.
                 * @param passkey - The passkey.
                 */ (passkey) => (
                  <li key={passkey.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{passkey.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t('passkeyDetails', { domain: passkey.domain, created: formatDateTime(passkey.createdAt, { dateStyle: 'medium' }) })}
                        {passkey.lastUsedAt && ` · ${t('passkeyLastUsed', { date: formatDateTime(passkey.lastUsedAt, { dateStyle: 'medium' }) })}`}
                      </p>
                    </div>
                    {step.kind === 'idle' && (
                      <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={/** Opens removing this passkey. */ () => open({ kind: 'passkeyRemove', id: passkey.id, name: passkey.name })}>
                        {t('removePasskey')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {step.kind === 'passkeyAdd' && (
              <PasswordStep id="mfa-passkey-password" help={t('passkeyAddHelp')} submitLabel={t('addPasskey')} busy={busy} onSubmit={/**
               * Adds the passkey.
               * @param password - The account password.
               */ (password) => void addPasskey(password)} onCancel={/** Closes the step. */ () => open({ kind: 'idle' })}>
                <Field className="max-w-72">
                  <FieldLabel htmlFor="mfa-passkey-name">{t('passkeyName')}</FieldLabel>
                  <Input id="mfa-passkey-name" maxLength={60} value={passkeyName} aria-describedby="mfa-passkey-name-help" onChange={/**
                   * Stores the typed name.
                   * @param event - The input change event.
                   */ (event) => setPasskeyName(event.target.value)} />
                  <FieldDescription id="mfa-passkey-name-help">{t('passkeyNameHelp')}</FieldDescription>
                </Field>
              </PasswordStep>
            )}
            {step.kind === 'passkeyRemove' && (
              <PasswordStep id="mfa-passkey-remove-password" help={t('removePasskeyHelp', { name: step.name })} submitLabel={t('removePasskey')} busy={busy} onSubmit={/**
               * Removes the passkey.
               * @param password - The account password.
               */ (password) => void run(/** Sends the request. */ () => api.removePasskey(step.id, password), t('passkeyRemoved'))} onCancel={/** Closes the step. */ () => open({ kind: 'idle' })} />
            )}
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex gap-3">
                <SmartphoneIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{t('appTitle')}</p>
                  <p className="text-sm text-muted-foreground">
                    {totpOn ? t('onSince', { date: formatDateTime(status.totpEnabledAt!, { dateStyle: 'medium' }) }) : t('appHelp')}
                  </p>
                </div>
              </div>
              {step.kind === 'idle' && (
                <Button type="button" size="sm" variant={totpOn ? 'outline' : 'default'} onClick={/** Opens setup or turning off. */ () => open({ kind: totpOn ? 'totpOff' : 'totpPassword' })}>
                  {totpOn ? t('turnOff') : t('setUp')}
                </Button>
              )}
            </div>
            {step.kind === 'totpPassword' && (
              <PasswordStep id="mfa-totp-password" submitLabel={t('continue')} busy={busy} onSubmit={/**
               * Starts the setup.
               * @param password - The account password.
               */ (password) => void startTotp(password)} onCancel={/** Closes the step. */ () => open({ kind: 'idle' })} />
            )}
            {step.kind === 'totpScan' && (
              <form className="grid gap-3" onSubmit={confirmTotp}>
                <p className="text-sm text-muted-foreground">{t('scanHelp')}</p>
                <div className="flex flex-wrap items-center gap-4">
                  <QrCode text={step.uri} label={t('qrLabel')} />
                  <div className="grid min-w-0 gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{t('secretLabel')}</span>
                    <code className="font-mono text-sm break-all">{step.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                    <Button type="button" variant="outline" size="sm" className="w-fit" onClick={/** Copies the key. */ () => void copyKey(step.secret)}>
                      {copiedKey ? <CheckIcon /> : <CopyIcon />} {copiedKey ? t('copied') : t('copyKey')}
                    </Button>
                  </div>
                </div>
                <CodeInput id="mfa-totp-code" label={t('appCode')} value={code} onChange={setCode} />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={busy || code.length !== 6}>{t('turnOn')}</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={/** Cancels the setup. */ () => open({ kind: 'idle' })}>{t('cancel')}</Button>
                </div>
              </form>
            )}
            {step.kind === 'totpOff' && (
              <PasswordStep
                id="mfa-totp-off-password"
                help={t('turnOffAppHelp')}
                submitLabel={t('turnOff')}
                busy={busy}
                canSubmit={useRecovery ? code.length >= 16 : code.length === 6}
                onSubmit={/**
                 * Turns the app off.
                 * @param password - The account password.
                 */ (password) => void run(/** Sends the request. */ () => api.disableTotp(password, useRecovery ? 'recovery' : 'totp', code), t('turnedOff'))}
                onCancel={/** Closes the step. */ () => open({ kind: 'idle' })}
              >
                {useRecovery ? (
                  <Field className="max-w-72">
                    <FieldLabel htmlFor="mfa-totp-off-recovery">{t('recoveryLabel')}</FieldLabel>
                    <Input id="mfa-totp-off-recovery" autoComplete="off" className="font-mono" required value={code} onChange={/**
                     * Stores the typed recovery code.
                     * @param event - The input change event.
                     */ (event) => setCode(event.target.value)} />
                  </Field>
                ) : (
                  <CodeInput id="mfa-totp-off-code" label={t('appCode')} value={code} onChange={setCode} />
                )}
                <Button type="button" variant="link" size="sm" className="justify-self-start px-0" onClick={/** Switches between app code and recovery code. */ () => {
                  setUseRecovery(!useRecovery);
                  setCode('');
                }}>
                  {useRecovery ? t('useAppCode') : t('useRecoveryCode')}
                </Button>
              </PasswordStep>
            )}
          </div>

          {(status.emailAllowed || emailOn) && (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex gap-3">
                  <MailIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{t('emailTitle')}</p>
                    <p className="text-sm text-muted-foreground">
                      {emailOn ? t('onSince', { date: formatDateTime(status.emailEnabledAt!, { dateStyle: 'medium' }) }) : t('emailHelp')}
                    </p>
                    {!emailOn && !status.emailVerified && <p className="text-sm text-muted-foreground">{t('emailNeedsConfirm')}</p>}
                  </div>
                </div>
                {step.kind === 'idle' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!emailOn && (!status.emailVerified || !status.emailAllowed)}
                    onClick={/** Opens turning on or off. */ () => open({ kind: emailOn ? 'emailOff' : 'emailOn' })}
                  >
                    {emailOn ? t('turnOff') : t('turnOn')}
                  </Button>
                )}
              </div>
              {step.kind === 'emailOn' && (
                <PasswordStep id="mfa-email-password" help={t('emailWeaker')} submitLabel={t('turnOn')} busy={busy} onSubmit={/**
                 * Turns e-mail codes on.
                 * @param password - The account password.
                 */ (password) => void run(/** Sends the request. */ () => api.enableEmail(password), t('turnedOn'))} onCancel={/** Closes the step. */ () => open({ kind: 'idle' })} />
              )}
              {step.kind === 'emailOff' && (
                <PasswordStep id="mfa-email-off-password" submitLabel={t('turnOff')} busy={busy} onSubmit={/**
                 * Turns e-mail codes off.
                 * @param password - The account password.
                 */ (password) => void run(/** Sends the request. */ () => api.disableEmail(password), t('turnedOff'))} onCancel={/** Closes the step. */ () => open({ kind: 'idle' })} />
              )}
            </div>
          )}

          {anyOn && (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex gap-3">
                  <KeyRoundIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{t('recoveryTitle')}</p>
                    <p className="text-sm text-muted-foreground">{t('recoveryHelp')}</p>
                    <p className={cn('text-sm', status.recoveryCodesLeft <= 2 ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                      {t('recoveryLeft', { count: status.recoveryCodesLeft })}
                    </p>
                  </div>
                </div>
                {step.kind === 'idle' && (
                  <Button type="button" size="sm" variant="outline" onClick={/** Opens creating new codes. */ () => open({ kind: 'newCodes' })}>
                    {t('newCodes')}
                  </Button>
                )}
              </div>
              {step.kind === 'newCodes' && (
                <PasswordStep id="mfa-codes-password" help={t('newCodesHelp')} submitLabel={t('newCodes')} busy={busy} onSubmit={/**
                 * Creates new codes.
                 * @param password - The account password.
                 */ (password) => void run(/** Sends the request. */ () => api.newRecoveryCodes(password))} onCancel={/** Closes the step. */ () => open({ kind: 'idle' })} />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The second step of signing in: a code from the authenticator app, by e-mail, or a recovery code.
 * @param props - The challenge from the first step, the app's two-factor API calls, and the callbacks.
 */
export function MfaChallengeForm<T>({
  challenge,
  api,
  onSignedIn,
  onCancel
}: {
  challenge: MfaChallenge;
  api: MfaApi;
  onSignedIn: (result: T) => Promise<void> | void;
  onCancel: () => void;
}) {
  const t = useT(messages);
  const [method, setMethod] = useState<MfaMethod>(challenge.methods[0] ?? 'recovery');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'verify' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [expired, setExpired] = useState(false);

  /**
   * Switches the method and clears the code.
   * @param next - The method to use.
   */
  function choose(next: MfaMethod) {
    setMethod(next);
    setCode('');
    setError(null);
  }

  /** Asks the server to send a code by e-mail. */
  async function sendEmail() {
    setBusy('send');
    setError(null);
    try {
      await api.sendLoginEmail(challenge.mfaToken);
      setEmailSent(true);
    } catch (reason) {
      setError(errorText(reason, t('failed')));
    } finally {
      setBusy(null);
    }
  }

  /** Checks the passkey as second factor; on success the app continues with the session. */
  async function verifyPasskey() {
    setBusy('verify');
    setError(null);
    try {
      const ceremony = await api.mfaPasskeyOptions(challenge.mfaToken);
      const response = await getPasskey(ceremony.options);
      await onSignedIn(await api.mfaPasskey<T>(challenge.mfaToken, ceremony.challengeId, response));
    } catch (reason) {
      setError(passkeyErrorText(reason, t));
      const errorCode = (reason as { code?: unknown } | null)?.code;
      if (errorCode === 'mfa_expired') setExpired(true);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Sends the code; on success the app continues with the session.
   * @param event - The form submission event.
   */
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('verify');
    setError(null);
    try {
      const result = await api.verifyLogin<T>(challenge.mfaToken, method, code.trim());
      await onSignedIn(result);
    } catch (reason) {
      setError(errorText(reason, t('failed')));
      setCode('');
      // Expired or too many wrong codes: only a new sign-in helps.
      const errorCode = (reason as { code?: unknown } | null)?.code;
      if (errorCode === 'mfa_expired' || errorCode === 'mfa_too_many_attempts') setExpired(true);
    } finally {
      setBusy(null);
    }
  }

  const intro = method === 'passkey' ? t('passkeyIntro')
    : method === 'totp' ? t('totpIntro')
    : method === 'email' ? (emailSent ? t('emailSent', { email: challenge.emailHint ?? '' }) : t('emailIntro', { email: challenge.emailHint ?? '' }))
    : t('recoveryIntro');
  const ready = method === 'recovery' ? code.replace(/[^a-z0-9]/gi, '').length === 16 : code.length === 6;

  return (
    <form className="grid gap-5" onSubmit={verify}>
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <ShieldCheckIcon className="size-7 text-primary" aria-hidden /> {t('challengeTitle')}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{intro}</p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!expired && (
        <>
          {method === 'passkey' ? (
            <Button type="button" disabled={busy !== null} onClick={/** Starts the passkey check. */ () => void verifyPasskey()}>
              <FingerprintIcon /> {busy === 'verify' ? t('signingInWithPasskey') : t('passkeyContinue')}
            </Button>
          ) : method === 'recovery' ? (
            <Field>
              <FieldLabel htmlFor="mfa-recovery">{t('recoveryLabel')}</FieldLabel>
              <Input id="mfa-recovery" autoComplete="off" autoFocus required className="font-mono" placeholder="xxxx-xxxx-xxxx-xxxx" value={code} onChange={/**
               * Stores the typed recovery code.
               * @param event - The input change event.
               */ (event) => setCode(event.target.value)} />
            </Field>
          ) : method === 'email' && !emailSent ? null : (
            <CodeInput id="mfa-code" label={t('codeLabel')} value={code} onChange={setCode} />
          )}
          {method === 'email' && (
            <Button type="button" variant="outline" className="justify-self-start" disabled={busy !== null} onClick={/** Sends a code by e-mail. */ () => void sendEmail()}>
              <MailIcon /> {busy === 'send' ? t('sending') : emailSent ? t('sendAgain') : t('sendCode')}
            </Button>
          )}
          {method !== 'passkey' && (method !== 'email' || emailSent) && (
            <Button type="submit" disabled={busy !== null || !ready}>
              {busy === 'verify' ? t('verifying') : t('verify')}
            </Button>
          )}
          <FieldDescription className="grid justify-items-start gap-1">
            {method !== 'passkey' && challenge.methods.includes('passkey') && (
              <Button type="button" variant="link" className="h-auto px-0" onClick={/** Uses a passkey. */ () => choose('passkey')}>{t('usePasskey')}</Button>
            )}
            {method !== 'totp' && challenge.methods.includes('totp') && (
              <Button type="button" variant="link" className="h-auto px-0" onClick={/** Uses the app. */ () => choose('totp')}>{t('useApp')}</Button>
            )}
            {method !== 'email' && challenge.methods.includes('email') && (
              <Button type="button" variant="link" className="h-auto px-0" onClick={/** Uses e-mail. */ () => choose('email')}>{t('useEmail')}</Button>
            )}
            {method !== 'recovery' && (
              <Button type="button" variant="link" className="h-auto px-0" onClick={/** Uses a recovery code. */ () => choose('recovery')}>{t('useRecovery')}</Button>
            )}
          </FieldDescription>
        </>
      )}
      <Button type="button" variant="link" className="h-auto justify-self-start px-0 text-muted-foreground" onClick={onCancel}>{t('back')}</Button>
    </form>
  );
}

/**
 * The page shown after sign-in when the administrator requires a second factor the account does not have yet.
 * @param props - The account name, the app's two-factor API calls, the callbacks for done and sign-out, the e-mail
 * confirmation (needed before codes by e-mail can be turned on), and whether the address is confirmed.
 */
export function MfaSetupRequired({
  username,
  api,
  onDone,
  onSignOut,
  emailConfirmation,
  emailVerified
}: {
  username: string;
  api: MfaApi;
  onDone: () => void;
  onSignOut: () => void;
  emailConfirmation?: ReactNode;
  emailVerified?: boolean;
}) {
  const t = useT(messages);
  const [active, setActive] = useState(false);
  return (
    <div className="grid gap-5">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('setupRequiredTitle')}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('setupRequiredText')}</p>
      </div>
      {!emailVerified && emailConfirmation}
      {/* Reloads the state after the address was confirmed, so codes by e-mail can be turned on. */}
      <TwoFactorSettings key={String(emailVerified)} username={username} api={api} showRequiredHint={false} onChange={/**
       * Remembers whether a second factor is set up now.
       * @param status - The new state.
       */ (status) => setActive(status.active)} />
      <div className="flex gap-2">
        <Button type="button" disabled={!active} onClick={onDone}>{t('continueToApp')}</Button>
        <Button type="button" variant="ghost" onClick={onSignOut}>{t('signOut')}</Button>
      </div>
    </div>
  );
}

/**
 * "Sign in with a passkey" for the sign-in page; shown only where the browser offers passkeys.
 * @param props - The app's two-factor API calls, the callback with the finished sign-in, and the error callback.
 */
export function PasskeySignIn<T>({ api, onSignedIn, onError }: { api: MfaApi; onSignedIn: (result: T) => Promise<void> | void; onError: (message: string) => void }) {
  const t = useT(messages);
  const [busy, setBusy] = useState(false);
  if (passkeyBlocker()) return null;

  /** Runs the passkey sign-in. */
  async function signIn() {
    setBusy(true);
    try {
      const ceremony = await api.loginPasskeyOptions();
      const response = await getPasskey(ceremony.options);
      await onSignedIn(await api.loginPasskey<T>(ceremony.challengeId, response));
    } catch (reason) {
      onError(passkeyErrorText(reason, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="outline" disabled={busy} onClick={/** Starts the passkey sign-in. */ () => void signIn()}>
      <FingerprintIcon /> {busy ? t('signingInWithPasskey') : t('signInWithPasskey')}
    </Button>
  );
}
