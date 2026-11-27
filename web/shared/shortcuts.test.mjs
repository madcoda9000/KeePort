import assert from 'node:assert/strict';
import test from 'node:test';
import { NO_SEQUENCE, isMacPlatform, keyName, matchShortcut, shortcutKeys } from './shortcuts.ts';

/**
 * Builds a fake element for the matcher: closest() answers by tag name and role.
 * @param tag - The element's tag name.
 * @param attributes - Its role or contenteditable state.
 */
function element(tag, attributes = {}) {
  return {
    tagName: tag.toUpperCase(),
    isContentEditable: attributes.contenteditable === 'true',
    /**
     * Matches the element itself against a selector list.
     * @param selector - A comma-separated list of tag names and [role="…"] selectors.
     */
    closest(selector) {
      const parts = selector.split(',').map(/**
       * Trims one selector.
       * @param part - One selector.
       */ (part) => part.trim());
      const hit = parts.some(/**
       * Checks one selector against the tag and role.
       * @param part - One selector.
       */ (part) => part === tag || part.startsWith(`${tag}[`) || (attributes.role && part === `[role="${attributes.role}"]`));
      return hit ? this : null;
    }
  };
}

/**
 * Builds a key press.
 * @param key - KeyboardEvent.key.
 * @param options - Modifiers and the target element.
 */
function press(key, options = {}) {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: element('body'), ...options };
}

const SHORTCUTS = ['/', '?', 'p', 'shift+l', 'mod+s', 'mod+k', 'g d', 'g u', 'arrowdown', 'enter', 'escape'];

/** Names keys with modifiers the same way on every platform. */
test('names key presses', () => {
  assert.equal(keyName(press('P'), false), 'p');
  assert.equal(keyName(press('L', { shiftKey: true }), false), 'shift+l');
  assert.equal(keyName(press('?', { shiftKey: true }), false), '?');
  assert.equal(keyName(press('s', { ctrlKey: true }), false), 'mod+s');
  assert.equal(keyName(press('s', { metaKey: true }), true), 'mod+s');
  assert.equal(keyName(press('s', { metaKey: true }), false), null, 'the Windows key is not a modifier for shortcuts');
  assert.equal(keyName(press('s', { ctrlKey: true }), true), null, 'Ctrl on a Mac is not ⌘');
  assert.equal(keyName(press('p', { altKey: true }), false), null);
  assert.equal(keyName(press(' '), false), 'space');
  assert.equal(keyName(press('ArrowDown'), false), 'arrowdown');
  assert.equal(keyName(press('Shift', { shiftKey: true }), false), null);
});

/** Ignores single keys in input fields but keeps Ctrl+S and Ctrl+K there. */
test('leaves typing alone', () => {
  const input = element('input');
  assert.equal(matchShortcut(press('p', { target: input }), SHORTCUTS, NO_SEQUENCE, 0, false).match, null);
  assert.equal(matchShortcut(press('/', { target: element('textarea') }), SHORTCUTS, NO_SEQUENCE, 0, false).match, null);
  assert.equal(matchShortcut(press('p', { target: element('div', { contenteditable: 'true' }) }), SHORTCUTS, NO_SEQUENCE, 0, false).match, null);
  assert.equal(matchShortcut(press('s', { ctrlKey: true, target: input }), SHORTCUTS, NO_SEQUENCE, 0, false).match, 'mod+s');
  assert.equal(matchShortcut(press('k', { ctrlKey: true, target: input }), SHORTCUTS, NO_SEQUENCE, 0, false).match, 'mod+k');
  assert.equal(matchShortcut(press('p'), SHORTCUTS, NO_SEQUENCE, 0, false).match, 'p');
});

/** Leaves Enter and Space to focused buttons, arrows to focused menus, but not other keys. */
test('leaves control keys to focused controls', () => {
  const button = element('button');
  assert.equal(matchShortcut(press('Enter', { target: button }), SHORTCUTS, NO_SEQUENCE, 0, false).match, null);
  assert.equal(matchShortcut(press('ArrowDown', { target: element('div', { role: 'menu' }) }), SHORTCUTS, NO_SEQUENCE, 0, false).match, null);
  assert.equal(matchShortcut(press('p', { target: button }), SHORTCUTS, NO_SEQUENCE, 0, false).match, 'p');
  assert.equal(matchShortcut(press('Enter'), SHORTCUTS, NO_SEQUENCE, 0, false).match, 'enter');
  assert.equal(matchShortcut(press('ArrowDown', { target: button }), SHORTCUTS, NO_SEQUENCE, 0, false).match, 'arrowdown', 'a plain button does not use the arrows');
});

/** Recognizes two-key sequences within one second. */
test('matches sequences', () => {
  const first = matchShortcut(press('g'), SHORTCUTS, NO_SEQUENCE, 1000, false);
  assert.equal(first.match, null);
  assert.equal(first.started, true);
  assert.equal(matchShortcut(press('d'), SHORTCUTS, first.state, 1800, false).match, 'g d');
  assert.equal(matchShortcut(press('d'), SHORTCUTS, first.state, 2500, false).match, null, 'too late');
  assert.equal(matchShortcut(press('p'), SHORTCUTS, first.state, 1200, false).match, 'p', 'another key runs its own shortcut');
  assert.equal(matchShortcut(press('x'), SHORTCUTS, NO_SEQUENCE, 0, false).match, null);
});

/** Shows keys with the platform's names. */
test('describes shortcuts for the overview', () => {
  const labels = { ctrl: 'Strg', shift: 'Umschalt', escape: 'Esc', enter: 'Eingabe', space: 'Leertaste', delete: 'Entf' };
  assert.deepEqual(shortcutKeys('mod+s', false, labels), [['Strg', 'S']]);
  assert.deepEqual(shortcutKeys('mod+s', true, labels), [['⌘', 'S']]);
  assert.deepEqual(shortcutKeys('shift+l', false, labels), [['Umschalt', 'L']]);
  assert.deepEqual(shortcutKeys('g d', false, labels), [['G'], ['D']]);
  assert.deepEqual(shortcutKeys('arrowdown', false, labels), [['↓']]);
  assert.deepEqual(shortcutKeys('?', false, labels), [['?']]);
  assert.equal(isMacPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1)'), true);
  assert.equal(isMacPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), false);
});
