import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the tag helpers: validation of new tags. */
export default defineMessages({
  en: {
    required: 'Enter a tag.',
    tooLong: 'Tags can have at most {max} characters.',
    separators: 'Tags cannot contain commas, semicolons or colons.',
    duplicate: 'The tag “{tag}” is already set.'
  },
  de: {
    required: 'Gib einen Tag ein.',
    tooLong: 'Tags dürfen höchstens {max} Zeichen lang sein.',
    separators: 'Tags dürfen keine Kommas, Semikolons oder Doppelpunkte enthalten.',
    duplicate: 'Der Tag „{tag}“ ist bereits gesetzt.'
  },
  fr: {
    required: 'Saisissez une étiquette.',
    tooLong: 'Les étiquettes peuvent comporter au maximum {max} caractères.',
    separators: 'Les étiquettes ne peuvent pas contenir de virgules, de points-virgules ni de deux-points.',
    duplicate: 'L’étiquette « {tag} » est déjà définie.'
  }
});
