const storageKey = 'keeport-theme';

/** Reads the saved appearance or falls back to the OS preference. */
function initialTheme(): 'light' | 'dark' {
  const saved = localStorage.getItem(storageKey);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Applies the shadcn dark-mode class and tells native controls which palette to use.
 * @param theme - The light or dark theme to apply to the document.
 */
function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

/** Returns the palette currently applied to the document. */
export function getTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Switches palettes and keeps the choice for future visits. */
export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(storageKey, next);
  return next;
}

applyTheme(initialTheme());
