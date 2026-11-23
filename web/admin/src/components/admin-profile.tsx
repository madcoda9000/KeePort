import { useState, type FormEvent } from 'react';
import { UserRoundIcon } from 'lucide-react';
import { api, type User } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

type ProfileMessage = { kind: 'notice' | 'error'; text: string };

/** Shows the admin account and lets the signed-in admin update its contact email and login password. */
export function AdminProfile({ user, onUpdate }: { user: User; onUpdate: (user: User) => void }) {
  const [busy, setBusy] = useState<'email' | 'password' | null>(null);
  const [message, setMessage] = useState<ProfileMessage | null>(null);

  /** Saves the contact email and updates the account displayed in the sidebar. */
  async function handleEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    setBusy('email');
    setMessage(null);
    try {
      onUpdate(await api.updateEmail(email));
      setMessage({ kind: 'notice', text: 'Email address saved.' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to save email address.' });
    } finally {
      setBusy(null);
    }
  }

  /** Checks password confirmation before changing the current account's password. */
  async function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get('currentPassword') ?? '');
    const newPassword = String(data.get('newPassword') ?? '');
    if (newPassword !== data.get('confirmPassword')) {
      setMessage({ kind: 'error', text: 'New passwords do not match.' });
      return;
    }
    setBusy('password');
    setMessage(null);
    try {
      await api.changePassword({ currentPassword, newPassword });
      form.reset();
      setMessage({ kind: 'notice', text: 'Password changed.' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to change password.' });
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
            {user.email ?? 'No email set'}
          </p>
        </div>
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <Dialog onOpenChange={(open) => { if (open) setMessage(null); }}>
            <DialogTrigger asChild>
              <SidebarMenuButton type="button" variant="outline">
                <UserRoundIcon />
                <span>Profile</span>
              </SidebarMenuButton>
            </DialogTrigger>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Account settings</DialogTitle>
                <DialogDescription>Update your admin email address or login password.</DialogDescription>
              </DialogHeader>
              {message && (
                <Alert variant={message.kind === 'error' ? 'destructive' : 'default'}>
                  <AlertDescription>{message.text}</AlertDescription>
                </Alert>
              )}
              <form key={user.email ?? ''} className="grid gap-4" onSubmit={handleEmail}>
                <h3 className="text-sm font-semibold">Contact information</h3>
                <Field>
                  <FieldLabel htmlFor="admin-profile-email">Email address</FieldLabel>
                  <Input id="admin-profile-email" name="email" type="email" autoComplete="email" defaultValue={user.email ?? ''} maxLength={254} required />
                </Field>
                <Button type="submit" variant="outline" className="justify-self-start" disabled={busy !== null}>
                  {busy === 'email' ? 'Saving…' : 'Save email'}
                </Button>
              </form>
              <Separator />
              <form className="grid gap-4" onSubmit={handlePassword}>
                <h3 className="text-sm font-semibold">Security</h3>
                <FieldGroup className="gap-4">
                  <Field>
                    <FieldLabel htmlFor="admin-current-password">Current password</FieldLabel>
                    <Input id="admin-current-password" name="currentPassword" type="password" autoComplete="current-password" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="admin-new-password">New password</FieldLabel>
                    <Input id="admin-new-password" name="newPassword" type="password" autoComplete="new-password" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="admin-confirm-password">Confirm new password</FieldLabel>
                    <Input id="admin-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required />
                  </Field>
                </FieldGroup>
                <Button type="submit" className="justify-self-start" disabled={busy !== null}>
                  {busy === 'password' ? 'Changing…' : 'Change password'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
