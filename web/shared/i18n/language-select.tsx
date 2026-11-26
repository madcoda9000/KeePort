import { LanguagesIcon } from 'lucide-react';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { applyPreference, browserLanguage, isLanguage, LANGUAGE_NAMES, LANGUAGES, storedPreference, type LanguagePreference } from './core.ts';
import messages from './messages/language.ts';
import { useLanguage, useT } from './react.tsx';

/**
 * A compact language menu for the sign-in pages. The choice is stored in this browser until the user signs in; after
 * sign-in the language stored on the account wins.
 */
export function LanguageMenu() {
  const t = useT(messages);
  const language = useLanguage();
  return (
    <div className="flex items-center gap-1.5">
      <LanguagesIcon aria-hidden="true" className="size-4 text-muted-foreground" />
      <NativeSelect
        size="sm"
        aria-label={t('label')}
        value={language}
        onChange={/**
         * Applies and stores the chosen language.
         * @param event - The select change event.
         */ (event) => {
          if (isLanguage(event.target.value)) applyPreference(event.target.value);
        }}
      >
        {LANGUAGES.map(/**
         * Renders one language in its own name.
         * @param code - The language code.
         */ (code) => <NativeSelectOption key={code} value={code}>{LANGUAGE_NAMES[code]}</NativeSelectOption>)}
      </NativeSelect>
    </div>
  );
}

/**
 * The language setting for the account settings: automatic (browser) or a fixed language.
 * @param props - The account's stored preference, a save handler that stores it on the server, and whether saving is disabled.
 */
export function LanguageSetting({ value, onSave, disabled }: { value: LanguagePreference; onSave: (language: LanguagePreference) => void; disabled?: boolean }) {
  const t = useT(messages);
  return (
    <NativeSelect
      id="account-language"
      className="w-full max-w-64"
      aria-describedby="account-language-help"
      disabled={disabled}
      value={value ?? ''}
      onChange={/**
       * Saves the chosen preference.
       * @param event - The select change event.
       */ (event) => onSave(isLanguage(event.target.value) ? event.target.value : null)}
    >
      <NativeSelectOption value="">{t('automatic', { language: LANGUAGE_NAMES[browserLanguage()] })}</NativeSelectOption>
      {LANGUAGES.map(/**
       * Renders one language in its own name.
       * @param code - The language code.
       */ (code) => <NativeSelectOption key={code} value={code}>{LANGUAGE_NAMES[code]}</NativeSelectOption>)}
    </NativeSelect>
  );
}

/**
 * Applies the language stored on a signed-in account; when the account has none, the browser's own choice stays.
 * @param language - The account's language from the server.
 */
export function applyAccountLanguage(language: string | null | undefined) {
  if (isLanguage(language)) applyPreference(language);
  else setFromBrowserChoice();
}

/** Keeps the language stored in this browser, or follows the browser when nothing is stored. */
function setFromBrowserChoice() {
  applyPreference(storedPreference());
}
