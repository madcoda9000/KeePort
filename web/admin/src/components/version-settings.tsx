import { useEffect, useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import messages from '@/i18n/vault-versions';
import { translate } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';
import { formatSize } from '@/lib/format-size';

/** Loads and edits how many earlier versions of each vault are kept, and shows the space they use. */
export function VersionSettingsPanel() {
  const t = useT(messages);
  const [draft, setDraft] = useState<{ count: string; days: string } | null>(null);
  const [usedBytes, setUsedBytes] = useState(0);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  /** Loads the current limits on mount, aborting an obsolete request. */
  useEffect(() => {
    const controller = new AbortController();
    void api.getVersionSettings(controller.signal).then(
      /**
       * Shows the stored limits.
       * @param settings - The version settings returned by the Admin API.
       */
      (settings) => {
        if (controller.signal.aborted) return;
        setDraft({ count: String(settings.maxCount), days: String(settings.maxDays) });
        setUsedBytes(settings.usedBytes);
      },
      /**
       * Reports a loading error unless the request was aborted.
       * @param error - The caught error to inspect.
       */
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setMessage({ text: error instanceof Error ? error.message : translate(messages, 'settingsLoadFailed'), error: true });
        }
      }
    );
    return /** Aborts the pending request when the effect is cleaned up. */ () => controller.abort();
  }, []);

  /**
   * Validates and saves the limits.
   * @param event - The form submission event.
   */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    const maxCount = Number(draft.count);
    const maxDays = Number(draft.days);
    if (!Number.isInteger(maxCount) || maxCount < 0 || maxCount > 1000 || !Number.isInteger(maxDays) || maxDays < 0 || maxDays > 3650) {
      setMessage({ text: t('settingsInvalid'), error: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const settings = await api.updateVersionSettings({ maxCount, maxDays });
      setDraft({ count: String(settings.maxCount), days: String(settings.maxDays) });
      setUsedBytes(settings.usedBytes);
      setMessage({ text: t('settingsSaved'), error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : t('settingsSaveFailed'), error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>{t('settingsTitle')}</CardTitle>
        <CardDescription>{t('settingsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {message && (
          <Alert variant={message.error ? 'destructive' : 'default'}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
        {draft === null ? (
          !message && <p role="status" className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : (
          <form className="grid gap-5" onSubmit={save}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="version-count">{t('maxCount')}</FieldLabel>
                <Input
                  id="version-count"
                  aria-describedby="version-count-help"
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  required
                  disabled={saving}
                  value={draft.count}
                  onChange={/**
                   * Updates the draft count.
                   * @param event - The input change event.
                   */ (event) => setDraft({ ...draft, count: event.target.value })}
                />
                <FieldDescription id="version-count-help">{t('maxCountHelp')}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="version-days">{t('maxDays')}</FieldLabel>
                <Input
                  id="version-days"
                  aria-describedby="version-days-help"
                  type="number"
                  min={0}
                  max={3650}
                  step={1}
                  required
                  disabled={saving}
                  value={draft.days}
                  onChange={/**
                   * Updates the draft age limit.
                   * @param event - The input change event.
                   */ (event) => setDraft({ ...draft, days: event.target.value })}
                />
                <FieldDescription id="version-days-help">{t('maxDaysHelp')}</FieldDescription>
              </Field>
            </FieldGroup>
            <p className="text-sm text-muted-foreground">{t('usedSpace', { size: formatSize(usedBytes) })}</p>
            <Button type="submit" className="w-fit" disabled={saving}>{saving ? t('saving') : t('save')}</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
