import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type PasswordLinkInfo } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import messages from '@/i18n/password-link';
import { useT } from '@shared/i18n/react';

/** Where the link check stands: still loading, usable, invalid (404) or failed for another reason. */
type LinkState =
  | { status: 'loading' }
  | { status: 'ready'; info: PasswordLinkInfo }
  | { status: 'invalid'; purpose: PasswordLinkInfo['purpose'] | null }
  | { status: 'failed'; message: string };

/**
 * Sets the account password with an invitation or reset link: checks the link, then asks for the new password twice.
 * Render it with the token as key, so a new link starts a new check.
 * @param props - The token from the link, and what to do after success, on "Go to sign-in" and on "Forgot password?".
 */
export function PasswordLink({
  token,
  onDone,
  onCancel,
  onForgot
}: {
  token: string;
  onDone: (username: string) => void;
  onCancel: () => void;
  onForgot: () => void;
}) {
  const t = useT(messages);
  const [state, setState] = useState<LinkState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Checks the link once when the page appears. */
  useEffect(() => {
    const controller = new AbortController();
    void api.checkPasswordLink(token, controller.signal).then(
      /**
       * Shows the password form for the link's account.
       * @param info - What the link is for and the account's username.
       */
      (info) => {
        if (!controller.signal.aborted) setState({ status: 'ready', info });
      },
      /**
       * Shows why the link cannot be used, unless the request was aborted.
       * @param reason - The caught error to inspect.
       */
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.status === 404) setState({ status: 'invalid', purpose: null });
        else setState({ status: 'failed', message: reason instanceof Error && reason.message ? reason.message : '' });
      }
    );
    return /** Aborts the pending check when the page goes away. */ () => controller.abort();
  }, [token]);

  /**
   * Checks that both passwords match and sets the new password.
   * @param event - The form submission event.
   */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== 'ready') return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get('newPassword') ?? '');
    if (password !== String(data.get('confirmPassword') ?? '')) {
      setError(t('passwordsDiffer'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setPasswordWithLink(token, password);
      onDone(state.info.username);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) setState({ status: 'invalid', purpose: state.info.purpose });
      else setError(reason instanceof Error && reason.message ? reason.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') {
    return <p role="status" className="text-sm text-muted-foreground">{t('checking')}</p>;
  }

  if (state.status !== 'ready') {
    // An invalid link may have been a reset link that expired; offering a new one costs nothing and reveals nothing.
    const offerReset = state.status === 'invalid' && state.purpose !== 'invite';
    return (
      <div className="grid gap-5">
        <Alert variant="destructive">
          <AlertTitle>{t('invalidTitle')}</AlertTitle>
          <AlertDescription>
            {state.status === 'invalid' ? t('invalid') : state.message || t('checkFailed')}
            {offerReset && <p>{t('invalidReset')}</p>}
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onCancel}>{t('toSignIn')}</Button>
          {offerReset && (
            <Button type="button" variant="outline" onClick={onForgot}>{t('forgotPassword')}</Button>
          )}
        </div>
      </div>
    );
  }

  const invite = state.info.purpose === 'invite';
  return (
    <form className="grid gap-5" onSubmit={submit}>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{invite ? t('inviteTitle') : t('resetTitle')}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t.rich(invite ? 'inviteIntro' : 'resetIntro', { username: <span className="font-medium text-foreground">{state.info.username}</span> })}
        </p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {/* Lets password managers save the new password for the right account. */}
      <input type="text" name="username" autoComplete="username" value={state.info.username} readOnly hidden />
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="link-new-password">{t('newPassword')}</FieldLabel>
          <Input
            id="link-new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            autoFocus
            aria-describedby="link-password-hint"
          />
          <FieldDescription id="link-password-hint">{t('passwordHint')}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="link-confirm-password">{t('confirmPassword')}</FieldLabel>
          <Input id="link-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={busy}>
        {busy ? t('saving') : t('save')}
      </Button>
      <Button type="button" variant="link" className="justify-self-start px-0" onClick={onCancel}>
        {t('toSignIn')}
      </Button>
    </form>
  );
}
