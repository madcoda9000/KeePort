import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the dialog that exports entries as a CSV file. */
export default defineMessages({
  en: {
    title: 'Export entries',
    description: 'Download the entries of this vault as a CSV file, for example to move to another password manager. The file is created in your browser.',
    scope: 'Entries',
    scopeAll: { one: 'Whole vault ({count} entry)', other: 'Whole vault ({count} entries)' },
    scopeFolder: { one: 'Folder “{name}” with subfolders ({count} entry)', other: 'Folder “{name}” with subfolders ({count} entries)' },
    excluded: 'The file uses the KeePassXC layout, which KeePassXC, Bitwarden and KeePort can import. Not included: recycle bin, templates, custom fields, attachments and history.',
    warningTitle: 'The file is not encrypted',
    warning: 'Anyone who gets the file can read every password in it. Import it right away, then delete it. Do not keep it in a synced or shared folder and do not send it by e-mail.',
    formulas: 'Protect against formulas in spreadsheets',
    formulasHelp: 'Puts an apostrophe before values that start with =, +, - or @, so Excel or LibreOffice do not run them as formulas. Passwords are never changed. Leave this off if you import the file into another password manager.',
    download: { zero: 'Nothing to export', one: 'Download {count} entry', other: 'Download {count} entries' },
    cancel: 'Cancel'
  },
  de: {
    title: 'Einträge exportieren',
    description: 'Lade die Einträge dieses Tresors als CSV-Datei herunter, zum Beispiel für den Umzug in einen anderen Passwort-Manager. Die Datei entsteht in deinem Browser.',
    scope: 'Einträge',
    scopeAll: { one: 'Ganzer Tresor ({count} Eintrag)', other: 'Ganzer Tresor ({count} Einträge)' },
    scopeFolder: { one: 'Ordner „{name}“ mit Unterordnern ({count} Eintrag)', other: 'Ordner „{name}“ mit Unterordnern ({count} Einträge)' },
    excluded: 'Die Datei hat das Format von KeePassXC, das KeePassXC, Bitwarden und KeePort einlesen können. Nicht enthalten sind Papierkorb, Vorlagen, eigene Felder, Anhänge und Verlauf.',
    warningTitle: 'Die Datei ist nicht verschlüsselt',
    warning: 'Wer die Datei bekommt, kann jedes Passwort darin lesen. Importiere sie gleich und lösche sie danach. Lege sie nicht in einen synchronisierten oder geteilten Ordner und verschicke sie nicht per E-Mail.',
    formulas: 'Vor Formeln in Tabellenprogrammen schützen',
    formulasHelp: 'Setzt ein Apostroph vor Werte, die mit =, +, - oder @ beginnen, damit Excel oder LibreOffice sie nicht als Formel ausführen. Passwörter bleiben unverändert. Lass das aus, wenn du die Datei in einen anderen Passwort-Manager importierst.',
    download: { zero: 'Nichts zu exportieren', one: '{count} Eintrag herunterladen', other: '{count} Einträge herunterladen' },
    cancel: 'Abbrechen'
  },
  fr: {
    title: 'Exporter des entrées',
    description: 'Téléchargez les entrées de ce coffre-fort dans un fichier CSV, par exemple pour passer à un autre gestionnaire de mots de passe. Le fichier est créé dans votre navigateur.',
    scope: 'Entrées',
    scopeAll: { one: 'Tout le coffre-fort ({count} entrée)', other: 'Tout le coffre-fort ({count} entrées)' },
    scopeFolder: { one: 'Dossier « {name} » avec ses sous-dossiers ({count} entrée)', other: 'Dossier « {name} » avec ses sous-dossiers ({count} entrées)' },
    excluded: 'Le fichier utilise le format de KeePassXC, que KeePassXC, Bitwarden et KeePort savent importer. Non inclus : corbeille, modèles, champs personnalisés, pièces jointes et historique.',
    warningTitle: 'Le fichier n’est pas chiffré',
    warning: 'Toute personne qui obtient le fichier peut lire tous les mots de passe qu’il contient. Importez-le aussitôt, puis supprimez-le. Ne le gardez pas dans un dossier synchronisé ou partagé et ne l’envoyez pas par e-mail.',
    formulas: 'Protéger contre les formules des tableurs',
    formulasHelp: 'Ajoute une apostrophe devant les valeurs commençant par =, +, - ou @, pour qu’Excel ou LibreOffice ne les exécutent pas comme formules. Les mots de passe ne sont jamais modifiés. Laissez cette option désactivée si vous importez le fichier dans un autre gestionnaire de mots de passe.',
    download: { zero: 'Rien à exporter', one: 'Télécharger {count} entrée', other: 'Télécharger {count} entrées' },
    cancel: 'Annuler'
  }
});
