import { useEffect, useRef } from 'react';
import { NO_SEQUENCE, isMacPlatform, matchShortcut, type ShortcutState } from './shortcuts';

/**
 * What a shortcut does. Returning false means the shortcut did not apply at the moment (for example "p" without a
 * marked entry); the key press then keeps its normal effect.
 */
export type ShortcutHandler = (event: KeyboardEvent) => boolean | void;

/**
 * Listens for keyboard shortcuts on the whole page while enabled. The handlers may change on every render; the
 * listener always calls the current ones.
 * @param handlers - The shortcuts by name, for example { '/': focusSearch, 'mod+s': save, 'g d': openDashboard }.
 * @param enabled - Whether the shortcuts are active, for example from the account setting.
 */
export function useShortcuts(handlers: Record<string, ShortcutHandler>, enabled: boolean) {
  const current = useRef(handlers);
  /** Keeps the newest handlers for the listener. */
  useEffect(() => {
    current.current = handlers;
  });

  /** Registers one keydown listener while the shortcuts are enabled. */
  useEffect(() => {
    if (!enabled) return;
    const mac = isMacPlatform();
    let state: ShortcutState = NO_SEQUENCE;
    /**
     * Runs the shortcut a key press triggers.
     * @param event - The key press.
     */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const result = matchShortcut(event, Object.keys(current.current), state, Date.now(), mac);
      state = result.state;
      if (result.started) {
        event.preventDefault();
        return;
      }
      if (!result.match) return;
      const handled = current.current[result.match]?.(event);
      if (handled !== false) event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return /** Removes the listener. */ () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/**
 * Tells whether a dialog, sheet or menu is open, so shortcuts of the page behind it stay quiet.
 * @param except - An element whose dialog does not count, for example the open entry sheet.
 */
export function overlayOpen(except?: Element | null): boolean {
  const open = document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [data-slot="popover-content"][data-state="open"]');
  return Array.from(open).some(/**
   * Checks whether an overlay is not the excepted one.
   * @param element - One open overlay.
   */ (element) => !except || !except.contains(element));
}

/**
 * Empties a search box that React controls: sets the value the way typing does and sends an input event, so the
 * page's own change handler runs.
 * @param input - The search box.
 */
export function clearSearchField(input: HTMLInputElement) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
