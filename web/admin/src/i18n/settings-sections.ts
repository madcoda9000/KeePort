import { defineMessages } from '../../../shared/i18n/core.ts';

/** Names of the areas in the menu of the admin console's settings page. */
export default defineMessages({
  en: {
    sections: 'Settings areas',
    email: 'E-mail',
    twoFactor: 'Two-factor sign-in',
    sharing: 'Sharing secrets',
    rateLimits: 'Rate limits',
    versions: 'Vault versions',
    audit: 'Audit log',
    storage: 'Data storage'
  },
  de: {
    sections: 'Bereiche der Einstellungen',
    email: 'E-Mail',
    twoFactor: 'Zwei-Faktor-Anmeldung',
    sharing: 'Secrets teilen',
    rateLimits: 'Anfragelimits',
    versions: 'Tresor-Versionen',
    audit: 'Audit-Log',
    storage: 'Datenspeicher'
  },
  fr: {
    sections: 'Sections des paramètres',
    email: 'E-mail',
    twoFactor: 'Connexion à deux facteurs',
    sharing: 'Partage de secrets',
    rateLimits: 'Limites de requêtes',
    versions: 'Versions des coffres-forts',
    audit: 'Journal d’audit',
    storage: 'Stockage des données'
  }
});
