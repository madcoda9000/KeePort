import { useEffect, useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

const MAX_LIMIT = 2_147_483_647;

/** Loads and edits server-wide request limits from the Admin settings page. */
export function RateLimitSettingsPanel() {
  const [draft, setDraft] = useState<{ auth: string; webDav: string } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void api.getRateLimits(controller.signal).then(
      (settings) => {
        if (!controller.signal.aborted) {
          setDraft({ auth: String(settings.authPerMinute), webDav: String(settings.webDavPerMinute) });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setMessage({ text: error instanceof Error ? error.message : 'Could not load rate limits.', error: true });
        }
      }
    );
    return () => controller.abort();
  }, [loadAttempt]);

  /** Validates and saves both limits, preserving the form if saving fails. */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    const authPerMinute = Number(draft.auth);
    const webDavPerMinute = Number(draft.webDav);
    if (!Number.isInteger(authPerMinute) || authPerMinute < 1 || authPerMinute > MAX_LIMIT ||
        !Number.isInteger(webDavPerMinute) || webDavPerMinute < 1 || webDavPerMinute > MAX_LIMIT) {
      setMessage({ text: 'Enter a positive whole number for each limit.', error: true });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const settings = await api.updateRateLimits({ authPerMinute, webDavPerMinute });
      setDraft({ auth: String(settings.authPerMinute), webDav: String(settings.webDavPerMinute) });
      setMessage({ text: 'Rate limits saved and applied.', error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Could not save rate limits.', error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>Rate limits</CardTitle>
        <CardDescription>Requests per minute per IP address. Changes take effect immediately.</CardDescription>
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
                <FieldLabel htmlFor="auth-per-minute">Sign-in and setup</FieldLabel>
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
                  onChange={(event) => setDraft({ ...draft, auth: event.target.value })}
                />
                <FieldDescription id="auth-limit-help">Shared by the Admin and Vault sign-in forms and first-run setup. Default: 10.</FieldDescription>
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
                  onChange={(event) => setDraft({ ...draft, webDav: event.target.value })}
                />
                <FieldDescription id="webdav-limit-help">Applies to all WebDAV requests, including failed authentication attempts. Default: 60.</FieldDescription>
              </Field>
            </FieldGroup>
            <Button type="submit" className="w-fit" disabled={saving}>{saving ? 'Saving…' : 'Save rate limits'}</Button>
          </form>
        ) : message ? (
          <Button type="button" variant="outline" className="w-fit" onClick={() => {
            setMessage(null);
            setLoadAttempt((attempt) => attempt + 1);
          }}>
            Retry
          </Button>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">Loading rate limits…</p>
        )}
      </CardContent>
    </Card>
  );
}
