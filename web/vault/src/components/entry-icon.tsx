import { useState } from 'react';
import { KeyRoundIcon } from 'lucide-react';
import { faviconUrl } from '@/lib/icons';
import { cn } from '@/lib/utils';

/**
 * Shows an entry's icon: its own icon from the KDBX first, then, if the user opted in, the site's favicon loaded
 * directly by the browser, and the key symbol when neither is available or loading fails.
 * @param props - The entry's custom icon data URL and URL, whether website icons may be loaded, and CSS classes.
 */
export function EntryIcon({
  iconUrl,
  url,
  showFavicons,
  className
}: {
  iconUrl: string | null;
  url: string;
  showFavicons: boolean;
  className?: string;
}) {
  const favicon = showFavicons ? faviconUrl(url) : null;
  const sources = [iconUrl, favicon].filter(/**
   * Keeps available sources.
   * @param source - One possible image source.
   */ (source): source is string => Boolean(source));
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const source = sources.find(/**
   * Picks the first source that has not failed to load.
   * @param candidate - One image source.
   */ (candidate) => !failed.has(candidate));

  if (!source) return <KeyRoundIcon aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground', className)} />;
  return (
    <img
      src={source}
      alt=""
      aria-hidden="true"
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={cn('size-4 shrink-0 rounded-sm object-contain', className)}
      onError={/** Falls back to the next source when the image cannot be loaded. */ () => setFailed(/**
       * Marks the current source as failed.
       * @param current - The sources that failed before.
       */ (current) => new Set(current).add(source))}
    />
  );
}
