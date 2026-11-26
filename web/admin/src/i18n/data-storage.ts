import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the data storage warning and the storage details on the settings page. */
export default defineMessages({
  en: {
    kindHostFolder: 'Host folder',
    kindDockerVolume: 'Docker volume',
    kindNotMounted: 'Not mounted',
    kindUnknown: 'Unknown',
    dockerVolumeWarning: 'Your data is stored in the Docker volume {volume}. NAS backup tools such as Hyper Backup or Hybrid Backup Sync don’t include it. Set KEEPORT_DATA to a folder to back it up with them.',
    notMountedWarning: '{dataDir} is not mounted: all data is lost when the container is recreated. Mount a folder via KEEPORT_DATA.',
    bannerTitle: 'Your data may not be backed up',
    showDetails: 'Show storage details',
    moveGuide: 'How to move the data to a folder',
    title: 'Data storage',
    description: 'Where KeePort keeps its database, vault files and admin certificate.',
    loading: 'Loading…',
    storage: 'Storage',
    insideContainer: 'Inside the container',
    onHost: 'On the host',
    hostFolderHint: 'Include this folder in your backups. On a NAS the path is shown as the storage system sees it, e.g. {syno} on Synology for {volume}.',
    unknownHint: 'KeePort is not running in Docker, or the mount table is unavailable. Back up {dataDir}.'
  },
  de: {
    kindHostFolder: 'Host-Ordner',
    kindDockerVolume: 'Docker-Volume',
    kindNotMounted: 'Nicht eingebunden',
    kindUnknown: 'Unbekannt',
    dockerVolumeWarning: 'Deine Daten liegen im Docker-Volume {volume}. NAS-Backup-Werkzeuge wie Hyper Backup oder Hybrid Backup Sync erfassen es nicht. Setze KEEPORT_DATA auf einen Ordner, um die Daten damit zu sichern.',
    notMountedWarning: '{dataDir} ist nicht eingebunden: Alle Daten gehen verloren, wenn der Container neu erstellt wird. Binde über KEEPORT_DATA einen Ordner ein.',
    bannerTitle: 'Deine Daten werden möglicherweise nicht gesichert',
    showDetails: 'Speicherdetails anzeigen',
    moveGuide: 'So verschiebst du die Daten in einen Ordner',
    title: 'Datenspeicher',
    description: 'Wo KeePort seine Datenbank, die Tresordateien und das Admin-Zertifikat ablegt.',
    loading: 'Wird geladen…',
    storage: 'Speicher',
    insideContainer: 'Im Container',
    onHost: 'Auf dem Host',
    hostFolderHint: 'Nimm diesen Ordner in deine Backups auf. Auf einem NAS wird der Pfad so angezeigt, wie das Speichersystem ihn sieht, z. B. {syno} auf Synology für {volume}.',
    unknownHint: 'KeePort läuft nicht in Docker, oder die Mount-Tabelle ist nicht verfügbar. Sichere {dataDir}.'
  },
  fr: {
    kindHostFolder: 'Dossier de l’hôte',
    kindDockerVolume: 'Volume Docker',
    kindNotMounted: 'Non monté',
    kindUnknown: 'Inconnu',
    dockerVolumeWarning: 'Vos données sont stockées dans le volume Docker {volume}. Les outils de sauvegarde de NAS tels que Hyper Backup ou Hybrid Backup Sync ne l’incluent pas. Définissez KEEPORT_DATA sur un dossier pour le sauvegarder avec ces outils.',
    notMountedWarning: '{dataDir} n’est pas monté : toutes les données sont perdues lorsque le conteneur est recréé. Montez un dossier via KEEPORT_DATA.',
    bannerTitle: 'Vos données ne sont peut-être pas sauvegardées',
    showDetails: 'Afficher les détails du stockage',
    moveGuide: 'Comment déplacer les données vers un dossier',
    title: 'Stockage des données',
    description: 'Où KeePort conserve sa base de données, les fichiers des coffres-forts et le certificat d’administration.',
    loading: 'Chargement…',
    storage: 'Stockage',
    insideContainer: 'Dans le conteneur',
    onHost: 'Sur l’hôte',
    hostFolderHint: 'Incluez ce dossier dans vos sauvegardes. Sur un NAS, le chemin est affiché tel que le système de stockage le voit, p. ex. {syno} sur Synology pour {volume}.',
    unknownHint: 'KeePort ne s’exécute pas dans Docker, ou la table des montages n’est pas disponible. Sauvegardez {dataDir}.'
  }
});
