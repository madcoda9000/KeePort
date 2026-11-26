import { useRef, useState } from 'react';
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  MAX_PASSPHRASE_WORDS,
  MIN_PASSPHRASE_WORDS,
  PASSPHRASE_SEPARATORS,
  generatePassphrase,
  loadWordlist,
  passphraseEntropyBits,
  type PassphraseOptions,
  type PassphraseSeparator
} from '@/lib/passphrase';
import messages from '@/i18n/password-generator';
import { useT } from '@shared/i18n/react';

type MessageKey = keyof typeof messages.en;

/** The catalog keys of the character group labels. */
const SET_LABELS: Record<CharacterSet, MessageKey> = {
  lower: 'setLower',
  upper: 'setUpper',
  digits: 'setDigits',
  symbols: 'setSymbols'
};

const DEFAULT_OPTIONS: PasswordOptions = { length: 20, sets: ['lower', 'upper', 'digits', 'symbols'], avoidLookAlikes: false };
const DEFAULT_PASSPHRASE: PassphraseOptions = { words: 6, separator: 'hyphen', capitalize: false, addNumber: false };

/** The catalog keys of the separator labels. */
const SEPARATOR_LABELS: Record<PassphraseSeparator, MessageKey> = {
  hyphen: 'separatorHyphen',
  space: 'separatorSpace',
  dot: 'separatorDot',
  underscore: 'separatorUnderscore',
  none: 'separatorNone'
};

/** The catalog keys of the strength names returned by strengthLabel. */
const STRENGTH_LABELS: Record<ReturnType<typeof strengthLabel>, MessageKey> = {
  Weak: 'strengthWeak',
  Fair: 'strengthFair',
  Strong: 'strengthStrong',
  'Very strong': 'strengthVeryStrong'
};

/**
 * A dialog that generates a random password in the browser with the Web Crypto API and hands it to the entry form.
 * @param props - The callback that receives the chosen password and whether the trigger is disabled.
 */
