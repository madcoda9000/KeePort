import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import messages from '@shared/i18n/messages/app-version';
import { useT } from '@shared/i18n/react';

/** Replaced at build time by Vite with the version from the app's package.json. */
declare const __APP_VERSION__: string;

/** The KeePort release version this frontend was built from, e.g. "0.2.1". */
export const APP_VERSION: string = __APP_VERSION__;

/**
 * Shows the KeePort release version as a small badge, so users and admins can tell which release is running.
 * @param props - Optional CSS classes to adjust spacing or size at the place of use.
 */
export function VersionBadge({ className }: { className?: string }) {
  const t = useT(messages);
  return (
    <Badge
      variant="outline"
      className={cn('h-5 px-1.5 font-mono text-[10px] font-normal text-muted-foreground', className)}
      title={t('title', { version: APP_VERSION })}
    >
      v{APP_VERSION}
    </Badge>
  );
}
