import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the dialog that moves entries to another folder. */
export default defineMessages({
  en: {
    title: { one: 'Move {count} entry', other: 'Move {count} entries' },
    description: { one: 'Choose the folder the selected entry should be moved to.', other: 'Choose the folder the selected entries should be moved to.' },
    destination: 'Destination folder',
    currentFolder: 'current folder',
    moving: 'Moving…',
    moveHere: 'Move here'
  },
  de: {
    title: { one: '{count} Eintrag verschieben', other: '{count} Einträge verschieben' },
    description: { one: 'Wähle den Ordner, in den der ausgewählte Eintrag verschoben werden soll.', other: 'Wähle den Ordner, in den die ausgewählten Einträge verschoben werden sollen.' },
    destination: 'Zielordner',
    currentFolder: 'aktueller Ordner',
    moving: 'Wird verschoben…',
    moveHere: 'Hierher verschieben'
  },
  fr: {
    title: { one: 'Déplacer {count} entrée', other: 'Déplacer {count} entrées' },
    description: { one: 'Choisissez le dossier vers lequel déplacer l’entrée sélectionnée.', other: 'Choisissez le dossier vers lequel déplacer les entrées sélectionnées.' },
    destination: 'Dossier de destination',
    currentFolder: 'dossier actuel',
    moving: 'Déplacement…',
    moveHere: 'Déplacer ici'
  }
});
