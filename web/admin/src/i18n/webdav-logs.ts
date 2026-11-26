import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the WebDAV request log. */
export default defineMessages({
  en: {
    time: 'Time',
    method: 'Method',
    path: 'Path',
    status: 'Status',
    credential: 'Credential',
    clientIp: 'Client IP',
    details: 'Details',
    duration: 'Duration',
    loadFailed: 'Could not load WebDAV logs.',
    title: 'WebDAV requests',
    description: 'The latest {max} requests from KeePass clients. Passwords and file contents are never logged.',
    refresh: 'Refresh',
    search: 'Search WebDAV logs',
    loading: 'Loading WebDAV logs…',
    empty: 'No WebDAV requests logged yet.',
    unauthenticated: 'unauthenticated'
  },
  de: {
    time: 'Zeit',
    method: 'Methode',
    path: 'Pfad',
    status: 'Status',
    credential: 'Zugang',
    clientIp: 'Client-IP',
    details: 'Details',
    duration: 'Dauer',
    loadFailed: 'Die WebDAV-Logs konnten nicht geladen werden.',
    title: 'WebDAV-Anfragen',
    description: 'Die letzten {max} Anfragen von KeePass-Clients. Passwörter und Dateiinhalte werden nie protokolliert.',
    refresh: 'Aktualisieren',
    search: 'WebDAV-Logs durchsuchen',
    loading: 'WebDAV-Logs werden geladen…',
    empty: 'Noch keine WebDAV-Anfragen protokolliert.',
    unauthenticated: 'nicht angemeldet'
  },
  fr: {
    time: 'Heure',
    method: 'Méthode',
    path: 'Chemin',
    status: 'Statut',
    credential: 'Accès',
    clientIp: 'IP du client',
    details: 'Détails',
    duration: 'Durée',
    loadFailed: 'Impossible de charger les journaux WebDAV.',
    title: 'Requêtes WebDAV',
    description: 'Les {max} dernières requêtes des clients KeePass. Les mots de passe et le contenu des fichiers ne sont jamais journalisés.',
    refresh: 'Actualiser',
    search: 'Rechercher dans les journaux WebDAV',
    loading: 'Chargement des journaux WebDAV…',
    empty: 'Aucune requête WebDAV journalisée pour le moment.',
    unauthenticated: 'non authentifié'
  }
});
