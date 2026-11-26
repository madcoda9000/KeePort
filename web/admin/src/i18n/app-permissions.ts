import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the panel that edits who can access a vault. */
export default defineMessages({
  en: {
    title: 'Vault permissions',
    description: '{name} · Administrators always have read-write access.',
    loading: 'Loading permissions…',
    noAccounts: 'No active non-admin accounts exist yet.',
    none: 'No access',
    read: 'Read only',
    readWrite: 'Read and write',
    save: 'Save permissions',
    updated: 'Permissions updated for {name}.',
    loadFailed: 'Unable to load permissions.',
    saveFailed: 'Unable to save permissions.'
  },
  de: {
    title: 'Tresor-Berechtigungen',
    description: '{name} · Administratoren haben immer Lese- und Schreibzugriff.',
    loading: 'Berechtigungen werden geladen…',
    noAccounts: 'Es gibt noch keine aktiven Konten ohne Admin-Rolle.',
    none: 'Kein Zugriff',
    read: 'Nur lesen',
    readWrite: 'Lesen und Schreiben',
    save: 'Berechtigungen speichern',
    updated: 'Berechtigungen für {name} aktualisiert.',
    loadFailed: 'Die Berechtigungen konnten nicht geladen werden.',
    saveFailed: 'Die Berechtigungen konnten nicht gespeichert werden.'
  },
  fr: {
    title: 'Autorisations du coffre-fort',
    description: '{name} · Les administrateurs ont toujours un accès en lecture et écriture.',
    loading: 'Chargement des autorisations…',
    noAccounts: 'Aucun compte actif non administrateur n’existe pour l’instant.',
    none: 'Aucun accès',
    read: 'Lecture seule',
    readWrite: 'Lecture et écriture',
    save: 'Enregistrer les autorisations',
    updated: 'Autorisations mises à jour pour {name}.',
    loadFailed: 'Impossible de charger les autorisations.',
    saveFailed: 'Impossible d’enregistrer les autorisations.'
  }
});
