import { useState, type FormEvent } from 'react';
import { MailCheckIcon, MailWarningIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ACCENTS } from '@shared/accent';
import messages from '@shared/i18n/messages/email-account';
import { useT } from '@shared/i18n/react';

/**
 * Shows whether the account's e-mail address is confirmed and, if not, lets the user request a code and enter it.
 * @param props - The address, whether it is confirmed, and the API calls that send and check the code.
 */
export function EmailConfirmation({
  email,
  verified,
  onRequestCode,
  onVerify
}: {
  email: string | null;
  verified: boolean;
  onRequestCode: () => Promise<void>;
  onVerify: (code: string) => Promise<void>;
}) {
  const t = useT(messages);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!email) return null;
  if (verified) {
    return (
      <Badge variant="outline" className={cn('w-fit gap-1', ACCENTS.emerald.badge)}>
        <MailCheckIcon /> {t('confirmed')}
      </Badge>
    );
  }

  /** Asks the server to send a new code. */
  async function send() {
    setBusy('send');
    setError(null);
    try {
      await onRequestCode();
      setSent(true);
      setCode('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('failed'));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Checks the entered code.
   * @param event - The form submission event.
   */
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('verify');
    setError(null);
    try {
      await onVerify(code.trim());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3">
      <Badge variant="outline" className={cn('w-fit gap-1', ACCENTS.amber.badge)}>
        <MailWarningIcon /> {t('notConfirmed')}
      </Badge>
      <p className="text-sm text-muted-foreground">{sent ? t('codeSent', { email }) : t('confirmHelp')}</p>
      {sent && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={verify}>
          <Field className="w-40">
            <FieldLabel htmlFor="email-code">{t('codeLabel')}</FieldLabel>
            <Input
              id="email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={/**
               * Keeps only digits of the typed code.
               * @param event - The input change event.
               */ (event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Button type="submit" size="sm" disabled={busy !== null || code.length !== 6}>
            {busy === 'verify' ? t('confirming') : t('confirm')}
          </Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="button" variant="outline" size="sm" className="w-fit" disabled={busy !== null} onClick={/** Sends a code. */ () => void send()}>
        {busy === 'send' ? t('sending') : sent ? t('sendAgain') : t('sendCode')}
      </Button>
    </div>
  );
}

/**
 * Lets the user choose which security notifications they get by e-mail; saves on every change.
 * @param props - The current choices, whether the app password option is shown, whether the address is confirmed, and the save call.
 */
export function EmailNotifications({
  signIn,
  appPassword,
  showAppPassword,
  verified,
  onSave
}: {
  signIn: boolean;
  appPassword: boolean;
  showAppPassword: boolean;
  verified: boolean;
  onSave: (signIn: boolean, appPassword: boolean) => Promise<void>;
}) {
  const t = useT(messages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Saves new choices.
   * @param nextSignIn - Notify about new browsers.
   * @param nextAppPassword - Notify about new app passwords.
   */
  async function save(nextSignIn: boolean, nextAppPassword: boolean) {
    setBusy(true);
    setError(null);
    try {
      await onSave(nextSignIn, nextAppPassword);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t('notificationsTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('notificationsHelp')}</p>
      </div>
      <Field orientation="horizontal">
        <Checkbox
          id="notify-sign-in"
          checked={signIn}
          disabled={busy || !verified}
          aria-describedby="notify-sign-in-help"
          onCheckedChange={/**
           * Saves the sign-in choice.
           * @param checked - The new state.
           */ (checked) => void save(checked === true, appPassword)}
        />
        <div className="grid gap-1">
          <FieldLabel htmlFor="notify-sign-in" className="font-normal">{t('notifySignIn')}</FieldLabel>
          <FieldDescription id="notify-sign-in-help">{t('notifySignInHelp')}</FieldDescription>
        </div>
      </Field>
      {showAppPassword && (
        <Field orientation="horizontal">
          <Checkbox
            id="notify-app-password"
            checked={appPassword}
            disabled={busy || !verified}
            aria-describedby="notify-app-password-help"
            onCheckedChange={/**
             * Saves the app password choice.
             * @param checked - The new state.
             */ (checked) => void save(signIn, checked === true)}
          />
          <div className="grid gap-1">
            <FieldLabel htmlFor="notify-app-password" className="font-normal">{t('notifyAppPassword')}</FieldLabel>
            <FieldDescription id="notify-app-password-help">{t('notifyAppPasswordHelp')}</FieldDescription>
          </div>
        </Field>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
