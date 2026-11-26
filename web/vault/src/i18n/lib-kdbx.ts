import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the KDBX helpers: errors when reopening or saving a vault. */
export default defineMessages({
  en: {
    credentialsChanged: 'The vault on the server now uses a different master password or key file. Lock the vault and unlock it again.',
    templateMissing: 'The template no longer exists. Reload the vault and try again.',
    missingKdf: 'Missing KDBX key derivation parameters.'
  },
  de: {
    credentialsChanged: 'Der Tresor auf dem Server verwendet jetzt ein anderes Master-Passwort oder eine andere Schlüsseldatei. Sperre den Tresor und entsperre ihn erneut.',
    templateMissing: 'Die Vorlage gibt es nicht mehr. Lade den Tresor neu und versuche es noch einmal.',
    missingKdf: 'Die KDBX-Parameter zur Schlüsselableitung fehlen.'
  },
  fr: {
    credentialsChanged: 'Le coffre-fort sur le serveur utilise désormais un autre mot de passe maître ou fichier clé. Verrouillez le coffre-fort, puis déverrouillez-le à nouveau.',
    templateMissing: 'Le modèle n’existe plus. Rechargez le coffre-fort et réessayez.',
    missingKdf: 'Les paramètres de dérivation de clé KDBX sont manquants.'
  }
});
