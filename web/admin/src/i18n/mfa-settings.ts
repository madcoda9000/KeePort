import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the two-factor rules in the settings. */
export default defineMessages({
  en: {
    title: 'Two-factor sign-in',
    description: 'Who must use a second factor, and who may use codes by e-mail. WebDAV app passwords are not affected.',
    requireTitle: 'Required',
    requireAdmins: 'Administrators must set up two-factor sign-in',
    requireUsers: 'Users must set up two-factor sign-in',
    requireHelp: 'Accounts without a second factor are led to the setup after signing in and can do nothing else until it is done.',
    emailTitle: 'Codes by e-mail',
    emailAdmins: 'Administrators may use codes by e-mail',
    emailUsers: 'Users may use codes by e-mail',
    emailHelp: 'E-mail is weaker than an authenticator app. When you turn it off, e-mail codes stop counting as second factor for these accounts.',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Two-factor rules saved.',
    loadFailed: 'Could not load the two-factor rules.',
    saveFailed: 'Could not save the two-factor rules.',
    retry: 'Retry',
    loading: 'Loading…'
  },
  de: {
    title: 'Zwei-Faktor-Anmeldung',
    description: 'Wer einen zweiten Faktor verwenden muss und wer Codes per E-Mail verwenden darf. WebDAV-App-Passwörter sind davon nicht betroffen.',
    requireTitle: 'Pflicht',
    requireAdmins: 'Administratoren müssen die Zwei-Faktor-Anmeldung einrichten',
    requireUsers: 'Benutzer müssen die Zwei-Faktor-Anmeldung einrichten',
    requireHelp: 'Konten ohne zweiten Faktor werden nach der Anmeldung zur Einrichtung geführt und können erst danach weiterarbeiten.',
    emailTitle: 'Codes per E-Mail',
    emailAdmins: 'Administratoren dürfen Codes per E-Mail verwenden',
    emailUsers: 'Benutzer dürfen Codes per E-Mail verwenden',
    emailHelp: 'E-Mail ist schwächer als eine Authenticator-App. Schaltest du sie aus, zählen E-Mail-Codes für diese Konten nicht mehr als zweiter Faktor.',
    save: 'Speichern',
    saving: 'Wird gespeichert…',
    saved: 'Regeln für die Zwei-Faktor-Anmeldung gespeichert.',
    loadFailed: 'Die Regeln für die Zwei-Faktor-Anmeldung konnten nicht geladen werden.',
    saveFailed: 'Die Regeln für die Zwei-Faktor-Anmeldung konnten nicht gespeichert werden.',
    retry: 'Erneut versuchen',
    loading: 'Wird geladen…'
  },
  fr: {
    title: 'Connexion à deux facteurs',
    description: 'Qui doit utiliser un second facteur et qui peut utiliser des codes par e-mail. Les mots de passe d’application WebDAV ne sont pas concernés.',
    requireTitle: 'Obligatoire',
    requireAdmins: 'Les administrateurs doivent configurer la connexion à deux facteurs',
    requireUsers: 'Les utilisateurs doivent configurer la connexion à deux facteurs',
    requireHelp: 'Les comptes sans second facteur sont guidés vers la configuration après la connexion et ne peuvent rien faire d’autre avant de l’avoir terminée.',
    emailTitle: 'Codes par e-mail',
    emailAdmins: 'Les administrateurs peuvent utiliser des codes par e-mail',
    emailUsers: 'Les utilisateurs peuvent utiliser des codes par e-mail',
    emailHelp: 'L’e-mail est moins sûr qu’une application d’authentification. Si vous le désactivez, les codes par e-mail ne comptent plus comme second facteur pour ces comptes.',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    saved: 'Règles de connexion à deux facteurs enregistrées.',
    loadFailed: 'Impossible de charger les règles de connexion à deux facteurs.',
    saveFailed: 'Impossible d’enregistrer les règles de connexion à deux facteurs.',
    retry: 'Réessayer',
    loading: 'Chargement…'
  }
});
