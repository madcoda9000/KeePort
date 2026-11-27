import { useEffect, useState, type FormEvent } from 'react';
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, KeyRoundIcon, LockKeyholeOpenIcon, MoonIcon, ShieldCheckIcon, SunIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import messages from '@/i18n/share-page';
import { ApiError, shareApi, type ShareMeta } from '@/lib/api';
import { openShare, readShareLocation, type SharedField, type SharePayload } from '@/lib/share-crypto';
import { argon2Kdf } from '@/lib/share-kdf';
import { getTheme, toggleTheme } from '@/theme';
import { formatDateTime } from '@shared/i18n/core';
import { LanguageMenu } from '@shared/i18n/language-select';
import { useT } from '@shared/i18n/react';
import { hasBrowserCrypto } from '@shared/secure-context';

/** The project page linked in the footer. */
const PROJECT_URL = 'https://github.com/madcoda9000/KeePort';

/** What the page shows: loading, an end state, the form before revealing, or the revealed secret. */
type View =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'incomplete' }
  | { kind: 'ready'; meta: ShareMeta }
  | { kind: 'revealed'; payload: SharePayload; viewsLeft: number };

/** The page that opens a shared secret for a recipient without a KeePort account. */
export function ShareApp() {
  const t = useT(messages);
  const [location] = useState(/** Reads ID and key from the address once. */ () => readShareLocation(window.location.pathname, window.location.hash));
  const [view, setView] = useState<View>(location?.key ? { kind: 'loading' } : { kind: 'incomplete' });
  const [theme, setTheme] = useState(getTheme);

  /** Loads what the page shows before revealing; this does not count a view. */
  useEffect(() => {
    if (!location?.key) return;
    let cancelled = false;
    shareApi.meta(location.id).then(/**
     * Shows the form.
     * @param meta - The share's public details.
     */ (meta) => {
      if (!cancelled) setView({ kind: 'ready', meta });
    }, /** Shows that the share is gone. */ () => {
      if (!cancelled) setView({ kind: 'unavailable' });
    });
    return /** Ignores a late answer. */ () => {
      cancelled = true;
    };
  }, [location]);

  /** Sets the page title in the current language. */
  useEffect(() => {
    document.title = `${t('pageTitle')} · KeePort`;
  }, [t]);

  return (
    <main className="relative grid min-h-svh place-items-center bg-muted/35 px-4 py-16 sm:px-8">
      <div className="absolute end-4 top-4 flex items-center gap-2 sm:end-6 sm:top-6">
        <LanguageMenu />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={theme === 'dark' ? t('switchToLight') : t('switchToDark')}
          onClick={/** Switches the colour theme. */ () => setTheme(toggleTheme())}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </Button>
      </div>
      <div className="grid w-full max-w-xl gap-4">
        <div className="flex items-center gap-2.5 text-sm font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-brand-gradient text-white shadow-sm">
            <KeyRoundIcon className="size-4" />
          </span>
          KeePort <span className="font-normal text-muted-foreground">/ {t('pageTitle')}</span>
        </div>
        <Card>
          {view.kind === 'loading' && (
            <CardContent className="py-10 text-center text-sm text-muted-foreground">{t('loading')}</CardContent>
          )}
          {view.kind === 'unavailable' && <EndState title={t('unavailableTitle')} text={t('unavailable')} />}
          {view.kind === 'incomplete' && <EndState title={t('incompleteTitle')} text={t('incomplete')} />}
          {view.kind === 'ready' && location && (
            <RevealForm
              id={location.id}
              linkKey={location.key}
              meta={view.meta}
              onRevealed={/**
               * Shows the secret.
               * @param payload - The decrypted content.
               * @param viewsLeft - How often it can still be opened.
               */ (payload, viewsLeft) => setView({ kind: 'revealed', payload, viewsLeft })}
              onUnavailable={/** Shows that the share is gone. */ () => setView({ kind: 'unavailable' })}
            />
          )}
          {view.kind === 'revealed' && <Revealed payload={view.payload} viewsLeft={view.viewsLeft} />}
        </Card>
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheckIcon className="size-3.5" />
          <span>
            {t.rich('footer', {
              link: (
                <a
                  href={PROJECT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t('projectLink')}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  KeePort
                </a>
              )
            })}
          </span>
        </p>
      </div>
    </main>
  );
}

/**
 * A neutral end state, for example an expired share.
 * @param props - The title and the explanation.
 */
function EndState({ title, text }: { title: string; text: string }) {
  return (
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{text}</CardDescription>
    </CardHeader>
  );
}

/**
 * The form before revealing: optional e-mail code and password, then the button that counts the view.
 * @param props - The share's ID, the key from the link, the public details and what happens afterwards.
 */
