import { useState } from 'react';
import { KeyRoundIcon } from 'lucide-react';
import { faviconUrl } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { accentFor } from '@shared/accent';

/**
 * Shows an entry's icon: its own icon from the KDBX first, then, if the user opted in, the site's favicon loaded
 * directly by the browser, and a fallback when neither is available or loading fails.
 * With a title, the icon sits on a tile and the fallback is the title's first letter in a fixed colour;
 * without one, the fallback is the key symbol.
 * @param props - The entry's custom icon data URL and URL, whether website icons may be loaded, the optional title
 * for the tile, and CSS classes.
 */
export function EntryIcon({
  iconUrl,
  url,
  showFavicons,
  title,
  className
}: {
  iconUrl: string | null;
  url: string;
  showFavicons: boolean;
  title?: string;
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

  const image = source && (
    <img
      src={source}
      alt=""
      aria-hidden="true"
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={cn('size-4 shrink-0 rounded-sm object-contain', title === undefined && className)}
      onError={/** Falls back to the next source when the image cannot be loaded. */ () => setFailed(/**
       * Marks the current source as failed.
       * @param current - The sources that failed before.
       */ (current) => new Set(current).add(source))}
    />
  );

  if (title !== undefined) {
    const letter = Array.from(title.trim())[0]?.toUpperCase() ?? '';
    return (
      <span
        aria-hidden="true"
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-lg text-sm font-semibold',
          image ? 'border bg-card' : accentFor(title).tile,
          className
        )}
      >
        {image || letter || <KeyRoundIcon className="size-4" />}
      </span>
    );
  }
  if (image) return image;
  return <KeyRoundIcon aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground', className)} />;
}
