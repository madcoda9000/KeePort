import { HardDriveIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DataStorage } from '@/lib/api';
import messages from '@/i18n/data-storage';
import { translate } from '@shared/i18n/core';
import { useT } from '@shared/i18n/react';

const MOVE_GUIDE = 'https://github.com/madcoda9000/KeePort/blob/main/docs/DEPLOYMENT.md#move-data-from-the-docker-volume-to-a-folder';

/** Catalog keys of the storage kinds. */
const KIND_LABELS: Record<DataStorage['kind'], keyof typeof messages.en> = {
  hostFolder: 'kindHostFolder',
  dockerVolume: 'kindDockerVolume',
  notMounted: 'kindNotMounted',
  unknown: 'kindUnknown'
};

/**
 * Explains the risk of the current storage in one sentence, or null when there is nothing to warn about.
 * @param storage - The detected data storage.
 */
function warningText(storage: DataStorage) {
  if (storage.kind === 'dockerVolume') {
    return translate(messages, 'dockerVolumeWarning', { volume: storage.volumeName ?? '' });
  }
  if (storage.kind === 'notMounted') {
    return translate(messages, 'notMountedWarning', { dataDir: storage.dataDir });
  }
  return null;
}

/**
 * Warns on every admin page while the data is stored where NAS backups miss it.
 * @param props - The detected storage and a callback that opens the settings page.
 */
export function DataStorageBanner({ storage, onOpenSettings }: { storage: DataStorage; onOpenSettings: () => void }) {
  const t = useT(messages);
  const text = warningText(storage);
  if (!text) return null;
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{t('bannerTitle')}</AlertTitle>
      <AlertDescription>
        <p>{text}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Button type="button" variant="link" className="h-auto p-0 text-inherit underline" onClick={onOpenSettings}>
            {t('showDetails')}
          </Button>
          <a className="underline underline-offset-4" href={MOVE_GUIDE} target="_blank" rel="noreferrer">
            {t('moveGuide')}
          </a>
        </p>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Shows where KeePort keeps its data on the settings page.
 * @param props - The detected storage, or null while it is loading or unavailable.
 */
export function DataStoragePanel({ storage }: { storage: DataStorage | null }) {
  const t = useT(messages);
  const text = storage ? warningText(storage) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDriveIcon className="size-4" /> {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!storage ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : (
          <>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted-foreground">{t('storage')}</dt>
              <dd>
                <Badge variant={storage.needsAttention ? 'destructive' : 'secondary'}>{t(KIND_LABELS[storage.kind])}</Badge>
              </dd>
              <dt className="text-muted-foreground">{t('insideContainer')}</dt>
              <dd className="font-mono text-xs">{storage.dataDir}</dd>
              {storage.source && (
                <>
                  <dt className="text-muted-foreground">{t('onHost')}</dt>
                  <dd className="font-mono text-xs break-all">{storage.source}</dd>
                </>
              )}
            </dl>
            {storage.kind === 'hostFolder' && (
              <p className="text-sm text-muted-foreground">
                {t.rich('hostFolderHint', { syno: <code>/@syno/docker/keeport-data</code>, volume: <code>/volume1/docker/keeport-data</code> })}
              </p>
            )}
            {storage.kind === 'unknown' && (
              <p className="text-sm text-muted-foreground">
                {t('unknownHint', { dataDir: storage.dataDir })}
              </p>
            )}
            {text && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertDescription>
                  <p>{text}</p>
                  <a className="underline underline-offset-4" href={MOVE_GUIDE} target="_blank" rel="noreferrer">
                    {t('moveGuide')}
                  </a>
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
