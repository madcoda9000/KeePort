import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the icon conversion helpers. */
export default defineMessages({
  en: {
    readFailed: 'The icon could not be read.',
    notAnImage: 'The website icon is not an image your browser can read.',
    noCanvas: 'Your browser cannot convert images.',
    convertFailed: 'The icon could not be converted.'
  },
  de: {
    readFailed: 'Das Symbol konnte nicht gelesen werden.',
    notAnImage: 'Das Website-Symbol ist kein Bild, das dein Browser lesen kann.',
    noCanvas: 'Dein Browser kann keine Bilder umwandeln.',
    convertFailed: 'Das Symbol konnte nicht umgewandelt werden.'
  },
  fr: {
    readFailed: 'Impossible de lire l’icône.',
    notAnImage: 'L’icône du site web n’est pas une image que votre navigateur peut lire.',
    noCanvas: 'Votre navigateur ne peut pas convertir d’images.',
    convertFailed: 'Impossible de convertir l’icône.'
  }
});
