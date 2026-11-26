import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the rate limit settings. */
export default defineMessages({
  en: {
    loadFailed: 'Could not load rate limits.',
    invalid: 'Enter a positive whole number for each limit.',
    saved: 'Rate limits saved and applied.',
    saveFailed: 'Could not save rate limits.',
    title: 'Rate limits',
    description: 'Requests per minute per IP address. Changes take effect immediately.',
    auth: 'Sign-in and setup',
    authHelp: 'Shared by the Admin and Vault sign-in forms and first-run setup. Default: 10.',
    webDavHelp: 'Applies to all WebDAV requests, including failed authentication attempts. Default: 60.',
    saving: 'Saving…',
    save: 'Save rate limits',
    retry: 'Retry',
    loading: 'Loading rate limits…'
  },
  de: {
    loadFailed: 'Die Anfragelimits konnten nicht geladen werden.',
    invalid: 'Gib für jedes Limit eine positive ganze Zahl ein.',
    saved: 'Anfragelimits gespeichert und angewendet.',
    saveFailed: 'Die Anfragelimits konnten nicht gespeichert werden.',
    title: 'Anfragelimits',
    description: 'Anfragen pro Minute und IP-Adresse. Änderungen wirken sofort.',
    auth: 'Anmeldung und Einrichtung',
    authHelp: 'Gilt gemeinsam für die Anmeldeformulare von Admin-Konsole und Web-Tresor sowie für die Ersteinrichtung. Standard: 10.',
    webDavHelp: 'Gilt für alle WebDAV-Anfragen, auch für fehlgeschlagene Anmeldeversuche. Standard: 60.',
    saving: 'Wird gespeichert…',
    save: 'Anfragelimits speichern',
    retry: 'Erneut versuchen',
    loading: 'Anfragelimits werden geladen…'
  },
  fr: {
    loadFailed: 'Impossible de charger les limites de requêtes.',
    invalid: 'Saisissez un nombre entier positif pour chaque limite.',
    saved: 'Limites de requêtes enregistrées et appliquées.',
    saveFailed: 'Impossible d’enregistrer les limites de requêtes.',
    title: 'Limites de requêtes',
    description: 'Requêtes par minute et par adresse IP. Les modifications prennent effet immédiatement.',
    auth: 'Connexion et configuration',
    authHelp: 'Partagée par les formulaires de connexion de la console d’administration et du coffre-fort web ainsi que par la configuration initiale. Par défaut : 10.',
    webDavHelp: 'S’applique à toutes les requêtes WebDAV, y compris les tentatives d’authentification échouées. Par défaut : 60.',
    saving: 'Enregistrement…',
    save: 'Enregistrer les limites de requêtes',
    retry: 'Réessayer',
    loading: 'Chargement des limites de requêtes…'
  }
});
