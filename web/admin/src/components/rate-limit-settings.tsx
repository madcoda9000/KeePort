import { useEffect, useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import messages from '@/i18n/rate-limit-settings';
import { translate } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';

const MAX_LIMIT = 2_147_483_647;

/** Loads and edits server-wide request limits from the Admin settings page. */
export function RateLimitSettingsPanel() {
  const [draft, setDraft] = useState<{ auth: string; webDav: string } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const t = useT(messages);

  /** Loads the active limits on mount and on retry, aborting obsolete requests. */
  useEffect(() => {
    const controller = new AbortController();
    void api.getRateLimits(controller.signal).then(
      /**
       * Initializes both editable limits from the current settings.
       * @param settings - The persisted rate limits returned by the fetch.
       */
      (settings) => {
        if (!controller.signal.aborted) {
          setDraft({ auth: String(settings.authPerMinute), webDav: String(settings.webDavPerMinute) });
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
   * Validates and saves both limits, preserving the form if saving fails.
   * @param event - The submission event from the rate-limit settings form.
   */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    const authPerMinute = Number(draft.auth);
    const webDavPerMinute = Number(draft.webDav);
    if (!Number.isInteger(authPerMinute) || authPerMinute < 1 || authPerMinute > MAX_LIMIT ||
        !Number.isInteger(webDavPerMinute) || webDavPerMinute < 1 || webDavPerMinute > MAX_LIMIT) {
      setMessage({ text: t('invalid'), error: true });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const settings = await api.updateRateLimits({ authPerMinute, webDavPerMinute });
      setDraft({ auth: String(settings.authPerMinute), webDav: String(settings.webDavPerMinute) });
      setMessage({ text: t('saved'), error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : t('saveFailed'), error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {message && (
          <Alert variant={message.error ? 'destructive' : 'default'}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
        {draft ? (
          <form className="grid gap-5" onSubmit={save}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="auth-per-minute">{t('auth')}</FieldLabel>
                <Input
                  id="auth-per-minute"
                  aria-describedby="auth-limit-help"
                  type="number"
                  min={1}
                  max={MAX_LIMIT}
                  step={1}
                  required
                  disabled={saving}
                  value={draft.auth}
                  onChange={/**
                   * Updates the draft login and setup limit.
                   * @param event - The authentication limit input change event.
                   */ (event) => setDraft({ ...draft, auth: event.target.value })}
                />
                <FieldDescription id="auth-limit-help">{t('authHelp')}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="webdav-per-minute">WebDAV</FieldLabel>
                <Input
                  id="webdav-per-minute"
                  aria-describedby="webdav-limit-help"
                  type="number"
                  min={1}
                  max={MAX_LIMIT}
                  step={1}
                  required
                  disabled={saving}
                  value={draft.webDav}
                  onChange={/**
                   * Updates the draft WebDAV limit.
                   * @param event - The WebDAV limit input change event.
                   */ (event) => setDraft({ ...draft, webDav: event.target.value })}
                />
                <FieldDescription id="webdav-limit-help">{t('webDavHelp')}</FieldDescription>
              </Field>
            </FieldGroup>
            <Button type="submit" className="w-fit" disabled={saving}>{saving ? t('saving') : t('save')}</Button>
          </form>
        ) : message ? (
          <Button type="button" variant="outline" className="w-fit" onClick={/** Clears the error and retries loading the saved limits. */ () => {
            setMessage(null);
            /**
             * Advances the retry counter to trigger a fresh load.
             * @param attempt - The current attempt counter for loading the saved limits.
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
