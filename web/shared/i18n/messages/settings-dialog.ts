import { defineMessages } from '../core.ts';

/** Section names of the account settings window in both apps. */
export default defineMessages({
  en: {
    sections: 'Settings sections',
    account: 'Account',
    password: 'Password',
    twoFactor: 'Two-factor sign-in',
    notifications: 'Notifications',
    signIns: 'Sign-ins',
    vault: 'Vault'
  },
  de: {
    sections: 'Bereiche der Einstellungen',
    account: 'Konto',
    password: 'Passwort',
    twoFactor: 'Zwei-Faktor-Anmeldung',
    notifications: 'Benachrichtigungen',
    signIns: 'Anmeldungen',
    vault: 'Tresor'
  },
  fr: {
    sections: 'Sections des paramètres',
    account: 'Compte',
    password: 'Mot de passe',
    twoFactor: 'Connexion à deux facteurs',
    notifications: 'Notifications',
    signIns: 'Connexions',
    vault: 'Coffre-fort'
  }
});
