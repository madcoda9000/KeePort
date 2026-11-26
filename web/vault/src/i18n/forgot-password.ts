import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the "forgot password" form on the web vault's sign-in screen. */
export default defineMessages({
  en: {
    title: 'Reset your password',
    intro: 'Enter your username or e-mail address. We send you a link to choose a new account password.',
    identifier: 'Username or e-mail address',
    identifierHelp: 'Only for accounts with a confirmed e-mail address. Administrators ask another administrator.',
    send: 'Send link',
    sending: 'Sending…',
    sent: 'If an account with a confirmed e-mail address matches, we sent a link to reset the password. It is valid for 30 minutes.',
    failed: 'The link could not be requested. Please try again.',
    back: 'Back to sign-in'
  },
  de: {
    title: 'Passwort zurücksetzen',
    intro: 'Gib deinen Benutzernamen oder deine E-Mail-Adresse ein. Wir schicken dir einen Link, mit dem du ein neues Konto-Passwort wählst.',
    identifier: 'Benutzername oder E-Mail-Adresse',
    identifierHelp: 'Nur für Konten mit bestätigter E-Mail-Adresse. Administratoren wenden sich an einen anderen Administrator.',
    send: 'Link senden',
    sending: 'Wird gesendet…',
    sent: 'Wenn ein Konto mit bestätigter E-Mail-Adresse passt, haben wir einen Link zum Zurücksetzen des Passworts geschickt. Er gilt 30 Minuten.',
    failed: 'Der Link konnte nicht angefordert werden. Bitte versuche es erneut.',
    back: 'Zurück zur Anmeldung'
  },
  fr: {
    title: 'Réinitialiser votre mot de passe',
    intro: 'Saisissez votre nom d’utilisateur ou votre adresse e-mail. Nous vous envoyons un lien pour choisir un nouveau mot de passe du compte.',
    identifier: 'Nom d’utilisateur ou adresse e-mail',
    identifierHelp: 'Uniquement pour les comptes dont l’adresse e-mail est confirmée. Les administrateurs s’adressent à un autre administrateur.',
    send: 'Envoyer le lien',
    sending: 'Envoi…',
    sent: 'Si un compte avec une adresse e-mail confirmée correspond, nous avons envoyé un lien pour réinitialiser le mot de passe. Il est valable 30 minutes.',
    failed: 'Impossible de demander le lien. Veuillez réessayer.',
    back: 'Retour à la connexion'
  }
});
