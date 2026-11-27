/**
 * Keyboard shortcuts of both apps, without React: turns a key press into a shortcut name such as "p", "shift+l",
 * "mod+s" or the sequence "g d", and decides which presses are left to input fields, buttons and menus.
 */

/** The parts of a keyboard event the matching needs; a real KeyboardEvent fits. */
export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  target: EventTarget | null;
}

/** The first key of a two-key sequence such as "g d", and when it was pressed. */
export interface ShortcutState {
  pending: string | null;
  pendingAt: number;
}

/** What a key press means for a set of shortcuts. */
export interface ShortcutMatch {
  /** The shortcut that was pressed, or null. */
  match: string | null;
  /** True when the press started a sequence and should not do anything else. */
  started: boolean;
  /** The state for the next key press. */
  state: ShortcutState;
}

/** How long the second key of a sequence such as "g d" may take, in milliseconds. */
export const SEQUENCE_TIMEOUT = 1000;

/** The state before any key was pressed. */
export const NO_SEQUENCE: ShortcutState = { pending: null, pendingAt: 0 };

/** Shortcuts that also work while the cursor is in an input field. */
const WHILE_TYPING = new Set(['mod+s', 'mod+k']);

/** Keys that buttons, links and checkboxes use themselves while they have the focus. */
const ACTIVATION_KEYS = new Set(['enter', 'space']);

/** Keys that menus, tabs, lists and sliders use themselves while they have the focus. */
const ARROW_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

/** Names for keys whose KeyboardEvent.key is a word or a blank. */
const KEY_NAMES: Record<string, string> = {
  ' ': 'space',
  Spacebar: 'space',
  Escape: 'escape',
  Esc: 'escape',
  Enter: 'enter',
  Delete: 'delete',
  Del: 'delete',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
  Up: 'arrowup',
  Down: 'arrowdown'
};

/**
 * Tells whether the platform uses ⌘ instead of Ctrl for shortcuts.
 * @param userAgent - The browser's user agent; defaults to the current browser.
 */
export function isMacPlatform(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return /Mac|iPhone|iPad|iPod/.test(userAgent);
}

/**
 * Checks whether an element takes text input, so single-key shortcuts must not fire there.
 * @param target - The element that has the focus.
 */
export function isTextTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return Boolean(element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

/**
 * Checks whether an element uses Enter or Space itself: buttons, links, checkboxes and the items of menus and lists.
 * @param target - The element that has the focus.
 */
export function isControlTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  return Boolean((target as Element).closest(
    'button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"], [role="radio"], [role="treeitem"]'
  ));
}

/**
 * Checks whether an element moves with the arrow keys itself: menus, tabs, lists, radio groups, sliders and trees.
 * Plain buttons do not, so the arrow keys still move through the entry list when a button in it has the focus.
 * @param target - The element that has the focus.
 */
export function isArrowTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  return Boolean((target as Element).closest(
    '[role="menu"], [role="menubar"], [role="menuitem"], [role="tablist"], [role="tab"], [role="listbox"], [role="option"], [role="radiogroup"], [role="slider"], [role="tree"], [role="combobox"]'
  ));
}

/**
 * Turns a key press into the name used in shortcut lists: "p", "?", "shift+l", "mod+s" (Ctrl, or ⌘ on a Mac),
 * "escape", "arrowdown". Returns null for presses no shortcut uses, such as Alt combinations or the other
 * modifier of the platform.
 * @param input - The key press.
 * @param mac - Whether ⌘ is the modifier for shortcuts.
 */
export function keyName(input: KeyInput, mac: boolean): string | null {
  if (input.altKey || input.isComposing) return null;
  const mod = mac ? input.metaKey : input.ctrlKey;
  const otherMod = mac ? input.ctrlKey : input.metaKey;
  if (otherMod) return null;
  const named = KEY_NAMES[input.key];
  const base = named ?? (input.key.length === 1 ? input.key.toLowerCase() : null);
  if (!base) return null;
  if (mod) return `mod+${base}`;
  // Letters and named keys keep Shift; for symbols such as "?" or "/" Shift is part of the keyboard layout.
  if (input.shiftKey && (named || /^[a-z]$/.test(base))) return `shift+${base}`;
  return base;
}

/**
 * Finds the shortcut a key press triggers. Single keys are ignored in input fields; Enter and Space are left to
 * buttons, links and checkboxes that have the focus, the arrow keys to menus, tabs and lists. A key that starts a sequence such as "g d" is remembered
 * for one second.
 * @param input - The key press.
 * @param shortcuts - The shortcut names that are active, for example ["/", "p", "mod+s", "g d"].
 * @param state - The state returned for the previous key press.
 * @param now - The time of the key press in milliseconds.
 * @param mac - Whether ⌘ is the modifier for shortcuts.
 */
export function matchShortcut(input: KeyInput, shortcuts: readonly string[], state: ShortcutState, now: number, mac: boolean): ShortcutMatch {
  const name = keyName(input, mac);
  if (!name) return { match: null, started: false, state: NO_SEQUENCE };
  const typing = isTextTarget(input.target);
  if (typing && !WHILE_TYPING.has(name)) return { match: null, started: false, state: NO_SEQUENCE };
  if (ACTIVATION_KEYS.has(name) && isControlTarget(input.target)) return { match: null, started: false, state: NO_SEQUENCE };
  if (ARROW_KEYS.has(name) && isArrowTarget(input.target)) return { match: null, started: false, state: NO_SEQUENCE };
  if (state.pending && now - state.pendingAt <= SEQUENCE_TIMEOUT) {
    const sequence = `${state.pending} ${name}`;
    if (shortcuts.includes(sequence)) return { match: sequence, started: false, state: NO_SEQUENCE };
  }
  const startsSequence = shortcuts.some(/**
   * Checks whether a shortcut is a sequence that starts with this key.
   * @param shortcut - One active shortcut.
   */ (shortcut) => shortcut.startsWith(`${name} `));
  if (startsSequence) return { match: null, started: true, state: { pending: name, pendingAt: now } };
  return { match: shortcuts.includes(name) ? name : null, started: false, state: NO_SEQUENCE };
}

/** The translated names of keys that are words, for the overview. */
export interface KeyLabels {
  ctrl: string;
  shift: string;
  escape: string;
  enter: string;
  space: string;
  delete: string;
}

/**
 * Splits a shortcut into the keys to show, for example "mod+s" into ["Ctrl", "S"] or ["⌘", "S"] and "g d" into
 * [["G"], ["D"]]: one list per step of a sequence.
 * @param shortcut - The shortcut name.
 * @param mac - Whether ⌘ is the modifier for shortcuts.
 * @param labels - The translated key names.
 */
export function shortcutKeys(shortcut: string, mac: boolean, labels: KeyLabels): string[][] {
  const symbols: Record<string, string> = {
    mod: mac ? '⌘' : labels.ctrl,
    shift: mac ? '⇧' : labels.shift,
    escape: labels.escape,
    enter: labels.enter,
    space: labels.space,
    delete: labels.delete,
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→'
  };
  return shortcut.split(' ').map(/**
   * Splits one step of a sequence into its keys.
   * @param step - For example "mod+s".
   */ (step) => step.split('+').map(/**
    * Names one key.
    * @param key - For example "mod" or "s".
    */ (key) => symbols[key] ?? key.toUpperCase()));
}
