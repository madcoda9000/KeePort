import { useEffect, useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, type AdminShare, type AdminSharing, type ShareSettings } from '@/lib/api';
import messages from '@/i18n/sharing-settings';
import { cn } from '@/lib/utils';
import { ACCENTS } from '@shared/accent';
import { formatDateTime, translate } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';

/** The badge colour of each share status. */
const STATUS_BADGE: Record<AdminShare['status'], string> = {
  active: ACCENTS.emerald.badge,
  used: '',
  expired: '',
  revoked: '',
  locked: 'border-destructive/40 bg-destructive/10 text-destructive'
};

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

/**
 * The sharing settings: the rules, each user's and each vault's switch, and all shares with a revoke button.
 * Administrators see only metadata; they cannot read shared secrets.
 */
export function SharingSettingsPanel() {
  const t = useT(messages);
  const [data, setData] = useState<AdminSharing | null>(null);
  const [draft, setDraft] = useState<ShareSettings | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [revoking, setRevoking] = useState<AdminShare | null>(null);

  /** Loads everything on mount and on retry, aborting obsolete requests. */
  useEffect(() => {
    const controller = new AbortController();
    void api.getSharing(controller.signal).then(
      /**
       * Shows the loaded settings.
       * @param loaded - The settings, users, vaults and shares.
       */
      (loaded) => {
        if (controller.signal.aborted) return;
        setData(loaded);
        setDraft(loaded.settings);
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
   * Runs one change, shows the new state and reports the result.
   * @param change - The request that returns the new state.
   * @param success - The message after success.
   */
  async function apply(change: () => Promise<AdminSharing>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await change();
      setData(next);
      setDraft(next.settings);
      setMessage({ text: success, error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : t('changeFailed'), error: true });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Saves the rules.
   * @param event - The form submission event.
   */
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft) void apply(/** Stores the rules. */ () => api.updateShareSettings(draft), t('saved'));
  }

  /**
   * Changes one rule in the draft.
   * @param patch - The changed rules.
   */
  function set(patch: Partial<ShareSettings>) {
    if (draft) setDraft({ ...draft, ...patch });
  }

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {message && (
          <Alert variant={message.error ? 'destructive' : 'default'}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
        {data && draft ? (
          <>
            <form className="grid max-w-xl gap-5" onSubmit={save}>
              <Field>
                <FieldLabel htmlFor="sharing-mode">{t('mode')}</FieldLabel>
                <NativeSelect id="sharing-mode" value={draft.mode} disabled={busy} onChange={/**
                 * Sets who may share.
                 * @param event - The change event.
                 */ (event) => set({ mode: event.target.value as ShareSettings['mode'] })}>
                  {(['off', 'all', 'selected'] as const).map(/**
                   * Shows one mode.
                   * @param mode - The mode.
                   */ (mode) => <NativeSelectOption key={mode} value={mode}>{t(`mode_${mode}`)}</NativeSelectOption>)}
                </NativeSelect>
                <FieldDescription>{t('rulesHelp')}</FieldDescription>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="sharing-days">{t('maxDays')}</FieldLabel>
                  <Input id="sharing-days" type="number" min={1} max={30} value={draft.maxDays} disabled={busy} className="max-w-28" onChange={/**
                   * Sets the longest validity.
                   * @param event - The change event.
                   */ (event) => set({ maxDays: Number(event.target.value) })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sharing-views">{t('maxViews')}</FieldLabel>
                  <Input id="sharing-views" type="number" min={1} max={20} value={draft.maxViews} disabled={busy} className="max-w-28" onChange={/**
                   * Sets the most views.
                   * @param event - The change event.
                   */ (event) => set({ maxViews: Number(event.target.value) })} />
                </Field>
              </div>
              <FieldSet>
                <Switch id="sharing-password" label={t('requirePassword')} checked={draft.requirePassword} disabled={busy} onChange={/**
                 * Sets whether a password is required.
                 * @param value - The new value.
                 */ (value) => set({ requirePassword: value })} />
                <Switch id="sharing-email" label={t('allowEmail')} checked={draft.allowEmail} disabled={busy} onChange={/**
                 * Sets whether KeePort may e-mail links.
                 * @param value - The new value.
                 */ (value) => set({ allowEmail: value })} />
                <Switch id="sharing-code" label={t('allowEmailCode')} checked={draft.allowEmailCode} disabled={busy} onChange={/**
                 * Sets whether recipients may be asked for a code.
                 * @param value - The new value.
                 */ (value) => set({ allowEmailCode: value })} />
                {!data.emailConfigured && (draft.allowEmail || draft.allowEmailCode) && <FieldDescription>{t('emailNotConfigured')}</FieldDescription>}
              </FieldSet>
              <Button type="submit" className="w-fit" disabled={busy}>{busy ? t('saving') : t('save')}</Button>
            </form>

            <Separator />
            <FieldSet>
              <FieldLegend variant="label">{t('users')}</FieldLegend>
              <FieldDescription>{t('usersHelp')}</FieldDescription>
              {data.users.length ? (
                <Table aria-label={t('users')}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colUser')}</TableHead>
                      <TableHead>{t('colSharing')}</TableHead>
                      <TableHead>{t('colMayShare')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.users.map(/**
                     * Shows one user.
                     * @param user - The user and the mode.
                     */ (user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.username}</TableCell>
                        <TableCell>
                          <NativeSelect
                            size="sm"
                            aria-label={`${t('colSharing')}: ${user.username}`}
                            value={user.mode}
                            disabled={busy}
                            onChange={/**
                             * Saves the user's mode.
                             * @param event - The change event.
                             */ (event) => void apply(/** Stores the mode. */ () => api.setShareUserMode(user.id, event.target.value as typeof user.mode), t('changed'))}
                          >
                            {(['default', 'allowed', 'blocked'] as const).map(/**
                             * Shows one mode.
                             * @param mode - The mode.
                             */ (mode) => <NativeSelectOption key={mode} value={mode}>{t(`userMode_${mode}`)}</NativeSelectOption>)}
                          </NativeSelect>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={user.mayShare ? ACCENTS.emerald.badge : undefined}>{user.mayShare ? t('yes') : t('no')}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noUsers')}</p>
              )}
            </FieldSet>

            <Separator />
            <FieldSet>
              <FieldLegend variant="label">{t('vaults')}</FieldLegend>
              <FieldDescription>{t('vaultsHelp')}</FieldDescription>
              {data.vaults.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {data.vaults.map(/**
                   * Shows one vault's switch.
                   * @param vault - The vault.
                   */ (vault) => (
                    <Switch
                      key={vault.id}
                      id={`sharing-vault-${vault.id}`}
                      label={t('allowVault', { name: vault.name })}
                      checked={vault.allowed}
                      disabled={busy}
                      onChange={/**
                       * Saves the vault's switch.
                       * @param value - Whether sharing is allowed.
                       */ (value) => void apply(/** Stores the switch. */ () => api.setShareVaultAllowed(vault.id, value), t('changed'))}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noVaults')}</p>
              )}
            </FieldSet>

            <Separator />
            <FieldSet>
              <FieldLegend variant="label">{t('shares')}</FieldLegend>
              <FieldDescription>{t('sharesHelp')}</FieldDescription>
              {data.shares.length ? (
                <Table aria-label={t('shares')}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colLabel')}</TableHead>
                      <TableHead>{t('colOwner')}</TableHead>
                      <TableHead>{t('colExpires')}</TableHead>
                      <TableHead>{t('colViews')}</TableHead>
                      <TableHead>{t('colStatus')}</TableHead>
                      <TableHead className="w-0" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.shares.map(/**
                     * Shows one share.
                     * @param share - The share.
                     */ (share) => (
                      <TableRow key={share.id}>
                        <TableCell className="max-w-56">
                          <span className="block truncate font-medium" title={share.label}>{share.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[share.vaultName, share.hasPassword && t('withPassword'), share.requireEmailCode && t('withCode'), share.sentByEmail && t('byEmail')].filter(Boolean).join(' · ')}
                          </span>
                        </TableCell>
                        <TableCell>{share.ownerName}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(share.expiresAt)}</TableCell>
                        <TableCell className="tabular-nums">{share.viewCount}/{share.maxViews}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(STATUS_BADGE[share.status])}>{t(`status_${share.status}`)}</Badge>
                        </TableCell>
                        <TableCell>
                          {share.status === 'active' && (
                            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={/** Asks to revoke the share. */ () => setRevoking(share)}>
                              {t('revoke')}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noShares')}</p>
              )}
            </FieldSet>
          </>
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
      <AlertDialog open={revoking !== null} onOpenChange={/**
       * Closes the confirmation.
       * @param open - The requested state.
       */ (open) => { if (!open) setRevoking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('revokeTitle', { label: revoking?.label ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('revokeText')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={/** Revokes the share. */ () => {
              const share = revoking;
              setRevoking(null);
              if (share) void apply(/** Revokes it. */ () => api.revokeShare(share.id), t('revoked'));
            }}>
              {t('revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
