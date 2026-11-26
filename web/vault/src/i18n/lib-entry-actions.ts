import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the entry actions (delete, recycle bin). */
export default defineMessages({
  en: { entriesMissing: 'Some entries no longer exist. Reload the vault and try again.' },
  de: { entriesMissing: 'Einige Einträge gibt es nicht mehr. Lade den Tresor neu und versuche es noch einmal.' },
  fr: { entriesMissing: 'Certaines entrées n’existent plus. Rechargez le coffre-fort et réessayez.' }
});
