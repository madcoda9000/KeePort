import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the dialog that changes the tags of several entries. */
export default defineMessages({
  en: {
    title: { one: 'Tags for {count} entry', other: 'Tags for {count} entries' },
    description: { one: 'Add tags to the selected entry or remove tags from it. Each changed entry keeps its previous state in the history.', other: 'Add tags to all selected entries or remove tags from them. Each changed entry keeps its previous state in the history.' },
    addTags: 'Add tags',
    removeTags: 'Remove tags',
    share: '({used} of {total})',
    saving: 'Saving…',
    apply: 'Apply'
  },
  de: {
    title: { one: 'Tags für {count} Eintrag', other: 'Tags für {count} Einträge' },
    description: { one: 'Füge dem ausgewählten Eintrag Tags hinzu oder entferne Tags davon. Jeder geänderte Eintrag behält seinen vorherigen Stand im Verlauf.', other: 'Füge allen ausgewählten Einträgen Tags hinzu oder entferne Tags davon. Jeder geänderte Eintrag behält seinen vorherigen Stand im Verlauf.' },
    addTags: 'Tags hinzufügen',
    removeTags: 'Tags entfernen',
    share: '({used} von {total})',
    saving: 'Wird gespeichert…',
    apply: 'Übernehmen'
  },
  fr: {
    title: { one: 'Étiquettes pour {count} entrée', other: 'Étiquettes pour {count} entrées' },
    description: { one: 'Ajoutez des étiquettes à l’entrée sélectionnée ou retirez-en. Chaque entrée modifiée conserve son état précédent dans l’historique.', other: 'Ajoutez des étiquettes à toutes les entrées sélectionnées ou retirez-en. Chaque entrée modifiée conserve son état précédent dans l’historique.' },
    addTags: 'Ajouter des étiquettes',
    removeTags: 'Retirer des étiquettes',
    share: '({used} sur {total})',
    saving: 'Enregistrement…',
    apply: 'Appliquer'
  }
});
