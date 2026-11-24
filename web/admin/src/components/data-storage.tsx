import { HardDriveIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DataStorage } from '@/lib/api';

const MOVE_GUIDE = 'https://github.com/madcoda9000/KeePort/blob/main/docs/DEPLOYMENT.md#move-data-from-the-docker-volume-to-a-folder';

const KIND_LABELS: Record<DataStorage['kind'], string> = {
  hostFolder: 'Host folder',
  dockerVolume: 'Docker volume',
  notMounted: 'Not mounted',
  unknown: 'Unknown'
};

/**
 * Explains the risk of the current storage in one sentence, or null when there is nothing to warn about.
 * @param storage - The detected data storage.
 */
function warningText(storage: DataStorage) {
  if (storage.kind === 'dockerVolume') {
    return `Your data is stored in the Docker volume ${storage.volumeName ?? ''}. NAS backup tools such as Hyper Backup or Hybrid Backup Sync don't include it. Set KEEPORT_DATA to a folder to back it up with them.`;
  }
  if (storage.kind === 'notMounted') {
    return `${storage.dataDir} is not mounted: all data is lost when the container is recreated. Mount a folder via KEEPORT_DATA.`;
  }
  return null;
}

/**
 * Warns on every admin page while the data is stored where NAS backups miss it.
 * @param props - The detected storage and a callback that opens the settings page.
 */
export function DataStorageBanner({ storage, onOpenSettings }: { storage: DataStorage; onOpenSettings: () => void }) {
  const text = warningText(storage);
  if (!text) return null;
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Your data may not be backed up</AlertTitle>
      <AlertDescription>
        <p>{text}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Button type="button" variant="link" className="h-auto p-0 text-inherit underline" onClick={onOpenSettings}>
            Show storage details
          </Button>
          <a className="underline underline-offset-4" href={MOVE_GUIDE} target="_blank" rel="noreferrer">
            How to move the data to a folder
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
  const text = storage ? warningText(storage) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDriveIcon className="size-4" /> Data storage
        </CardTitle>
        <CardDescription>Where KeePort keeps its database, vault files and admin certificate.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!storage ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted-foreground">Storage</dt>
              <dd>
                <Badge variant={storage.needsAttention ? 'destructive' : 'secondary'}>{KIND_LABELS[storage.kind]}</Badge>
              </dd>
              <dt className="text-muted-foreground">Inside the container</dt>
              <dd className="font-mono text-xs">{storage.dataDir}</dd>
              {storage.source && (
                <>
                  <dt className="text-muted-foreground">On the host</dt>
                  <dd className="font-mono text-xs break-all">{storage.source}</dd>
                </>
              )}
            </dl>
            {storage.kind === 'hostFolder' && (
              <p className="text-sm text-muted-foreground">
                Include this folder in your backups. On a NAS the path is shown as the storage system sees it, e.g.{' '}
                <code>/@syno/docker/keeport-data</code> on Synology for <code>/volume1/docker/keeport-data</code>.
              </p>
            )}
            {storage.kind === 'unknown' && (
              <p className="text-sm text-muted-foreground">
                KeePort is not running in Docker, or the mount table is unavailable. Back up {storage.dataDir}.
              </p>
            )}
            {text && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertDescription>
                  <p>{text}</p>
                  <a className="underline underline-offset-4" href={MOVE_GUIDE} target="_blank" rel="noreferrer">
                    How to move the data to a folder
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
