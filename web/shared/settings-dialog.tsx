import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import messages from '@shared/i18n/messages/settings-dialog';
import { useT } from '@shared/i18n/react';

/** One area of the account settings, shown when its menu entry is chosen. */
export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
  content: ReactNode;
}

/**
 * The content of a large settings window: a menu of areas on the left (a row on narrow screens) and the chosen area
 * on the right, which scrolls on its own. Put it inside a shadcn Dialog.
 * @param props - The window title and description, the areas, and a message shown above every area.
 */
export function SettingsDialogContent({
  title,
  description,
  sections,
  message
}: {
  title: string;
  description: ReactNode;
  sections: SettingsSection[];
  message?: ReactNode;
}) {
  const t = useT(messages);
  const [activeId, setActiveId] = useState(sections[0]?.id);
  const active = sections.find(/**
   * Finds the chosen area.
   * @param section - One area.
   */ (section) => section.id === activeId) ?? sections[0];

  return (
    <DialogContent className="flex h-[min(46rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
      <DialogHeader className="border-b px-6 py-4 text-start">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label={t('sections')} className="flex shrink-0 gap-1 overflow-x-auto border-b bg-muted/30 p-2 md:w-56 md:flex-col md:border-e md:border-b-0 md:p-3">
          {sections.map(/**
           * Shows the menu entry of one area.
           * @param section - The area.
           */ (section) => {
            const Icon = section.icon;
            const current = section.id === active?.id;
            return (
              <Button
                key={section.id}
                type="button"
                variant="ghost"
                aria-current={current ? 'page' : undefined}
                className={cn('shrink-0 justify-start gap-2 md:h-auto md:min-h-8 md:py-1.5 md:text-start md:whitespace-normal', current && 'bg-accent text-accent-foreground')}
                onClick={/** Shows this area. */ () => setActiveId(section.id)}
              >
                <Icon className={cn(current && 'text-primary')} /> {section.label}
              </Button>
            );
          })}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid max-w-xl gap-6 px-6 py-5">
            <h2 className="text-lg font-semibold">{active?.label}</h2>
            {message}
            {active?.content}
          </div>
        </div>
      </div>
    </DialogContent>
  );
}
