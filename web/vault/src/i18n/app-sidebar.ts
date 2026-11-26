import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the web vault's sidebar: the vault list and the account footer. */
export default defineMessages({
  en: {
    personalVault: 'Personal vault',
    sharedVaults: 'Shared vaults',
    noFiles: 'No files available.',
    unlockedTitle: '{name} (unlocked)',
    unlockedSuffix: '(unlocked)',
    decryptionLocal: 'Decryption stays in this browser'
  },
  de: {
    personalVault: 'Persönlicher Tresor',
    sharedVaults: 'Freigegebene Tresore',
    noFiles: 'Keine Dateien verfügbar.',
    unlockedTitle: '{name} (entsperrt)',
    unlockedSuffix: '(entsperrt)',
    decryptionLocal: 'Entschlüsselung nur im Browser'
  },
  fr: {
    personalVault: 'Coffre-fort personnel',
    sharedVaults: 'Coffres-forts partagés',
    noFiles: 'Aucun fichier disponible.',
    unlockedTitle: '{name} (déverrouillé)',
    unlockedSuffix: '(déverrouillé)',
    decryptionLocal: 'Déchiffrement local uniquement'
  }
});
