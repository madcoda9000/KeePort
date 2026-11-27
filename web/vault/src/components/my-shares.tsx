import { useEffect, useState } from 'react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import messages from '@/i18n/share-dialog';
import { shareApi, type ShareInfo } from '@/lib/api';
import { ACCENTS } from '@shared/accent';
import { formatDateTime } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';
import { cn } from '@/lib/utils';

/** The badge colour of each share status. */
const STATUS_BADGE: Record<ShareInfo['status'], string> = {
  active: ACCENTS.emerald.badge,
  used: '',
  expired: '',
  revoked: '',
  locked: 'border-destructive/40 bg-destructive/10 text-destructive'
};

/**
 * The signed-in user's shares with status and a button to revoke active ones; shown in the account settings.
 * @param props - What to report after a revocation.
 */
export function MyShares({ onMessage }: { onMessage: (message: { kind: 'notice' | 'error'; text: string }) => void }) {
  const t = useT(messages);
  const [shares, setShares] = useState<ShareInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ShareInfo | null>(null);

  /** Loads the shares when the section opens. */
  useEffect(() => {
    let cancelled = false;
    shareApi.list().then(/**
     * Shows the loaded shares.
     * @param list - The shares.
     */ (list) => {
      if (!cancelled) setShares(list);
    }, /**
     * Shows the error.
     * @param failure - Why loading failed.
     */ (failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : t('loadFailed'));
    });
    return /** Ignores a late answer after closing. */ () => {
      cancelled = true;
    };
  }, [t]);

  /** Revokes the share chosen in the confirmation and reloads the list. */
  async function revoke() {
    const share = revoking;
    setRevoking(null);
    if (!share) return;
    try {
      await shareApi.revoke(share.id);
      setShares(await shareApi.list());
      onMessage({ kind: 'notice', text: t('revoked') });
    } catch (failure) {
      onMessage({ kind: 'error', text: failure instanceof Error ? failure.message : t('revokeFailed') });
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('mySharesIntro')}</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {shares && !shares.length && <p className="text-sm text-muted-foreground">{t('noShares')}</p>}
      {shares && shares.length > 0 && (
        <Table aria-label={t('myShares')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colLabel')}</TableHead>
              <TableHead>{t('colExpires')}</TableHead>
              <TableHead>{t('colViews')}</TableHead>
              <TableHead>{t('colStatus')}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shares.map(/**
             * Shows one share.
             * @param share - The share.
             */ (share) => (
              <TableRow key={share.id}>
                <TableCell className="max-w-48">
                  <span className="block truncate font-medium" title={share.label}>{share.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[share.vaultName, share.hasPassword && t('withPassword'), share.requireEmailCode && t('withCode'), share.sentByEmail && t('byEmail')].filter(Boolean).join(' · ')}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(share.expiresAt)}</TableCell>
                <TableCell className="tabular-nums">{share.viewCount}/{share.maxViews}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn(STATUS_BADGE[share.status])}>{t(`status_${share.status}`)}</Badge>
                </TableCell>
                <TableCell>
                  {share.status === 'active' && (
                    <Button type="button" size="sm" variant="outline" onClick={/** Asks to revoke the share. */ () => setRevoking(share)}>
                      {t('revoke')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <AlertDialog open={revoking !== null} onOpenChange={/**
       * Closes the confirmation.
       * @param open - The requested state.
       */ (open) => { if (!open) setRevoking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('revoke')}: {revoking?.label}</AlertDialogTitle>
            <AlertDialogDescription>{t('mySharesIntro')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={/** Revokes the share. */ () => void revoke()}>{t('revoke')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
