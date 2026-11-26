import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the password strength estimate: short reasons why a password is weak. */
export default defineMessages({
  en: {
    empty: 'Empty',
    repeated: 'Repeated characters',
    sequence: 'Sequence',
    keyboard: 'Keyboard pattern',
    year: 'Contains a year',
    short: 'Shorter than 12 characters',
    common: 'Common password'
  },
  de: {
    empty: 'Leer',
    repeated: 'Wiederholte Zeichen',
    sequence: 'Zeichenfolge',
    keyboard: 'Tastaturmuster',
    year: 'Enthält eine Jahreszahl',
    short: 'Kürzer als 12 Zeichen',
    common: 'Häufiges Passwort'
  },
  fr: {
    empty: 'Vide',
    repeated: 'Caractères répétés',
    sequence: 'Suite de caractères',
    keyboard: 'Motif de clavier',
    year: 'Contient une année',
    short: 'Moins de 12 caractères',
    common: 'Mot de passe courant'
  }
});
