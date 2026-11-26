import { useState, type FormEvent } from 'react';
import { InfoIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import messages from '@/i18n/forgot-password';
import { useT } from '@shared/i18n/react';

/**
 * Asks for a password reset link by username or e-mail address. The answer is the same whether or not an account
 * matches, so the form never reveals which accounts exist.
 * @param props - The value to start with (e.g. the username typed into the sign-in form) and the way back to sign-in.
 */
export function ForgotPassword({ initialIdentifier, onBack }: { initialIdentifier: string; onBack: () => void }) {
  const t = useT(messages);
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Sends the request and shows the neutral notice.
   * @param event - The form submission event.
   */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestPasswordReset(identifier.trim());
      setSent(true);
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('intro')}</p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {sent ? (
        <Alert role="status" className="border-primary/25 bg-accent text-accent-foreground">
          <InfoIcon />
          <AlertDescription>{t('sent')}</AlertDescription>
        </Alert>
      ) : (
        <>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="reset-identifier">{t('identifier')}</FieldLabel>
              <Input
                id="reset-identifier"
                name="identifier"
                autoComplete="username"
                maxLength={254}
                required
                autoFocus
                value={identifier}
                aria-describedby="reset-identifier-help"
                onChange={/**
                 * Keeps the typed username or address.
                 * @param event - The input change event.
                 */ (event) => setIdentifier(event.target.value)}
              />
              <FieldDescription id="reset-identifier-help">{t('identifierHelp')}</FieldDescription>
            </Field>
          </FieldGroup>
          <Button type="submit" disabled={busy || !identifier.trim()}>
            {busy ? t('sending') : t('send')}
          </Button>
        </>
      )}
      <Button type="button" variant="link" className="justify-self-start px-0" onClick={onBack}>
        {t('back')}
      </Button>
    </form>
  );
}
