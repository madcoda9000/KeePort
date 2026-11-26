import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the audit log retention settings. */
export default defineMessages({
  en: {
    loadFailed: 'Could not load the audit log settings.',
    invalidDays: 'Enter a whole number of days between 1 and 3650.',
    saved: 'Audit log retention saved. Older entries were removed.',
    saveFailed: 'Could not save the audit log settings.',
    title: 'Audit log',
    description: 'How long sign-ins and changes are kept. At most {max} entries are kept in any case.',
    loading: 'Loading audit log settings…',
    retention: 'Keep entries for (days)',
    retentionHelp: 'Entries older than this are deleted. A shorter value removes older entries right away. Default: 365.',
    saving: 'Saving…',
    save: 'Save retention'
  },
  de: {
    loadFailed: 'Die Einstellungen des Audit-Logs konnten nicht geladen werden.',
    invalidDays: 'Gib eine ganze Zahl von Tagen zwischen 1 und 3650 ein.',
    saved: 'Aufbewahrungsdauer gespeichert. Ältere Einträge wurden entfernt.',
    saveFailed: 'Die Einstellungen des Audit-Logs konnten nicht gespeichert werden.',
    title: 'Audit-Log',
    description: 'Wie lange Anmeldungen und Änderungen aufbewahrt werden. Es werden in jedem Fall höchstens {max} Einträge aufbewahrt.',
    loading: 'Einstellungen des Audit-Logs werden geladen…',
    retention: 'Einträge aufbewahren (Tage)',
    retentionHelp: 'Ältere Einträge werden gelöscht. Ein kürzerer Wert entfernt ältere Einträge sofort. Standard: 365.',
    saving: 'Wird gespeichert…',
    save: 'Aufbewahrungsdauer speichern'
  },
  fr: {
    loadFailed: 'Impossible de charger les paramètres du journal d’audit.',
    invalidDays: 'Saisissez un nombre entier de jours entre 1 et 3650.',
    saved: 'Durée de conservation enregistrée. Les entrées plus anciennes ont été supprimées.',
    saveFailed: 'Impossible d’enregistrer les paramètres du journal d’audit.',
    title: 'Journal d’audit',
    description: 'Durée de conservation des connexions et des modifications. Au plus {max} entrées sont conservées dans tous les cas.',
    loading: 'Chargement des paramètres du journal d’audit…',
    retention: 'Conserver les entrées pendant (jours)',
    retentionHelp: 'Les entrées plus anciennes sont supprimées. Une valeur plus courte supprime immédiatement les entrées plus anciennes. Par défaut : 365.',
    saving: 'Enregistrement…',
    save: 'Enregistrer la durée de conservation'
  }
});
