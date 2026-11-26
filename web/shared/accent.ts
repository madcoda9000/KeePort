/** Tailwind class sets for one accent colour: a tinted tile, a tinted badge, a solid dot and an icon colour. */
export type Accent = { tile: string; badge: string; dot: string; text: string };

/**
 * Accent colours for tags, entry tiles and dashboard icons. Red is left out so nothing looks like an error.
 * The class names are written out in full so Tailwind finds them.
 */
export const ACCENTS = {
  sky: {
    tile: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    badge: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
    text: 'text-sky-600 dark:text-sky-400'
  },
  emerald: {
    tile: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400'
  },
  amber: {
    tile: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400'
  },
  rose: {
    tile: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    badge: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400'
  },
  violet: {
    tile: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    badge: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    dot: 'bg-violet-500',
    text: 'text-violet-600 dark:text-violet-400'
  },
  teal: {
    tile: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
    badge: 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300',
    dot: 'bg-teal-500',
    text: 'text-teal-600 dark:text-teal-400'
  },
  orange: {
    tile: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
    badge: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
    dot: 'bg-orange-500',
    text: 'text-orange-600 dark:text-orange-400'
  },
  fuchsia: {
    tile: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
    badge: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
    dot: 'bg-fuchsia-500',
    text: 'text-fuchsia-600 dark:text-fuchsia-400'
  },
  indigo: {
    tile: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
    badge: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
    dot: 'bg-indigo-500',
    text: 'text-indigo-600 dark:text-indigo-400'
  }
} satisfies Record<string, Accent>;

/** The name of one accent colour. */
export type AccentName = keyof typeof ACCENTS;

const ACCENT_LIST: Accent[] = Object.values(ACCENTS);

/**
 * Picks a fixed accent colour for a text, so the same tag or title always gets the same colour.
 * @param text - The tag name or entry title.
 */
export function accentFor(text: string): Accent {
  let hash = 0;
  for (const char of text.trim().toLowerCase()) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return ACCENT_LIST[hash % ACCENT_LIST.length];
}
