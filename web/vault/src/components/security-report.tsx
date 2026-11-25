import { CalendarX2Icon, CopyXIcon, DatabaseZapIcon, HourglassIcon, KeyRoundIcon, RefreshCwIcon, ShieldAlertIcon, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SecurityIssue, SecurityReport } from '@/lib/security-report';
import { cn } from '@/lib/utils';

const CHECKS: readonly { issue: SecurityIssue; title: string; description: string; icon: LucideIcon }[] = [
  { issue: 'weak', title: 'Weak', description: 'Short, common or patterned passwords', icon: ShieldAlertIcon },
  { issue: 'reused', title: 'Reused', description: 'The same password in several entries', icon: CopyXIcon },
  { issue: 'old', title: 'Old', description: 'Password not changed for over a year', icon: HourglassIcon },
  { issue: 'empty', title: 'Empty', description: 'Username but no password', icon: KeyRoundIcon },
  { issue: 'expired', title: 'Expired', description: 'Expiry date has passed', icon: CalendarX2Icon },
  { issue: 'breached', title: 'Breached', description: 'Found in known data breaches', icon: DatabaseZapIcon }
];

/** The state of the opt-in "Have I Been Pwned" check. */
export interface BreachCheckState {
  /** Whether the user turned the check on in the account settings. */
  enabled: boolean;
  status: 'idle' | 'checking' | 'done' | 'error';
  done: number;
  total: number;
  error: string | null;
}

/**
 * Shows one tile per check of the security report with the number of affected entries. Clicking a tile filters the
 * entry list to that check; clicking the active tile shows all findings again.
 * @param props - The report, the active check (null for all findings) and the callback that changes it.
 */
export function SecurityReportTiles({
  report,
  active,
  onSelect,
  breach,
  onCheckBreaches,
  onOpenSettings
}: {
  report: SecurityReport;
  active: SecurityIssue | null;
  onSelect: (issue: SecurityIssue | null) => void;
  breach: BreachCheckState;
  onCheckBreaches: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="grid gap-3 px-4 pt-4 sm:px-6">
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label="Security checks">
      {CHECKS.map(/**
       * Renders the tile of one check.
       * @param check - The check with its title, description and icon.
       */ (check) => {
        const count = report.issues[check.issue].size;
        const selected = active === check.issue;
        const breachUnknown = check.issue === 'breached' && (!breach.enabled || breach.status !== 'done');
        const Icon = check.icon;
        return (
          <button
            key={check.issue}
            type="button"
            aria-pressed={selected}
            className={cn(
              'grid gap-1 rounded-xl border p-3 text-start transition-colors outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50',
              selected && 'border-primary bg-muted'
            )}
            onClick={/** Filters the list by this check, or shows all findings when it is already active. */ () => onSelect(selected ? null : check.issue)}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Icon className={cn('size-4', breachUnknown ? 'text-muted-foreground' : count > 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400')} />
              {check.title}
            </span>
            <span className={cn('text-2xl font-semibold tabular-nums', (count === 0 || breachUnknown) && 'text-muted-foreground')}>
              {check.issue === 'breached' && !breach.enabled ? 'Off' : check.issue === 'breached' && breach.status === 'checking' ? `${breach.done}/${breach.total}` : breachUnknown ? '–' : count}
            </span>
            <span className="text-xs text-muted-foreground">{check.description}</span>
          </button>
        );
      })}
    </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        {breach.enabled ? (
          <>
            <span>
              {breach.status === 'checking'
                ? `Checking passwords against Have I Been Pwned… ${breach.done} of ${breach.total}`
                : breach.status === 'error'
                  ? `The breach check failed: ${breach.error ?? 'unknown error'}`
                  : breach.status === 'done'
                    ? 'Checked against Have I Been Pwned. Only the first 5 characters of each password hash were sent.'
                    : 'The breach check runs when you open this report.'}
            </span>
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={breach.status === 'checking'} onClick={onCheckBreaches}>
              <RefreshCwIcon /> Check again
            </Button>
          </>
        ) : (
          <>
            <span>The check against known data breaches (Have I Been Pwned) is off.</span>
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onOpenSettings}>Turn it on in your profile</Button>
          </>
        )}
      </div>
    </div>
  );
}