function RevealForm({
  id,
  linkKey,
  meta,
  onRevealed,
  onUnavailable
}: {
  id: string;
  linkKey: string;
  meta: ShareMeta;
  onRevealed: (payload: SharePayload, viewsLeft: number) => void;
  onUnavailable: () => void;
}) {
  const t = useT(messages);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeState, setCodeState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secure = hasBrowserCrypto();

  /** Asks KeePort to e-mail a code to the recipient. */
  async function sendCode() {
    setCodeState('sending');
    setError(null);
    try {
      await shareApi.requestCode(id);
      setCodeState('sent');
    } catch (failure) {
      setCodeState('idle');
      if (failure instanceof ApiError && failure.status === 404) onUnavailable();
      else setError(failure instanceof Error ? failure.message : t('failed'));
    }
  }

  /**
   * Derives the proof, fetches the ciphertext (one view) and decrypts it in this browser.
   * @param event - The form submission.
   */
  async function reveal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const opened = await openShare(linkKey, meta.kdfSalt, meta.kdfParams, password, argon2Kdf);
      const result = await shareApi.reveal(id, opened.proof, meta.requiresEmailCode ? code.trim() : null);
      try {
        onRevealed(await opened.decrypt(result.ciphertext, result.iv), result.viewsLeft);
      } catch {
        setError(t('decryptFailed'));
      }
    } catch (failure) {
      if (failure instanceof ApiError) {
        if (failure.status === 404) return onUnavailable();
        if (failure.code === 'wrong_password') return setError(t('wrongPassword'));
        if (failure.code === 'wrong_code') return setError(t('wrongCode'));
        if (failure.code === 'code_required') return setError(t('codeRequired'));
        if (failure.code === 'wrong_link') return setError(t('decryptFailed'));
      }
      setError(failure instanceof ApiError && failure.message ? failure.message : t('decryptFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <CardHeader>
        <CardTitle>{t('sharedBy', { sender: meta.senderName })}</CardTitle>
        <CardDescription>
          {t('intro')} {t('validUntil', { date: formatDateTime(meta.expiresAt) })} {t('viewsLeft', { count: meta.viewsLeft })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={reveal}>
          {!secure && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertDescription>{t('noCrypto')}</AlertDescription>
            </Alert>
          )}
          <FieldGroup className="gap-4">
            {meta.requiresEmailCode && (
              <Field>
                <FieldLabel htmlFor="share-code">{t('codeTitle')}</FieldLabel>
                <FieldDescription>{t('codeHelp', { email: meta.emailHint ?? '' })}</FieldDescription>
                <div className="flex gap-2">
                  <Input
                    id="share-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={t('code')}
                    aria-label={t('code')}
                    maxLength={6}
                    value={code}
                    disabled={busy}
                    onChange={/**
                     * Updates the code.
                     * @param event - The change event.
                     */ (event) => setCode(event.target.value.replace(/\D/g, ''))}
                  />
                  <Button type="button" variant="outline" disabled={busy || codeState === 'sending'} onClick={/** Sends a code. */ () => void sendCode()}>
                    {codeState === 'sending' ? t('sendingCode') : t('sendCode')}
                  </Button>
                </div>
                {codeState === 'sent' && <FieldDescription>{t('codeSent')}</FieldDescription>}
              </Field>
            )}
            {meta.hasPassword && (
              <Field>
                <FieldLabel htmlFor="share-password">{t('password')}</FieldLabel>
                <Input
                  id="share-password"
                  type="password"
                  autoComplete="off"
                  value={password}
                  disabled={busy}
                  onChange={/**
                   * Updates the password.
                   * @param event - The change event.
                   */ (event) => setPassword(event.target.value)}
                />
                <FieldDescription>{t('passwordHelp', { sender: meta.senderName })}</FieldDescription>
              </Field>
            )}
          </FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <p className="text-sm text-muted-foreground">{t('revealHint')}</p>
          <Button
            type="submit"
            className="justify-self-start"
            disabled={busy || !secure || (meta.hasPassword && !password) || (meta.requiresEmailCode && code.length !== 6)}
          >
            <LockKeyholeOpenIcon /> {busy ? t('revealing') : t('reveal')}
          </Button>
        </form>
      </CardContent>
    </>
  );
}

/**
 * The revealed secret with copy buttons; protected values stay hidden until shown.
 * @param props - The decrypted content and how often it can still be opened.
 */
function Revealed({ payload, viewsLeft }: { payload: SharePayload; viewsLeft: number }) {
  const t = useT(messages);
  return (
    <>
      <CardHeader>
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>{viewsLeft > 0 ? t('remaining', { count: viewsLeft }) : t('deleted')}</AlertTitle>
        </Alert>
      </CardHeader>
      <CardContent className="grid gap-4">
        {payload.message && (
          <>
            <div className="grid gap-1">
              <span className="text-sm font-medium">{t('message')}</span>
              <p className="text-sm whitespace-pre-wrap">{payload.message}</p>
            </div>
            <Separator />
          </>
        )}
        {payload.fields.map(/**
         * Shows one field.
         * @param field - The field.
         * @param index - Its position, as key.
         */ (field, index) => <SharedValue key={index} field={field} />)}
      </CardContent>
    </>
  );
}

/**
 * One shared value with its label, a show button for protected values and a copy button.
 * @param props - The field.
 */
function SharedValue({ field }: { field: SharedField }) {
  const t = useT(messages);
  const [visible, setVisible] = useState(!field.protected);
  const [copied, setCopied] = useState(false);
  const label = field.kind === 'custom' ? field.name : t(`field_${field.kind}`);

  /** Copies the value and shows a check mark for a moment. */
  async function copy() {
    try {
      await navigator.clipboard.writeText(field.value);
      setCopied(true);
      window.setTimeout(/** Shows the copy icon again. */ () => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-start gap-2">
        <div className="min-h-9 min-w-0 flex-1 rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm break-all whitespace-pre-wrap" data-testid={`shared-${field.kind}`}>
          {visible ? field.value : '••••••••••••'}
        </div>
        {field.protected && (
          <Button type="button" variant="outline" size="icon" aria-label={visible ? t('hide') : t('show')} onClick={/** Shows or hides the value. */ () => setVisible(!visible)}>
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        )}
        <Button type="button" variant="outline" size="icon" aria-label={`${t('copy')}: ${label}`} title={copied ? t('copied') : t('copy')} onClick={/** Copies the value. */ () => void copy()}>
          {copied ? <CheckIcon className="text-emerald-600 dark:text-emerald-400" /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  );
}
