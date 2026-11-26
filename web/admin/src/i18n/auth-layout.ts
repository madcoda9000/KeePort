import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the split sign-in screen. */
export default defineMessages({
  en: {
    areaAdmin: 'Admin',
    areaVault: 'Vault',
    selfHosted: 'Self-hosted workspace',
    adminHeadline: 'Your vaults. Your server.',
    vaultHeadline: 'Your secrets stay yours.',
    adminText: 'Manage vault files, user access and WebDAV from one secure console.',
    vaultText: 'Your KeePass vault unlocks in this browser. KeePort never receives your master password.'
  },
  de: {
    areaAdmin: 'Admin',
    areaVault: 'Tresor',
    selfHosted: 'Selbst gehosteter Arbeitsbereich',
    adminHeadline: 'Deine Tresore. Dein Server.',
    vaultHeadline: 'Deine Geheimnisse bleiben deine.',
    adminText: 'Verwalte Tresordateien, Benutzerzugriffe und WebDAV in einer sicheren Konsole.',
    vaultText: 'Dein KeePass-Tresor wird in diesem Browser entsperrt. KeePort erhält dein Master-Passwort nie.'
  },
  fr: {
    areaAdmin: 'Admin',
    areaVault: 'Coffre-fort',
    selfHosted: 'Espace de travail auto-hébergé',
    adminHeadline: 'Vos coffres-forts. Votre serveur.',
    vaultHeadline: 'Vos secrets restent les vôtres.',
    adminText: 'Gérez les fichiers des coffres-forts, les accès des utilisateurs et WebDAV depuis une seule console sécurisée.',
    vaultText: 'Votre coffre-fort KeePass se déverrouille dans ce navigateur. KeePort ne reçoit jamais votre mot de passe maître.'
  }
});
