import { ShieldAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import messages from '@shared/i18n/messages/secure-context';
import { useT } from '@shared/i18n/react';

/**
 * Reports whether the browser provides the Web Crypto API that KDBX encryption needs. Browsers only offer it in a
 * secure context: HTTPS, or http://localhost. Over plain http:// with an IP address or host name it is missing, and
 * kdbxweb would fail with errors such as "randomBytes is not a function".
 */
export function hasBrowserCrypto(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof globalThis.crypto?.subtle !== 'undefined';
}

/**
 * Explains why encrypting or decrypting a vault is unavailable on this connection and how to fix it.
 * @param props - The blocked action, phrased as a sentence start such as "Creating a vault" (translated by the caller).
 */
export function InsecureContextAlert({ action }: { action: string }) {
  const t = useT(messages);
  const localhost = <code>http://localhost</code>;
  return (
    <Alert variant="destructive">
      <ShieldAlertIcon />
      <AlertTitle>{t('title')}</AlertTitle>
      <AlertDescription>
        <p>{t.rich('explanation', { action, localhost, origin: <code>{window.location.origin}</code> })}</p>
        <p>
          {t.rich('fix', { localhost })}{' '}
          <a
            className="underline underline-offset-4"
            href="https://github.com/madcoda9000/KeePort/blob/main/docs/DEPLOYMENT.md#-secure-connection-required"
            target="_blank"
            rel="noreferrer"
          >
            {t('howTo')}
          </a>
        </p>
      </AlertDescription>
    </Alert>
  );
}
