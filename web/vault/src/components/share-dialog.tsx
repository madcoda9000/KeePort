import { useId, useState, type FormEvent } from 'react';
import { CopyIcon, MailIcon, TriangleAlertIcon, WandSparklesIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import messages from '@/i18n/share-dialog';
import { shareApi, type SharePolicy, type ShareInfo } from '@/lib/api';
import type { EntryView } from '@/lib/kdbx';
import { generatePassphrase, loadWordlist } from '@/lib/passphrase';
import { encryptShare, shareLink, type SharedField } from '@/lib/share-crypto';
import { argon2Kdf } from '@/lib/share-kdf';
import { formatDateTime } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';

/** The validity choices in hours; only those within the administrator's limit are offered. */
const VALIDITY_HOURS = [1, 24, 72, 168, 336, 720];

/** A field the sender can choose, with a stable key for the checkboxes. */
interface FieldChoice {
  key: string;
  field: SharedField;
  /** Whether the box is ticked at first. */
  preset: boolean;
}

/**
 * Lists the fields of an entry that have a value, as choices for sharing. Title, username, password and website are
 * ticked at first; notes, custom fields and the TOTP secret have to be chosen.
 * @param entry - The entry to share.
 * @param label - Translates the names of the standard fields.
 */
function fieldChoices(entry: EntryView, label: (kind: SharedField['kind']) => string): FieldChoice[] {
  const standard: [SharedField['kind'], string, boolean, boolean][] = [
    ['title', entry.title, false, true],
    ['username', entry.username, false, true],
    ['password', entry.password, true, true],
    ['url', entry.url, false, true],
    ['notes', entry.notes, false, false],
    ['totp', entry.otp, true, false]
  ];
  const choices: FieldChoice[] = standard.filter(/**
   * Keeps fields with a value.
   * @param item - One standard field.
   */ ([, value]) => value.trim() !== '').map(/**
   * Builds the choice of a standard field.
   * @param item - One standard field: kind, value, whether it is protected, whether it is ticked at first.
   */ ([kind, value, isProtected, preset]) => ({ key: kind, field: { kind, name: label(kind), value, protected: isProtected }, preset }));
  entry.customFields.forEach(/**
   * Adds one custom field.
   * @param field - The custom field.
   * @param index - Its position, for a unique key.
   */ (field, index) => {
    if (field.value.trim()) choices.push({ key: `custom:${index}`, field: { kind: 'custom', name: field.name, value: field.value, protected: field.protected }, preset: false });
  });
  return choices;
}

/** The result shown after the link was created. */
interface ShareResult {
  link: string;
  share: ShareInfo;
  password: string;
  sendError: string | null;
}

/**
 * The dialog that shares an entry with someone outside KeePort through a link.
 * @param props - Whether it is open, the change handler, the entry and its vault, the user's sharing rules and the copy function.
 */
export function ShareDialog({
  open,
  onOpenChange,
  entry,
  vaultFileId,
  policy,
  onCopy
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: EntryView | null;
  vaultFileId: string;
  policy: SharePolicy;
  onCopy: (value: string) => Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        {open && entry && (
          <ShareForm key={entry.id} entry={entry} vaultFileId={vaultFileId} policy={policy} onCopy={onCopy} onClose={/** Closes the dialog. */ () => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The form and the result of sharing one entry.
 * @param props - The entry and its vault, the sharing rules, the copy function and what closing does.
 */
function ShareForm({
  entry,
  vaultFileId,
  policy,
  onCopy,
  onClose
}: {
  entry: EntryView;
  vaultFileId: string;
  policy: SharePolicy;
  onCopy: (value: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useT(messages);
  const id = useId();
  const [choices] = useState(/** Lists the entry's fields once. */ () => fieldChoices(entry, /**
   * Names a standard field in the current language.
   * @param kind - The field kind.
   */ (kind) => t(`field_${kind}` as 'field_title')));
  const [selected, setSelected] = useState<ReadonlySet<string>>(/** Ticks the preset fields. */ () => new Set(choices.filter(/**
   * Keeps preset fields.
   * @param choice - One field choice.
   */ (choice) => choice.preset).map(/**
   * Selects the key.
   * @param choice - One preset field.
   */ (choice) => choice.key)));
  const hours = VALIDITY_HOURS.filter(/**
   * Keeps validities within the limit.
   * @param value - One validity in hours.
   */ (value) => value <= policy.maxDays * 24);
  const [label, setLabel] = useState(t('defaultLabel'));
  const [message, setMessage] = useState('');
  const [validity, setValidity] = useState(hours.includes(24) ? 24 : hours[0] ?? 1);
  const [views, setViews] = useState(1);
  const [usePassword, setUsePassword] = useState(policy.requirePassword);
  const [password, setPassword] = useState('');
  const [recipient, setRecipient] = useState('');
  const [requireCode, setRequireCode] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShareResult | null>(null);
  const passwordForced = policy.requirePassword || sendEmail;
  const passwordOn = usePassword || passwordForced;
  const needsEmail = requireCode || sendEmail;
  const blocked = policy.blockedVaultIds.includes(vaultFileId);

  /**
   * Ticks or unticks a field.
   * @param key - The field's key.
   * @param checked - Whether it is shared.
   */
  function toggle(key: string, checked: boolean) {
    /**
     * Builds the new selection.
     * @param current - The current selection.
     */
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  /** Fills in a random passphrase of four words. */
  async function generate() {
    const words = await loadWordlist();
    setPassword(generatePassphrase({ words: 4, separator: 'hyphen', capitalize: false, addNumber: false }, words));
  }

  /**
   * Encrypts the chosen fields, stores the share and shows the link.
   * @param event - The form submission.
   */
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = choices.filter(/**
     * Keeps the ticked fields.
     * @param choice - One field choice.
     */ (choice) => selected.has(choice.key)).map(/**
     * Selects the field.
     * @param choice - One ticked field.
     */ (choice) => choice.field);
    if (!fields.length) return setError(t('noFields'));
    if (passwordOn && !password.trim()) return setError(t('passwordMissing'));
    if (needsEmail && !recipient.trim()) return setError(t('emailMissing'));
    setBusy(true);
    setError(null);
    try {
      const secret = passwordOn ? password.trim() : '';
      const encrypted = await encryptShare({ v: 1, fields, message: message.trim() || undefined }, secret, argon2Kdf);
      let share = await shareApi.create({
        vaultFileId,
        entryUuid: entry.id,
        label: label.trim() || t('defaultLabel'),
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        kdfSalt: encrypted.kdfSalt,
        kdfParams: encrypted.kdfParams,
        proof: encrypted.proof,
        maxViews: views,
        expiresInHours: validity,
        recipientEmail: recipient.trim() || null,
        requireEmailCode: requireCode
      });
      let sendError: string | null = null;
      if (sendEmail) {
        try {
          share = await shareApi.send(share.id, encrypted.linkKey);
        } catch (sendFailure) {
          sendError = sendFailure instanceof Error ? sendFailure.message : String(sendFailure);
        }
      }
      setResult({ link: shareLink(location.origin, share.id, encrypted.linkKey), share, password: secret, sendError });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const expires = formatDateTime(result.share.expiresAt);
    const body = t(result.password ? 'mailBodyPassword' : 'mailBody', { link: result.link, expires });
    const mailto = `mailto:${encodeURIComponent(result.share.recipientEmail ?? '')}?subject=${encodeURIComponent(t('mailSubject'))}&body=${encodeURIComponent(body)}`;
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t('readyTitle')}</DialogTitle>
          <DialogDescription>{t('linkOnce')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field>
            <FieldLabel htmlFor={`${id}-link`}>{t('link')}</FieldLabel>
            <div className="flex gap-2">
              <Input id={`${id}-link`} readOnly value={result.link} className="font-mono text-xs" onFocus={/**
               * Selects the whole link.
               * @param event - The focus event.
               */ (event) => event.target.select()} />
              <Button type="button" onClick={/** Copies the link. */ () => void onCopy(result.link)}>
                <CopyIcon /> {t('copyLink')}
              </Button>
            </div>
            <FieldDescription>{t('expires', { date: expires })} {t('viewsHelp', { count: result.share.maxViews })}</FieldDescription>
          </Field>
          {result.password && (
            <Alert>
              <TriangleAlertIcon />
              <AlertDescription>{t('tellPassword', { password: result.password })}</AlertDescription>
            </Alert>
          )}
          {result.share.sentByEmail && result.share.recipientEmail && (
            <Alert>
              <MailIcon />
              <AlertDescription>{t('sentTo', { email: result.share.recipientEmail })}</AlertDescription>
            </Alert>
          )}
          {result.sendError && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertDescription>{t('sendFailed', { error: result.sendError })}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          {!result.share.sentByEmail && (
            <Button type="button" variant="outline" asChild>
              <a href={mailto}>
                <MailIcon /> {t('openMail')}
              </a>
            </Button>
          )}
          <Button type="button" onClick={onClose}>{t('done')}</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form className="grid gap-5" onSubmit={create}>
      <DialogHeader>
        <DialogTitle>{t('shareTitle', { title: entry.title })}</DialogTitle>
        <DialogDescription>{t('shareIntro')}</DialogDescription>
      </DialogHeader>
      {blocked && (
        <Alert variant="destructive">
          <AlertDescription>{t('notAllowedVault')}</AlertDescription>
        </Alert>
      )}
      <FieldGroup className="gap-4">
        <FieldSet>
          <FieldLegend variant="label">{t('fields')}</FieldLegend>
          <div className="grid gap-2 sm:grid-cols-2">
            {choices.map(/**
             * Shows the checkbox of one field.
             * @param choice - The field choice.
             */ (choice) => (
              <Field key={choice.key} orientation="horizontal">
                <Checkbox
                  id={`${id}-field-${choice.key}`}
                  checked={selected.has(choice.key)}
                  disabled={busy}
                  onCheckedChange={/**
                   * Ticks or unticks the field.
                   * @param checked - The new state.
                   */ (checked) => toggle(choice.key, checked === true)}
                />
                <FieldLabel htmlFor={`${id}-field-${choice.key}`} className="min-w-0 truncate font-normal">{choice.field.name}</FieldLabel>
              </Field>
            ))}
          </div>
          {selected.has('totp') && (
            <Alert>
              <TriangleAlertIcon />
              <AlertDescription>{t('totpWarning')}</AlertDescription>
            </Alert>
          )}
        </FieldSet>
        <Field>
          <FieldLabel htmlFor={`${id}-message`}>{t('message')}</FieldLabel>
          <Textarea id={`${id}-message`} value={message} maxLength={2000} rows={2} disabled={busy} onChange={/**
           * Updates the message.
           * @param event - The change event.
           */ (event) => setMessage(event.target.value)} />
          <FieldDescription>{t('messageHelp')}</FieldDescription>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-validity`}>{t('validFor')}</FieldLabel>
            <NativeSelect id={`${id}-validity`} value={validity} disabled={busy} onChange={/**
             * Chooses the validity.
             * @param event - The change event.
             */ (event) => setValidity(Number(event.target.value))}>
              {hours.map(/**
               * Shows one validity.
               * @param value - Hours.
               */ (value) => (
                <NativeSelectOption key={value} value={value}>{value === 1 ? t('hour') : t('days', { count: value / 24 })}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-views`}>{t('views')}</FieldLabel>
            <NativeSelect id={`${id}-views`} value={views} disabled={busy} onChange={/**
             * Chooses the number of views.
             * @param event - The change event.
             */ (event) => setViews(Number(event.target.value))}>
              {Array.from({ length: policy.maxViews }, /**
               * Builds one view count.
               * @param _ - Unused.
               * @param index - Its position.
               */ (_, index) => index + 1).map(/**
               * Shows one view count.
               * @param count - Views.
               */ (count) => <NativeSelectOption key={count} value={count}>{count}×</NativeSelectOption>)}
            </NativeSelect>
          </Field>
        </div>
        <FieldDescription className="-mt-2">{t('viewsHelp', { count: views })}</FieldDescription>
        <Field orientation="horizontal">
          <Checkbox id={`${id}-use-password`} checked={passwordOn} disabled={busy || passwordForced} onCheckedChange={/**
           * Turns the password on or off.
           * @param checked - The new state.
           */ (checked) => setUsePassword(checked === true)} />
          <div className="grid gap-1">
            <FieldLabel htmlFor={`${id}-use-password`} className="font-normal">{t('usePassword')}</FieldLabel>
            {policy.requirePassword && <FieldDescription>{t('passwordRequired')}</FieldDescription>}
          </div>
        </Field>
        {passwordOn && (
          <Field>
            <FieldLabel htmlFor={`${id}-password`}>{t('password')}</FieldLabel>
            <div className="flex gap-2">
              <Input id={`${id}-password`} value={password} autoComplete="off" spellCheck={false} disabled={busy} className="font-mono" onChange={/**
               * Updates the password.
               * @param event - The change event.
               */ (event) => setPassword(event.target.value)} />
              <Button type="button" variant="outline" disabled={busy} onClick={/** Generates a passphrase. */ () => void generate()}>
                <WandSparklesIcon /> {t('generate')}
              </Button>
            </div>
            <FieldDescription>{t('passwordHelp')}</FieldDescription>
          </Field>
        )}
        {(policy.allowEmail || policy.allowEmailCode) && (
          <>
            <Field>
              <FieldLabel htmlFor={`${id}-recipient`}>{needsEmail ? t('recipientEmail') : t('recipientEmailOptional')}</FieldLabel>
              <Input id={`${id}-recipient`} type="email" value={recipient} autoComplete="off" disabled={busy} onChange={/**
               * Updates the recipient's address.
               * @param event - The change event.
               */ (event) => setRecipient(event.target.value)} />
            </Field>
            {policy.allowEmailCode && (
              <Field orientation="horizontal">
                <Checkbox id={`${id}-code`} checked={requireCode} disabled={busy} onCheckedChange={/**
                 * Turns the e-mail code on or off.
                 * @param checked - The new state.
                 */ (checked) => setRequireCode(checked === true)} />
                <div className="grid gap-1">
                  <FieldLabel htmlFor={`${id}-code`} className="font-normal">{t('requireCode')}</FieldLabel>
                  <FieldDescription>{t('requireCodeHelp')}</FieldDescription>
                </div>
              </Field>
            )}
            {policy.allowEmail && (
              <Field orientation="horizontal">
                <Checkbox id={`${id}-send`} checked={sendEmail} disabled={busy} onCheckedChange={/**
                 * Turns sending by e-mail on or off.
                 * @param checked - The new state.
                 */ (checked) => setSendEmail(checked === true)} />
                <div className="grid gap-1">
                  <FieldLabel htmlFor={`${id}-send`} className="font-normal">{t('sendEmail')}</FieldLabel>
                  <FieldDescription>{t('sendEmailHelp')}</FieldDescription>
                </div>
              </Field>
            )}
          </>
        )}
        <Field>
          <FieldLabel htmlFor={`${id}-label`}>{t('label')}</FieldLabel>
          <Input id={`${id}-label`} value={label} maxLength={100} disabled={busy} onChange={/**
           * Updates the label.
           * @param event - The change event.
           */ (event) => setLabel(event.target.value)} />
          <FieldDescription>{t('labelHelp')}</FieldDescription>
        </Field>
      </FieldGroup>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
        <Button type="submit" disabled={busy || blocked}>{busy ? t('creating') : t('create')}</Button>
      </DialogFooter>
    </form>
  );
}
