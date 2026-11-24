import { ShieldAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

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
 * @param props - The blocked action, phrased as a sentence start such as "Creating a vault".
 */
export function InsecureContextAlert({ action }: { action: string }) {
  return (
    <Alert variant="destructive">
      <ShieldAlertIcon />
      <AlertTitle>Secure connection required</AlertTitle>
      <AlertDescription>
        <p>
          {action} needs your browser's encryption functions, which browsers only provide over HTTPS or on{' '}
          <code>http://localhost</code>. This page was opened via <code>{window.location.origin}</code>.
        </p>
        <p>
          Open KeePort through its HTTPS address, or through an SSH tunnel at <code>http://localhost</code>.{' '}
          <a
            className="underline underline-offset-4"
            href="https://github.com/madcoda9000/KeePort/blob/main/docs/DEPLOYMENT.md#-secure-connection-required"
            target="_blank"
            rel="noreferrer"
          >
            How to set this up
          </a>
        </p>
      </AlertDescription>
    </Alert>
  );
}
