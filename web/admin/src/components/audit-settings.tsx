import { useEffect, useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import messages from '@/i18n/audit-settings';
import { formatNumber, translate } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';

/** Loads and edits how long the audit log keeps its entries. */
export function AuditSettingsPanel() {
  const [days, setDays] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const t = useT(messages);

  /** Loads the current retention on mount, aborting an obsolete request. */
  useEffect(() => {
    const controller = new AbortController();
    void api.getAuditSettings(controller.signal).then(
      /**
       * Shows the stored retention.
       * @param settings - The audit settings returned by the Admin API.
       */
      (settings) => {
        if (!controller.signal.aborted) setDays(String(settings.retentionDays));
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
    return /** Aborts the pending request when the effect is cleaned up. */ () => controller.abort();
  }, []);

  /**
   * Validates and saves the retention.
   * @param event - The form submission event.
   */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (days === null || saving) return;
    const value = Number(days);
    if (!Number.isInteger(value) || value < 1 || value > 3650) {
      setMessage({ text: t('invalidDays'), error: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const settings = await api.updateAuditSettings(value);
      setDays(String(settings.retentionDays));
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
        <CardDescription>{t('description', { max: formatNumber(50_000) })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {message && (
          <Alert variant={message.error ? 'destructive' : 'default'}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
        {days === null ? (
          !message && <p role="status" className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : (
          <form className="grid gap-5" onSubmit={save}>
            <Field>
              <FieldLabel htmlFor="audit-retention">{t('retention')}</FieldLabel>
              <Input
                id="audit-retention"
                aria-describedby="audit-retention-help"
                type="number"
                min={1}
                max={3650}
                step={1}
                required
                disabled={saving}
                value={days}
                onChange={/**
                 * Updates the draft retention.
                 * @param event - The input change event.
                 */ (event) => setDays(event.target.value)}
              />
              <FieldDescription id="audit-retention-help">{t('retentionHelp')}</FieldDescription>
            </Field>
            <Button type="submit" className="w-fit" disabled={saving}>{saving ? t('saving') : t('save')}</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
