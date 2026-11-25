import { useState } from 'react';
import { RefreshCwIcon, WandSparklesIcon } from 'lucide-react';
import {
  CHARACTER_SETS,
  MIN_PASSWORD_LENGTH,
  generatePassword,
  passwordEntropyBits,
  strengthLabel,
  type CharacterSet,
  type PasswordOptions
} from '@/lib/password';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

const SET_LABELS: Record<CharacterSet, string> = {
  lower: 'Lowercase (a–z)',
  upper: 'Uppercase (A–Z)',
  digits: 'Digits (0–9)',
  symbols: 'Symbols (!#$…)'
};

const DEFAULT_OPTIONS: PasswordOptions = { length: 20, sets: ['lower', 'upper', 'digits', 'symbols'], avoidLookAlikes: false };

/**
 * A dialog that generates a random password in the browser with the Web Crypto API and hands it to the entry form.
 * @param props - The callback that receives the chosen password and whether the trigger is disabled.
 */
export function PasswordGenerator({ onUse, disabled }: { onUse: (password: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label="Generate password" title="Generate password" disabled={disabled}>
          <WandSparklesIcon />
        </Button>
      </DialogTrigger>
      {open && (
        <GeneratorForm
          onUse={/**
           * Passes the password on and closes the dialog.
           * @param password - The generated password.
           */ (password) => {
            onUse(password);
            setOpen(false);
          }}
        />
      )}
    </Dialog>
  );
}

/**
 * The generator options and preview; remounted on every opening so a fresh password is shown.
 * @param props - The callback that receives the chosen password.
 */
function GeneratorForm({ onUse }: { onUse: (password: string) => void }) {
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_OPTIONS);
  const [password, setPassword] = useState(/** Generates the first password. */ () => generatePassword(DEFAULT_OPTIONS));
  const bits = passwordEntropyBits(options);
  const strength = strengthLabel(bits);

  /**
   * Applies new options and generates a new password with them.
   * @param next - The changed options.
   */
  function update(next: PasswordOptions) {
    setOptions(next);
    if (next.sets.length) setPassword(generatePassword(next));
  }

  /**
   * Adds or removes a character group, keeping at least one.
   * @param set - The group to toggle.
   * @param checked - Whether the group should be used.
   */
  function toggleSet(set: CharacterSet, checked: boolean) {
    const sets = checked ? [...options.sets, set] : options.sets.filter(/**
     * Removes the group.
     * @param item - One chosen group.
     */ (item) => item !== set);
    if (sets.length) update({ ...options, sets });
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Generate password</DialogTitle>
        <DialogDescription>Generated in your browser with a cryptographically secure random source.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-5">
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <output aria-label="Generated password" className="min-w-0 flex-1 font-mono text-sm break-all">{password}</output>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Generate another password" title="Generate another" onClick={/** Generates a new password with the same options. */ () => setPassword(generatePassword(options))}>
            <RefreshCwIcon />
          </Button>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Strength</span>
          <Badge variant={strength === 'Weak' ? 'destructive' : 'secondary'}>{strength} · {bits} bits</Badge>
        </div>
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="generator-length">Length</Label>
            <span className="text-sm tabular-nums">{options.length}</span>
          </div>
          <Slider
            id="generator-length"
            aria-label="Password length"
            min={MIN_PASSWORD_LENGTH}
            max={64}
            step={1}
            value={[options.length]}
            onValueChange={/**
             * Applies the chosen length.
             * @param value - The slider values; the first one is the length.
             */ (value) => update({ ...options, length: value[0] })}
          />
        </div>
        <fieldset className="grid gap-2.5">
          <legend className="mb-1 text-sm font-medium">Characters</legend>
          {(Object.keys(CHARACTER_SETS) as CharacterSet[]).map(/**
           * Renders the checkbox of one character group.
           * @param set - The character group.
           */ (set) => (
            <div key={set} className="flex items-center gap-2">
              <Checkbox
                id={`generator-${set}`}
                checked={options.sets.includes(set)}
                disabled={options.sets.length === 1 && options.sets.includes(set)}
                onCheckedChange={/**
                 * Adds or removes the group.
                 * @param checked - The new checkbox state.
                 */ (checked) => toggleSet(set, checked === true)}
              />
              <Label htmlFor={`generator-${set}`} className="font-normal">{SET_LABELS[set]}</Label>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Checkbox
              id="generator-look-alikes"
              checked={options.avoidLookAlikes}
              onCheckedChange={/**
               * Sets whether look-alike characters are left out.
               * @param checked - The new checkbox state.
               */ (checked) => update({ ...options, avoidLookAlikes: checked === true })}
            />
            <Label htmlFor="generator-look-alikes" className="font-normal">Avoid look-alikes (I, l, 1, O, 0)</Label>
          </div>
        </fieldset>
      </div>
      <DialogFooter>
        <Button type="button" onClick={/** Uses the generated password. */ () => onUse(password)}>Use password</Button>
      </DialogFooter>
    </DialogContent>
  );
}
