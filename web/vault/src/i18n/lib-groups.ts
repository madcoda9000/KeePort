import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the folder helpers: validation and errors when changing folders. */
export default defineMessages({
  en: {
    folderMissing: 'The folder no longer exists. Reopen the vault to load the latest version.',
    nameRequired: 'Enter a folder name.',
    nameTooLong: 'Folder names can have at most {max} characters.',
    parentMissing: 'The parent folder no longer exists.',
    duplicate: 'A folder named “{name}” already exists here.',
    createInRecycleBin: 'Folders cannot be created in the recycle bin.',
    renameRoot: 'The root folder cannot be renamed.',
    renameRecycleBin: 'The recycle bin cannot be renamed.',
    deleteRoot: 'The root folder cannot be deleted.',
    deleteRecycleBin: 'The recycle bin cannot be deleted.',
    deleteNotEmpty: 'Only empty folders can be deleted. Move or delete its entries and subfolders first.',
    moveToRecycleBin: 'Entries cannot be moved into the recycle bin.',
    entriesMissing: 'Some entries no longer exist. Reopen the vault to load the latest version.',
    saveFailed: 'Unable to save vault.'
  },
  de: {
    folderMissing: 'Den Ordner gibt es nicht mehr. Öffne den Tresor erneut, um den neuesten Stand zu laden.',
    nameRequired: 'Gib einen Ordnernamen ein.',
    nameTooLong: 'Ordnernamen dürfen höchstens {max} Zeichen lang sein.',
    parentMissing: 'Den übergeordneten Ordner gibt es nicht mehr.',
    duplicate: 'Hier gibt es bereits einen Ordner namens „{name}“.',
    createInRecycleBin: 'Im Papierkorb können keine Ordner erstellt werden.',
    renameRoot: 'Der Stammordner kann nicht umbenannt werden.',
    renameRecycleBin: 'Der Papierkorb kann nicht umbenannt werden.',
    deleteRoot: 'Der Stammordner kann nicht gelöscht werden.',
    deleteRecycleBin: 'Der Papierkorb kann nicht gelöscht werden.',
    deleteNotEmpty: 'Nur leere Ordner können gelöscht werden. Verschiebe oder lösche zuerst seine Einträge und Unterordner.',
    moveToRecycleBin: 'Einträge können nicht in den Papierkorb verschoben werden.',
    entriesMissing: 'Einige Einträge gibt es nicht mehr. Öffne den Tresor erneut, um den neuesten Stand zu laden.',
    saveFailed: 'Der Tresor konnte nicht gespeichert werden.'
  },
  fr: {
    folderMissing: 'Le dossier n’existe plus. Rouvrez le coffre-fort pour charger la dernière version.',
    nameRequired: 'Saisissez un nom de dossier.',
    nameTooLong: 'Les noms de dossier peuvent comporter au maximum {max} caractères.',
    parentMissing: 'Le dossier parent n’existe plus.',
    duplicate: 'Un dossier nommé « {name} » existe déjà ici.',
    createInRecycleBin: 'Impossible de créer des dossiers dans la corbeille.',
    renameRoot: 'Le dossier racine ne peut pas être renommé.',
    renameRecycleBin: 'La corbeille ne peut pas être renommée.',
    deleteRoot: 'Le dossier racine ne peut pas être supprimé.',
    deleteRecycleBin: 'La corbeille ne peut pas être supprimée.',
    deleteNotEmpty: 'Seuls les dossiers vides peuvent être supprimés. Déplacez ou supprimez d’abord ses entrées et sous-dossiers.',
    moveToRecycleBin: 'Les entrées ne peuvent pas être déplacées dans la corbeille.',
    entriesMissing: 'Certaines entrées n’existent plus. Rouvrez le coffre-fort pour charger la dernière version.',
    saveFailed: 'Impossible d’enregistrer le coffre-fort.'
  }
});