export function PasswordGenerator({ onUse, disabled }: { onUse: (password: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const t = useT(messages);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label={t('generate')} title={t('generate')} disabled={disabled}>
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
  const [mode, setMode] = useState<'password' | 'passphrase'>('password');
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_OPTIONS);
  const [password, setPassword] = useState(/** Generates the first password. */ () => generatePassword(DEFAULT_OPTIONS));
  const [phraseOptions, setPhraseOptions] = useState<PassphraseOptions>(DEFAULT_PASSPHRASE);
  // The latest options, so a passphrase generated when the word list finishes loading uses what the user chose meanwhile.
  const latestPhraseOptions = useRef(DEFAULT_PASSPHRASE);
  const [words, setWords] = useState<readonly string[] | null>(null);
  const [phrase, setPhrase] = useState('');
  const [loadError, setLoadError] = useState(false);
  const t = useT(messages);
  const bits = mode === 'password' ? passwordEntropyBits(options) : words ? passphraseEntropyBits(phraseOptions, words.length) : 0;
  const strength = strengthLabel(bits);
  const value = mode === 'password' ? password : phrase;

  /**
   * Switches between passwords and passphrases and loads the word list the first time it is needed.
   * @param next - The chosen mode.
   */
  function switchMode(next: string) {
    const target = next === 'passphrase' ? 'passphrase' : 'password';
    setMode(target);
    if (target === 'passphrase' && !words) {
      void loadWordlist().then(
        /**
         * Keeps the loaded list and generates the first passphrase.
         * @param list - The EFF Large Wordlist.
         */
        (list) => {
          setWords(list);
          setPhrase(generatePassphrase(latestPhraseOptions.current, list));
        },
        /** Reports that the word list could not be loaded. */
        () => setLoadError(true)
      );
    }
  }

  /**
   * Applies new passphrase options and generates a new passphrase with them.
   * @param next - The changed options.
   */
  function updatePhrase(next: PassphraseOptions) {
    latestPhraseOptions.current = next;
    setPhraseOptions(next);
    if (words) setPhrase(generatePassphrase(next, words));
  }

  /** Generates a new password or passphrase with the current options. */
  function regenerate() {
    if (mode === 'password') setPassword(generatePassword(options));
    else if (words) setPhrase(generatePassphrase(phraseOptions, words));
  }

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
        <DialogTitle>{t('generate')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-5">
        <Tabs value={mode} onValueChange={switchMode}>
          <TabsList className="w-full">
            <TabsTrigger value="password">{t('password')}</TabsTrigger>
            <TabsTrigger value="passphrase">{t('passphrase')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <output aria-label={t('generated')} className="min-w-0 flex-1 font-mono text-sm break-all">
            {value || (loadError ? t('loadFailed') : t('loadingWords'))}
          </output>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('generateAnotherLabel')} title={t('generateAnother')} disabled={!value} onClick={regenerate}>
            <RefreshCwIcon />
          </Button>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('strength')}</span>
          <Badge variant={strength === 'Weak' ? 'destructive' : 'secondary'}>{t('strengthBits', { strength: t(STRENGTH_LABELS[strength]), bits })}</Badge>
        </div>
        {mode === 'password' ? (
        <>
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="generator-length">{t('length')}</Label>
            <span className="text-sm tabular-nums">{options.length}</span>
          </div>
          <Slider
            id="generator-length"
            aria-label={t('passwordLength')}
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
          <legend className="mb-1 text-sm font-medium">{t('characters')}</legend>
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
              <Label htmlFor={`generator-${set}`} className="font-normal">{t(SET_LABELS[set])}</Label>
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
            <Label htmlFor="generator-look-alikes" className="font-normal">{t('avoidLookAlikes')}</Label>
          </div>
        </fieldset>
        </>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="generator-words">{t('words')}</Label>
                <span className="text-sm tabular-nums">{phraseOptions.words}</span>
              </div>
              <Slider
                id="generator-words"
                aria-label={t('wordCount')}
                min={MIN_PASSPHRASE_WORDS}
                max={MAX_PASSPHRASE_WORDS}
                step={1}
                value={[phraseOptions.words]}
                onValueChange={/**
                 * Applies the chosen number of words.
                 * @param next - The slider values; the first one is the number of words.
                 */ (next) => updatePhrase({ ...phraseOptions, words: next[0] })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="generator-separator">{t('separator')}</Label>
              <NativeSelect
                id="generator-separator"
                value={phraseOptions.separator}
                onChange={/**
                 * Applies the chosen separator.
                 * @param event - The select change event.
                 */ (event) => updatePhrase({ ...phraseOptions, separator: event.target.value as PassphraseSeparator })}
              >
                {(Object.keys(PASSPHRASE_SEPARATORS) as PassphraseSeparator[]).map(/**
                 * Renders one separator option.
                 * @param separator - One separator.
                 */ (separator) => <NativeSelectOption key={separator} value={separator}>{t(SEPARATOR_LABELS[separator])}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="generator-capitalize"
                checked={phraseOptions.capitalize}
                onCheckedChange={/**
                 * Sets whether words start with a capital letter.
                 * @param checked - The new checkbox state.
                 */ (checked) => updatePhrase({ ...phraseOptions, capitalize: checked === true })}
              />
              <Label htmlFor="generator-capitalize" className="font-normal">{t('capitalize')}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="generator-number"
                checked={phraseOptions.addNumber}
                onCheckedChange={/**
                 * Sets whether a digit is added.
                 * @param checked - The new checkbox state.
                 */ (checked) => updatePhrase({ ...phraseOptions, addNumber: checked === true })}
              />
              <Label htmlFor="generator-number" className="font-normal">{t('addNumber')}</Label>
            </div>
            <p className="text-xs text-muted-foreground">{t('wordlistCredit')}</p>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button type="button" disabled={!value} onClick={/** Uses the generated password or passphrase. */ () => onUse(value)}>
          {mode === 'password' ? t('usePassword') : t('usePassphrase')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
