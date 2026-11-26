import { defineMessages } from '../core.ts';

/** Texts of the language menus. */
export default defineMessages({
  en: {
    label: 'Language',
    automatic: 'Automatic ({language})',
    help: 'Applies to the web vault and the admin console on all your devices. Automatic follows your browser.',
    saved: 'Language saved.'
  },
  de: {
    label: 'Sprache',
    automatic: 'Automatisch ({language})',
    help: 'Gilt für den Web-Tresor und die Admin-Konsole auf allen deinen Geräten. Automatisch folgt deinem Browser.',
    saved: 'Sprache gespeichert.'
  },
  fr: {
    label: 'Langue',
    automatic: 'Automatique ({language})',
    help: 'S’applique au coffre-fort web et à la console d’administration sur tous vos appareils. Automatique suit votre navigateur.',
    saved: 'Langue enregistrée.'
  }
});
