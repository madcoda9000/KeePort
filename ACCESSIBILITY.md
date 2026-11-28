# Accessibility

KeePort should be usable by everyone who manages passwords with it — with a mouse, the keyboard, a screen reader or voice control. This page describes what is in place, where the gaps are and how to tell us about a barrier.

## Our goal

We aim for the web vault and the admin console to meet the [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/) at level AA. KeePort has **not been audited** against them yet, so this is a goal, not a claim of conformance.

## What is in place

- **Built on accessible components.** The interface uses [shadcn/ui](https://ui.shadcn.com/) on top of Radix UI, so dialogs, menus, tabs, checkboxes and tooltips come with keyboard support, focus handling and ARIA roles.
- **Labels for screen readers.** Icon-only buttons are named after what they do and for which entry, for example "Copy password of GitHub". Notices such as "Vault saved." are announced through live regions.
- **Keyboard use.** The interface is built to be used with the keyboard alone; anything that cannot be reached this way is a bug. Optional shortcuts make frequent tasks faster: `/` to search, arrow keys in the entry list, `U`, `P` and `T` to copy, `Ctrl+S` to save, `Shift+L` to lock, `Ctrl+K` for the command palette and `?` for the overview.
- **Shortcuts can be turned off** per user under **Profile → Account**, so single keys do not get in the way of voice control or screen readers.
- **Light and dark appearance.** It follows the operating system and can be switched by hand.
- **Zoom and small screens.** Text sizes use relative units, so browser zoom and larger font settings work. The layout adapts down to phone width.
- **Three languages.** English, German and French, chosen automatically from the browser or by hand. Long translations are checked so that labels wrap instead of being cut off.
- **Adjustable time limits.** The time until a vault locks itself (1 to 1440 minutes) and until copied secrets are cleared from the clipboard can be set per user.

## Supported environments

- Current versions of Firefox, Chrome, Edge and Safari on desktop and mobile.
- KeePass apps that connect through WebDAV (for example KeePass2Android or KeePassium) bring their own accessibility features; KeePort does not change them.

## Known limitations

- No systematic test with screen readers (NVDA, JAWS, VoiceOver, TalkBack) has been done yet.
- There is no "Skip to content" link.
- Animations of dialogs and menus do not yet react to the system setting to reduce motion.
- Windows high-contrast mode (forced colors) has not been checked.
- Unlocking a vault needs the master password or a key file — this is how KeePass works. Passkeys can replace the account password, not the master password.

## Report a barrier

If something is hard or impossible to use, please [open an issue](https://github.com/madcoda9000/KeePort/issues/new/choose) with the bug report form and start its title with "Accessibility". Tell us:

- what you tried to do and where (web vault or admin console),
- the browser and assistive technology you use, with versions,
- what happened instead.

Accessibility problems are treated as bugs. If you would rather not report publicly, you can use the [private report](https://github.com/madcoda9000/KeePort/security/advisories/new) and start its title with "Accessibility".
