import { defineMessages } from '../core.ts';

/** Texts of the notice shown when the browser offers no encryption functions over an insecure connection. */
export default defineMessages({
  en: {
    title: 'Secure connection required',
    explanation: '{action} needs your browser’s encryption functions, which browsers only provide over HTTPS or on {localhost}. This page was opened via {origin}.',
    fix: 'Open KeePort through its HTTPS address, or through an SSH tunnel at {localhost}.',
    howTo: 'How to set this up'
  },
  de: {
    title: 'Sichere Verbindung erforderlich',
    explanation: '{action} braucht die Verschlüsselungsfunktionen deines Browsers. Browser bieten sie nur über HTTPS oder unter {localhost} an. Diese Seite wurde über {origin} geöffnet.',
    fix: 'Öffne KeePort über seine HTTPS-Adresse oder über einen SSH-Tunnel unter {localhost}.',
    howTo: 'So richtest du das ein'
  },
  fr: {
    title: 'Connexion sécurisée requise',
    explanation: '{action} nécessite les fonctions de chiffrement de votre navigateur, que les navigateurs ne proposent qu’en HTTPS ou sur {localhost}. Cette page a été ouverte via {origin}.',
    fix: 'Ouvrez KeePort via son adresse HTTPS, ou via un tunnel SSH sur {localhost}.',
    howTo: 'Comment le configurer'
  }
});
