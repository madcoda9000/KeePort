import { useEffect, useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel, FieldSet, FieldLegend } from '@/components/ui/field';
import { api, type MfaSettings } from '@/lib/api';
import messages from '@/i18n/mfa-settings';
import { translate } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';

/**
 * One checkbox with its label.
 * @param props - The checkbox ID, label, state, whether it is disabled, and the change handler.
 */
function Switch({ id, label, checked, disabled, onChange }: { id: string; label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Field orientation="horizontal">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={/**
       * Passes on the new state.
       * @param value - The checkbox state.
       */ (value) => onChange(value === true)} />
      <FieldLabel htmlFor={id} className="font-normal">{label}</FieldLabel>
    </Field>
  );
}

/** Loads and edits the two-factor rules: who must use a second factor and who may use codes by e-mail. */
export function MfaSettingsPanel() {
  const t = useT(messages);
  const [draft, setDraft] = useState<MfaSettings | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  /** Loads the rules on mount and on retry, aborting obsolete requests. */
  useEffect(() => {
    const controller = new AbortController();
    void api.getMfaSettings(controller.signal).then(
      /**
       * Shows the loaded rules.
       * @param settings - The stored rules.
       */
      (settings) => {
        if (!controller.signal.aborted) setDraft(settings);
      },
      /**
       * Reports a loading error unless the request was aborted.
       * @param error - The caught error.
       */
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setMessage({ text: error instanceof Error ? error.message : translate(messages, 'loadFailed'), error: true });
        }
      }
    );
    return /** Aborts the pending load. */ () => controller.abort();
  }, [loadAttempt]);

  /**
   * Saves the rules.
   * @param event - The form submission event.
   */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      setDraft(await api.updateMfaSettings(draft));
      setMessage({ text: t('saved'), error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : t('saveFailed'), error: true });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Changes one rule in the draft.
   * @param key - The rule.
   * @param value - The new value.
   */
  function set(key: keyof MfaSettings, value: boolean) {
    if (draft) setDraft({ ...draft, [key]: value });
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
            <FieldSet>
              <FieldLegend variant="label">{t('requireTitle')}</FieldLegend>
              <Switch id="mfa-require-admins" label={t('requireAdmins')} checked={draft.requireForAdmins} disabled={saving} onChange={/**
               * Sets the rule for administrators.
               * @param value - The new value.
               */ (value) => set('requireForAdmins', value)} />
              <Switch id="mfa-require-users" label={t('requireUsers')} checked={draft.requireForUsers} disabled={saving} onChange={/**
               * Sets the rule for users.
               * @param value - The new value.
               */ (value) => set('requireForUsers', value)} />
              <FieldDescription>{t('requireHelp')}</FieldDescription>
            </FieldSet>
            <FieldSet>
              <FieldLegend variant="label">{t('emailTitle')}</FieldLegend>
              <Switch id="mfa-email-admins" label={t('emailAdmins')} checked={draft.emailForAdmins} disabled={saving} onChange={/**
               * Sets whether administrators may use e-mail codes.
               * @param value - The new value.
               */ (value) => set('emailForAdmins', value)} />
              <Switch id="mfa-email-users" label={t('emailUsers')} checked={draft.emailForUsers} disabled={saving} onChange={/**
               * Sets whether users may use e-mail codes.
               * @param value - The new value.
               */ (value) => set('emailForUsers', value)} />
              <FieldDescription>{t('emailHelp')}</FieldDescription>
            </FieldSet>
            <Button type="submit" className="w-fit" disabled={saving}>{saving ? t('saving') : t('save')}</Button>
          </form>
        ) : message ? (
          <Button type="button" variant="outline" className="w-fit" onClick={/** Clears the error and loads again. */ () => {
            setMessage(null);
            /**
             * Advances the retry counter.
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
