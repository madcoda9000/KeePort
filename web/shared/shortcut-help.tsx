import { Fragment, useId, useMemo } from 'react';
import { KeyboardIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import messages from '@shared/i18n/messages/shortcuts';
import { useT } from '@shared/i18n/react';
import { isMacPlatform, shortcutKeys, type KeyLabels } from './shortcuts';

/** One line of the overview: what it does, and the shortcuts that do it (alternatives such as "arrowdown" and "j"). */
export interface ShortcutItem {
  keys: string[];
  label: string;
}

/** A titled group of lines in the overview, for example "Entry list". */
export interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

/** Returns the translated key names of the current language. */
function useKeyLabels(): KeyLabels {
  const t = useT(messages);
  return {
    ctrl: t('keyCtrl'),
    shift: t('keyShift'),
    escape: t('keyEscape'),
    enter: t('keyEnter'),
    space: t('keySpace'),
    delete: t('keyDelete')
  };
}

/**
 * Shows one shortcut as keys, for example Ctrl S, or G then D for a sequence.
 * @param props - The shortcut name, such as "mod+s" or "g d".
 */
export function ShortcutKeys({ shortcut }: { shortcut: string }) {
  const t = useT(messages);
  const labels = useKeyLabels();
  const mac = useMemo(/** Checks the platform once. */ () => isMacPlatform(), []);
  const steps = shortcutKeys(shortcut, mac, labels);
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      {steps.map(/**
       * Shows one step of the shortcut.
       * @param keys - The keys pressed together.
       * @param index - The step's position.
       */ (keys, index) => (
        <Fragment key={index}>
          {index > 0 && <span>{t('then')}</span>}
          <KbdGroup>
            {keys.map(/**
             * Shows one key.
             * @param key - The key's name or symbol.
             */ (key) => <Kbd key={key}>{key}</Kbd>)}
          </KbdGroup>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * The overview of all keyboard shortcuts, opened with "?".
 * @param props - Whether it is open, the change handler and the groups to show.
 */
export function ShortcutHelp({ open, onOpenChange, groups }: { open: boolean; onOpenChange: (open: boolean) => void; groups: ShortcutGroup[] }) {
  const t = useT(messages);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
          {groups.map(/**
           * Shows one group of shortcuts.
           * @param group - The group.
           */ (group) => (
            <section key={group.title} className="grid content-start gap-2">
              <h3 className="text-sm font-semibold">{group.title}</h3>
              <dl className="grid gap-1.5">
                {group.items.map(/**
                 * Shows one shortcut line.
                 * @param item - The action and its keys.
                 */ (item) => (
                  <div key={item.label} className="flex items-center justify-between gap-4 border-b border-dashed pb-1.5 text-sm last:border-b-0">
                    <dt>{item.label}</dt>
                    <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {item.keys.map(/**
                       * Shows one alternative shortcut.
                       * @param shortcut - The shortcut name.
                       * @param index - Its position among the alternatives.
                       */ (shortcut, index) => (
                        <Fragment key={shortcut}>
                          {index > 0 && <span className="text-xs text-muted-foreground">{t('or')}</span>}
                          <ShortcutKeys shortcut={shortcut} />
                        </Fragment>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The account setting that turns the keyboard shortcuts on or off; a change is saved at once.
 * @param props - The current value, whether the box is disabled while saving, and the save handler.
 */
export function ShortcutSetting({ enabled, disabled, onSave }: { enabled: boolean; disabled?: boolean; onSave: (enabled: boolean) => void }) {
  const t = useT(messages);
  const id = useId();
  return (
    <Field orientation="horizontal">
      <Checkbox
        id={id}
        checked={enabled}
        disabled={disabled}
        aria-describedby={`${id}-help`}
        onCheckedChange={/**
         * Saves the new choice.
         * @param checked - The new checkbox state.
         */ (checked) => onSave(checked === true)}
      />
      <div className="grid gap-1">
        <FieldLabel htmlFor={id} className="font-normal">{t('setting')}</FieldLabel>
        <FieldDescription id={`${id}-help`}>{t('settingHelp')}</FieldDescription>
      </div>
    </Field>
  );
}

/** The common shortcuts of both apps, as the first group of the overview. */
export function useGeneralShortcuts(): ShortcutGroup {
  const t = useT(messages);
  return {
    title: t('general'),
    items: [
      { keys: ['?'], label: t('showHelp') },
      { keys: ['/'], label: t('focusSearch') },
      { keys: ['escape'], label: t('escape') }
    ]
  };
}

/**
 * A small button with the hint "Press ? for keyboard shortcuts"; a click opens the overview.
 * @param props - What a click does.
 */
export function ShortcutHint({ onOpen }: { onOpen: () => void }) {
  const t = useT(messages);
  return (
    <Button type="button" variant="ghost" size="sm" className="h-7 justify-start gap-2 px-2 text-xs font-normal text-muted-foreground" onClick={onOpen}>
      <KeyboardIcon aria-hidden="true" />
      <span>{t.rich('hint', { key: <Kbd>?</Kbd> })}</span>
    </Button>
  );
}

/**
 * Returns a function that writes a shortcut as plain text for button titles, for example "Shift+L" or "⌘S".
 */
export function useShortcutText(): (shortcut: string) => string {
  const t = useT(messages);
  const labels = useKeyLabels();
  const mac = isMacPlatform();
  /**
   * Writes one shortcut as text.
   * @param shortcut - The shortcut name, such as "shift+l".
   */
  const write = (shortcut: string) => shortcutKeys(shortcut, mac, labels).map(/**
    * Joins the keys of one step.
    * @param keys - The keys pressed together.
    */ (keys) => keys.join(mac ? '' : '+')).join(` ${t('then')} `);
  return write;
}
