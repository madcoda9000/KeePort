import { useState, type FormEvent } from 'react';
import { BellIcon, KeyRoundIcon, ShieldCheckIcon, UserRoundIcon } from 'lucide-react';
import { api, mfaApi, type User } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import messages from '@/i18n/admin-profile';
import { EmailConfirmation, EmailNotifications } from '@shared/email-account';
import emailAccountMessages from '@shared/i18n/messages/email-account';
import languageMessages from '@shared/i18n/messages/language';
import { applyPreference, type LanguagePreference } from '@shared/i18n/core';
import { LanguageSetting } from '@shared/i18n/language-select';
import { useT } from '@shared/i18n/react';
import { TwoFactorSettings } from '@shared/two-factor';
import { SettingsDialogContent } from '@shared/settings-dialog';
import settingsDialogText from '@shared/i18n/messages/settings-dialog';

type ProfileMessage = { kind: 'notice' | 'error'; text: string };

/**
 * Shows the admin account and lets the signed-in admin update its contact email, login password and language.
 * @param props - The signed-in administrator and the callback that receives the updated account after a profile change.
 */
export function AdminProfile({ user, onUpdate }: { user: User; onUpdate: (user: User) => void }) {
  const [busy, setBusy] = useState<'email' | 'password' | 'language' | null>(null);
  const [message, setMessage] = useState<ProfileMessage | null>(null);
  const t = useT(messages);
  const tLanguage = useT(languageMessages);
  const tEmail = useT(emailAccountMessages);
  const tSettings = useT(settingsDialogText);

  /**
   * Saves the contact email and updates the account displayed in the sidebar.
   * @param event - The submission event from the admin contact email form.
   */
  async function handleEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    setBusy('email');
    setMessage(null);
    try {
      onUpdate(await api.updateEmail(email));
      setMessage({ kind: 'notice', text: t('emailSaved') });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : t('emailFailed') });
    } finally {
      setBusy(null);
    }
  }

  /** Asks the server to send a confirmation code to the admin's address; errors are shown by the confirmation section. */
  async function requestEmailCode() {
    setMessage(null);
    await api.requestEmailVerification();
  }

  /**
   * Confirms the admin's address with the code from the e-mail and shows the updated account.
   * @param code - The 6-digit code the admin entered.
   */
  async function verifyEmail(code: string) {
    setMessage(null);
    onUpdate(await api.verifyEmail(code));
    setMessage({ kind: 'notice', text: tEmail('confirmedNotice') });
  }

  /**
   * Saves which security notifications the admin gets by e-mail.
   * @param signIn - Notify about sign-ins from a new browser.
   * @param appPassword - Notify about new app passwords.
   */
  async function saveNotifications(signIn: boolean, appPassword: boolean) {
    setMessage(null);
    onUpdate(await api.updateNotifications({ signIn, appPassword }));
    setMessage({ kind: 'notice', text: tEmail('notificationsSaved') });
  }

  /**
   * Checks password confirmation before changing the current account's password.
   * @param event - The submission event from the admin login password form.
   */
  async function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get('currentPassword') ?? '');
    const newPassword = String(data.get('newPassword') ?? '');
    if (newPassword !== data.get('confirmPassword')) {
      setMessage({ kind: 'error', text: t('passwordsDiffer') });
      return;
    }
    setBusy('password');
    setMessage(null);
    try {
      await api.changePassword({ currentPassword, newPassword });
      form.reset();
      setMessage({ kind: 'notice', text: t('passwordChanged') });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : t('passwordFailed') });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Stores the chosen language on the account and shows it right away.
   * @param language - de, en or fr, or null to follow the browser.
   */
  async function handleLanguage(language: LanguagePreference) {
    setBusy('language');
    setMessage(null);
    try {
      onUpdate(await api.updateLanguage(language));
      applyPreference(language);
      setMessage({ kind: 'notice', text: tLanguage('saved') });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : t('languageFailed') });
    } finally {
      setBusy(null);
    }
  }

  return (
    <SidebarFooter className="gap-3 border-t px-4 py-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar aria-hidden="true">
          <AvatarFallback className="bg-primary font-medium text-primary-foreground">
            {user.username.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" title={user.username}>{user.username}</p>
          <p className="truncate text-xs text-muted-foreground" title={user.email ?? undefined}>
            {user.email ?? t('noEmail')}
          </p>
        </div>
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <Dialog onOpenChange={/**
           * Clears the previous profile message when the dialog opens.
           * @param open - The requested profile dialog state.
           */ (open) => { if (open) setMessage(null); }}>
            <DialogTrigger asChild>
              <SidebarMenuButton type="button" variant="outline">
                <UserRoundIcon />
                <span>{t('profile')}</span>
              </SidebarMenuButton>
            </DialogTrigger>
            <SettingsDialogContent
              title={t('title')}
              description={t('description')}
              message={message && (
                <Alert variant={message.kind === 'error' ? 'destructive' : 'default'}>
                  <AlertDescription>{message.text}</AlertDescription>
                </Alert>
              )}
              sections={[
                { id: 'account', label: tSettings('account'), icon: UserRoundIcon, content: (
                  <>
                  <form key={user.email ?? ''} className="grid gap-4" onSubmit={handleEmail}>
                    <h3 className="text-sm font-semibold">{t('contact')}</h3>
                    <Field>
                      <FieldLabel htmlFor="admin-profile-email">{t('email')}</FieldLabel>
                      <Input id="admin-profile-email" name="email" type="email" autoComplete="email" defaultValue={user.email ?? ''} maxLength={254} required />
                    </Field>
                    <Button type="submit" variant="outline" className="justify-self-start" disabled={busy !== null}>
                      {busy === 'email' ? t('saving') : t('saveEmail')}
                    </Button>
                  </form>
                  <EmailConfirmation
                    key={`confirm-${user.email ?? ''}`}
                    email={user.email}
                    verified={user.emailVerified}
                    onRequestCode={requestEmailCode}
                    onVerify={verifyEmail}
                  />
                  <Separator />
                  <Field>
                    <FieldLabel htmlFor="account-language">{tLanguage('label')}</FieldLabel>
                    <LanguageSetting value={user.language ?? null} disabled={busy !== null} onSave={/**
                     * Saves the chosen language.
                     * @param language - The new preference.
                     */ (language) => void handleLanguage(language)} />
                    <FieldDescription id="account-language-help">{tLanguage('help')}</FieldDescription>
                  </Field>
                  </>
                ) },
                { id: 'password', label: tSettings('password'), icon: KeyRoundIcon, content: (
                  <>
                  <form className="grid gap-4" onSubmit={handlePassword}>
                    <h3 className="text-sm font-semibold">{t('changePassword')}</h3>
                    <FieldGroup className="gap-4">
                      <Field>
                        <FieldLabel htmlFor="admin-current-password">{t('currentPassword')}</FieldLabel>
                        <Input id="admin-current-password" name="currentPassword" type="password" autoComplete="current-password" required />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="admin-new-password">{t('newPassword')}</FieldLabel>
                        <Input id="admin-new-password" name="newPassword" type="password" autoComplete="new-password" required />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="admin-confirm-password">{t('confirmPassword')}</FieldLabel>
                        <Input id="admin-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required />
                      </Field>
                    </FieldGroup>
                    <Button type="submit" className="justify-self-start" disabled={busy !== null}>
                      {busy === 'password' ? t('changing') : t('changePassword')}
                    </Button>
                  </form>
                  </>
                ) },
                { id: 'twoFactor', label: tSettings('twoFactor'), icon: ShieldCheckIcon, content: (
                  <>
                  <TwoFactorSettings username={user.username} api={mfaApi} showTitle={false} onChange={/**
                   * Shows the new two-factor state in the account.
                   * @param status - The new state.
                   */ (status) => onUpdate({ ...user, twoFactor: status.active })} />
                  </>
                ) },
                { id: 'notifications', label: tSettings('notifications'), icon: BellIcon, content: (
                  <EmailNotifications
                    signIn={user.notifySignIn}
                    appPassword={user.notifyAppPassword}
                    showAppPassword={false}
                    verified={user.emailVerified}
                    onSave={saveNotifications}
                  />
                ) }
              ]}
            />
          </Dialog>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
