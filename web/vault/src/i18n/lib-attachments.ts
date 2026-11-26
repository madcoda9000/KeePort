import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the attachment helpers: errors when adding a file to an entry. */
export default defineMessages({
  en: {
    tooLarge: 'Each new attachment must be 10 MiB or smaller.',
    duplicate: 'An attachment with that name already exists. Remove it or rename the new file first.'
  },
  de: {
    tooLarge: 'Jeder neue Anhang darf höchstens 10 MiB groß sein.',
    duplicate: 'Es gibt bereits einen Anhang mit diesem Namen. Entferne ihn oder benenne die neue Datei vorher um.'
  },
  fr: {
    tooLarge: 'Chaque nouvelle pièce jointe doit faire 10 Mio au maximum.',
    duplicate: 'Une pièce jointe portant ce nom existe déjà. Supprimez-la ou renommez d’abord le nouveau fichier.'
  }
});
