import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the attachments section of the entry form. */
export default defineMessages({
  en: {
    addFailed: 'Unable to add attachment.',
    title: 'Attachments',
    empty: 'No attachments.',
    bytes: { one: '{count} byte', other: '{count} bytes' },
    downloadNamed: 'Download {name}',
    download: 'Download attachment',
    removeNamed: 'Remove {name}',
    remove: 'Remove attachment',
    removeTitle: 'Remove attachment?',
    removeDescription: 'Saving will remove “{name}” from the current entry. Saved attachments may remain in entry history.',
    cancel: 'Cancel',
    removeConfirm: 'Remove',
    add: 'Add attachment',
    help: 'Up to 10 MiB per file. Attachments increase the encrypted vault size. Save the entry to apply changes.'
  },
  de: {
    addFailed: 'Der Anhang konnte nicht hinzugefügt werden.',
    title: 'Anhänge',
    empty: 'Keine Anhänge.',
    bytes: { one: '{count} Byte', other: '{count} Bytes' },
    downloadNamed: '{name} herunterladen',
    download: 'Anhang herunterladen',
    removeNamed: '{name} entfernen',
    remove: 'Anhang entfernen',
    removeTitle: 'Anhang entfernen?',
    removeDescription: 'Beim Speichern wird „{name}“ aus dem aktuellen Eintrag entfernt. Gespeicherte Anhänge können im Verlauf des Eintrags erhalten bleiben.',
    cancel: 'Abbrechen',
    removeConfirm: 'Entfernen',
    add: 'Anhang hinzufügen',
    help: 'Bis zu 10 MiB pro Datei. Anhänge vergrößern die verschlüsselte Tresordatei. Speichere den Eintrag, um die Änderungen zu übernehmen.'
  },
  fr: {
    addFailed: 'Impossible d’ajouter la pièce jointe.',
    title: 'Pièces jointes',
    empty: 'Aucune pièce jointe.',
    bytes: { one: '{count} octet', other: '{count} octets' },
    downloadNamed: 'Télécharger {name}',
    download: 'Télécharger la pièce jointe',
    removeNamed: 'Retirer {name}',
    remove: 'Retirer la pièce jointe',
    removeTitle: 'Retirer la pièce jointe ?',
    removeDescription: 'L’enregistrement retirera « {name} » de l’entrée actuelle. Les pièces jointes enregistrées peuvent rester dans l’historique de l’entrée.',
    cancel: 'Annuler',
    removeConfirm: 'Retirer',
    add: 'Ajouter une pièce jointe',
    help: 'Jusqu’à 10 Mio par fichier. Les pièces jointes augmentent la taille du coffre-fort chiffré. Enregistrez l’entrée pour appliquer les modifications.'
  }
});
