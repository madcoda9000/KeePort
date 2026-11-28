import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import messages from '@/i18n/settings-sections';
import { cn } from '@/lib/utils';
import { useT } from '@shared/i18n/react';

/** One area of the settings page, shown when its menu entry is chosen. */
export interface SettingsArea {
  id: string;
  label: string;
  icon: LucideIcon;
  content: ReactNode;
}

/**
 * The settings page of the admin console: a menu of areas on the left (a scrolling row on narrow screens) and only the
 * chosen area on the right, so the page stays short and each area stands on its own.
 * @param props - The areas, the chosen area's ID and what choosing another area does.
 */
export function SettingsLayout({ areas, activeId, onSelect }: { areas: SettingsArea[]; activeId: string; onSelect: (id: string) => void }) {
  const t = useT(messages);
  const active = areas.find(/**
   * Finds the chosen area.
   * @param area - One area.
   */ (area) => area.id === activeId) ?? areas[0];
  return (
    <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
      <nav
        aria-label={t('sections')}
        className="flex shrink-0 gap-1 overflow-x-auto rounded-xl border bg-card p-2 lg:sticky lg:top-20 lg:w-60 lg:flex-col"
      >
        {areas.map(/**
         * Shows the menu entry of one area.
         * @param area - The area.
         */ (area) => {
          const Icon = area.icon;
          const current = area.id === active?.id;
          return (
            <Button
              key={area.id}
              type="button"
              variant="ghost"
              aria-current={current ? 'page' : undefined}
              className={cn('shrink-0 justify-start gap-2 lg:h-auto lg:min-h-8 lg:py-1.5 lg:text-start lg:whitespace-normal', current && 'bg-accent text-accent-foreground')}
              onClick={/** Shows this area. */ () => onSelect(area.id)}
            >
              <Icon className={cn(current && 'text-primary')} /> {area.label}
            </Button>
          );
        })}
      </nav>
      <div className="grid min-w-0 flex-1 gap-6 *:data-[slot=card]:max-w-4xl">{active?.content}</div>
    </div>
  );
}
