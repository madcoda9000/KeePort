import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import messages from '@/i18n/copy-button';
import { ShortcutKeys } from '@shared/shortcut-help';
import { useT } from '@shared/i18n/react';

/**
 * A small copy button with a tooltip. It resolves the value only when clicked (e.g. the current TOTP code), shows a
 * check mark for a moment after copying and never opens the row it sits in.
 * @param props - The accessible label, the tooltip text, the value provider and the copy callback, plus a disabled flag
 *   and the keyboard shortcut that copies the same value.
 */
export function CopyButton({
  label,
  tooltip,
  getValue,
  onCopy,
  disabled,
  shortcut
}: {
  label: string;
  tooltip?: string;
  getValue: () => string | Promise<string>;
  onCopy: (value: string) => Promise<boolean>;
  disabled?: boolean;
  /** The keyboard shortcut shown in the tooltip, for example "p". */
  shortcut?: string;
}) {
  const [copied, setCopied] = useState(false);
  const t = useT(messages);

  /** Resets the check mark shortly after a successful copy. */
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(/** Shows the copy icon again. */ () => setCopied(false), 1500);
    return /** Cancels the reset when the button unmounts. */ () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={label}
          disabled={disabled}
          onClick={/**
           * Copies the value without letting the click reach the row.
           * @param event - The click event.
           */ async (event) => {
            event.stopPropagation();
            if (await onCopy(await getValue())) setCopied(true);
          }}
        >
          {copied ? <CheckIcon className="text-emerald-600 dark:text-emerald-400" /> : <CopyIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {copied ? t('copied') : tooltip ?? t('copyToClipboard')}
        {shortcut && !copied && <ShortcutKeys shortcut={shortcut} />}
      </TooltipContent>
    </Tooltip>
  );
}
