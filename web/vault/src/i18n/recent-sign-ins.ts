import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the recent sign-ins list in the account settings. */
export default defineMessages({
  en: {
    title: 'Recent sign-ins',
    description: 'The last 20 sign-in attempts on your account. If you see one that was not you, change your password and tell your administrator.',
    loadFailed: 'Could not load recent sign-ins.',
    loading: 'Loading…',
    empty: 'No sign-ins recorded yet.',
    successful: 'Successful',
    failed: 'Failed',
    signedIn: 'Signed in',
    failedSignIn: 'Failed sign-in'
  },
  de: {
    title: 'Letzte Anmeldungen',
    description: 'Die letzten 20 Anmeldeversuche an deinem Konto. Wenn du einen siehst, der nicht von dir stammt, ändere dein Passwort und informiere deinen Administrator.',
    loadFailed: 'Die letzten Anmeldungen konnten nicht geladen werden.',
    loading: 'Wird geladen…',
    empty: 'Noch keine Anmeldungen erfasst.',
    successful: 'Erfolgreich',
    failed: 'Fehlgeschlagen',
    signedIn: 'Angemeldet',
    failedSignIn: 'Fehlgeschlagene Anmeldung'
  },
  fr: {
    title: 'Connexions récentes',
    description: 'Les 20 dernières tentatives de connexion à votre compte. Si vous en voyez une qui ne vient pas de vous, changez votre mot de passe et prévenez votre administrateur.',
    loadFailed: 'Impossible de charger les connexions récentes.',
    loading: 'Chargement…',
    empty: 'Aucune connexion enregistrée pour le moment.',
    successful: 'Réussie',
    failed: 'Échouée',
    signedIn: 'Connecté',
    failedSignIn: 'Échec de connexion'
  }
});
