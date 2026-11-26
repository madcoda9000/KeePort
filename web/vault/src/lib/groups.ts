import * as kdbxweb from 'kdbxweb';
import messages from '../i18n/lib-groups.ts';
import { translate } from '../../../shared/i18n/core.ts';

/** Longest folder name KeePort accepts; KDBX itself has no limit, but longer names break every client's layout. */
export const MAX_FOLDER_NAME_LENGTH = 255;

/** One KDBX group as shown in the folder tree. */
export interface FolderNode {
  id: string;
  name: string;
  /** Names from the root down to this folder, joined with " / " like the entry group path. */
  path: string;
  parentId: string | null;
  depth: number;
  /** Entries directly in this folder. */
  entryCount: number;
  /** Entries in this folder and all of its subfolders. */
  totalEntryCount: number;
  isRoot: boolean;
  isRecycleBin: boolean;
  /** Whether the folder is the recycle bin or lies inside it. */
  inRecycleBin: boolean;
  isTemplates: boolean;
  children: FolderNode[];
}

/**
 * Checks whether a group is the one a KDBX meta reference points to.
 * @param group - The group to check.
 * @param uuid - The UUID stored in the database metadata, if any.
 */
function isReferenced(group: kdbxweb.KdbxGroup, uuid: kdbxweb.KdbxUuid | undefined): boolean {
  return Boolean(uuid && !uuid.empty && group.uuid.equals(uuid));
}

/**
 * Builds the folder node for a group and its subfolders, keeping the KDBX order but moving the recycle bin last.
 * @param db - The unlocked database providing the recycle bin and template references.
 * @param group - The group to convert.
 * @param parent - The already built parent node, or null for a root group.
 */
function buildNode(db: kdbxweb.Kdbx, group: kdbxweb.KdbxGroup, parent: FolderNode | null): FolderNode {
  const name = group.name || (parent ? 'Group' : 'Root');
  const isRecycleBin = isReferenced(group, db.meta.recycleBinUuid);
  const node: FolderNode = {
    id: group.uuid.id,
    name,
    path: parent ? `${parent.path} / ${name}` : name,
    parentId: parent?.id ?? null,
    depth: parent ? parent.depth + 1 : 0,
    entryCount: group.entries.length,
    totalEntryCount: group.entries.length,
    isRoot: parent === null,
    isRecycleBin,
    inRecycleBin: isRecycleBin || Boolean(parent?.inRecycleBin),
    isTemplates: isReferenced(group, db.meta.entryTemplatesGroup),
    children: []
  };
  for (const child of group.groups) {
    const childNode = buildNode(db, child, node);
    node.totalEntryCount += childNode.totalEntryCount;
    node.children.push(childNode);
  }
  node.children.sort(/**
   * Keeps the KDBX order (the sort is stable) and only moves the recycle bin to the end.
   * @param a - The first child folder.
   * @param b - The second child folder.
   */ (a, b) => Number(a.isRecycleBin) - Number(b.isRecycleBin));
  return node;
}

/**
 * Returns the folder tree of the database, one node per root group (KDBX files normally have exactly one).
 * @param db - The unlocked database to read.
 */
export function listFolders(db: kdbxweb.Kdbx): FolderNode[] {
  return db.groups.map(/**
   * Converts one root group into a tree.
   * @param group - A root group of the database.
   */ (group) => buildNode(db, group, null));
}

/**
 * Flattens a folder tree depth-first, parents before their children.
 * @param nodes - The folder nodes to flatten.
 */
export function flattenFolders(nodes: readonly FolderNode[]): FolderNode[] {
  return nodes.flatMap(/**
   * Emits a folder followed by its flattened subfolders.
   * @param node - One folder node.
   */ (node) => [node, ...flattenFolders(node.children)]);
}

/**
 * Finds a folder anywhere in a folder tree.
 * @param folders - The folders to search, including their subfolders.
 * @param folderId - The ID to look for.
 */
export function findFolder(folders: readonly FolderNode[], folderId: string): FolderNode | null {
  for (const folder of folders) {
    if (folder.id === folderId) return folder;
    const child = findFolder(folder.children, folderId);
    if (child) return child;
  }
  return null;
}

/**
 * Finds a group anywhere in the database by its UUID or throws if it does not exist.
 * @param db - The unlocked database to search.
 * @param groupId - The base64 UUID of the group.
 */
export function requireGroup(db: kdbxweb.Kdbx, groupId: string): kdbxweb.KdbxGroup {
  const group = db.getGroup(groupId);
  if (!group) throw new Error(translate(messages, 'folderMissing'));
  return group;
}

/**
 * Returns the root group that new top-level entries and folders go into.
 * @param db - The unlocked database.
 */
export function rootGroup(db: kdbxweb.Kdbx): kdbxweb.KdbxGroup {
  if (!db.groups[0]) db.createDefaultGroup();
  return db.getDefaultGroup();
}

/**
 * Checks whether a group is the recycle bin or inside it.
 * @param db - The unlocked database providing the recycle bin reference.
 * @param group - The group to check.
 */
function isInRecycleBin(db: kdbxweb.Kdbx, group: kdbxweb.KdbxGroup): boolean {
  for (let current: kdbxweb.KdbxGroup | undefined = group; current; current = current.parentGroup) {
    if (isReferenced(current, db.meta.recycleBinUuid)) return true;
  }
  return false;
}

/**
 * Validates a folder name for a parent and returns an error message, or null when the name can be used.
 * @param db - The unlocked database containing the parent.
 * @param parentId - The base64 UUID of the folder that will contain the named folder.
 * @param name - The proposed folder name.
 * @param exceptId - The folder being renamed, which may keep its own name; omit when creating a folder.
 */
export function folderNameError(db: kdbxweb.Kdbx, parentId: string, name: string, exceptId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return translate(messages, 'nameRequired');
  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) return translate(messages, 'nameTooLong', { max: MAX_FOLDER_NAME_LENGTH });
  const parent = db.getGroup(parentId);
  if (!parent) return translate(messages, 'parentMissing');
  const duplicate = parent.groups.some(/**
   * Detects a sibling with the same name, ignoring case, other than the folder being renamed.
   * @param sibling - One existing subfolder of the parent.
   */ (sibling) => sibling.uuid.id !== exceptId && (sibling.name ?? '').trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase());
  return duplicate ? translate(messages, 'duplicate', { name: trimmed }) : null;
}

/**
 * Throws the validation message for a folder name if it cannot be used.
 * @param db - The unlocked database containing the parent.
 * @param parentId - The base64 UUID of the containing folder.
 * @param name - The proposed folder name.
 * @param exceptId - The folder being renamed, if any.
 */
function assertFolderName(db: kdbxweb.Kdbx, parentId: string, name: string, exceptId?: string) {
  const error = folderNameError(db, parentId, name, exceptId);
  if (error) throw new Error(error);
}

/**
 * Creates a folder inside another folder; the recycle bin and its subfolders cannot receive new folders.
 * @param db - The unlocked database to change.
 * @param parentId - The base64 UUID of the folder that receives the new folder.
 * @param name - The name of the new folder.
 */
export function createFolder(db: kdbxweb.Kdbx, parentId: string, name: string): kdbxweb.KdbxGroup {
  const parent = requireGroup(db, parentId);
  if (isInRecycleBin(db, parent)) throw new Error(translate(messages, 'createInRecycleBin'));
  assertFolderName(db, parentId, name);
  return db.createGroup(parent, name.trim());
}

/**
 * Renames a folder; the root folder and the recycle bin keep their names.
 * @param db - The unlocked database to change.
 * @param groupId - The base64 UUID of the folder to rename.
 * @param name - The new folder name.
 */
export function renameFolder(db: kdbxweb.Kdbx, groupId: string, name: string) {
  const group = requireGroup(db, groupId);
  if (!group.parentGroup) throw new Error(translate(messages, 'renameRoot'));
  if (isReferenced(group, db.meta.recycleBinUuid)) throw new Error(translate(messages, 'renameRecycleBin'));
  assertFolderName(db, group.parentGroup.uuid.id, name, groupId);
  group.name = name.trim();
  group.times.update();
}

/**
 * Deletes an empty folder permanently. kdbxweb records it as a deleted object so other KeePass clients drop it when
 * they merge instead of bringing it back.
 * @param db - The unlocked database to change.
 * @param groupId - The base64 UUID of the folder to delete.
 */
export function deleteFolder(db: kdbxweb.Kdbx, groupId: string) {
  const group = requireGroup(db, groupId);
  if (!group.parentGroup) throw new Error(translate(messages, 'deleteRoot'));
  if (isReferenced(group, db.meta.recycleBinUuid)) throw new Error(translate(messages, 'deleteRecycleBin'));
  if (group.entries.length || group.groups.length) throw new Error(translate(messages, 'deleteNotEmpty'));
  db.move(group, null);
}

/**
 * Moves entries into a folder and returns how many actually changed folders. Moving out of the recycle bin restores
 * entries; moving into it is not offered because that would be a deletion.
 * @param db - The unlocked database to change.
 * @param entryIds - The base64 UUIDs of the entries to move.
 * @param targetId - The base64 UUID of the destination folder.
 */
export function moveEntries(db: kdbxweb.Kdbx, entryIds: Iterable<string>, targetId: string): number {
  const target = requireGroup(db, targetId);
  if (isInRecycleBin(db, target)) throw new Error(translate(messages, 'moveToRecycleBin'));
  const wanted = new Set(entryIds);
  const all = db.groups.flatMap(/**
   * Collects the entries of one root group and all its subgroups.
   * @param group - A root group of the database.
   */ (group) => [...group.allEntries()]);
  const entries = all.filter(/**
   * Selects the requested entries; entries inside history are not part of any group and are never matched.
   * @param entry - One entry of the database.
   */ (entry) => wanted.has(entry.uuid.id));
  if (entries.length !== wanted.size) throw new Error(translate(messages, 'entriesMissing'));
  let moved = 0;
  for (const entry of entries) {
    if (entry.parentGroup === target) continue;
    db.move(entry, target);
    moved += 1;
  }
  return moved;
}

/** Raised when a vault change could not be saved; carries the vault reloaded from the last saved state. */
export class VaultChangeError extends Error {
  /** The database reloaded from the last saved bytes, or null if reloading failed too. */
  readonly restored: kdbxweb.Kdbx | null;

  /**
   * Wraps the original failure together with the restored database.
   * @param cause - The error that made the change or the save fail.
   * @param restored - The database reloaded from the last saved bytes, or null if reloading failed too.
   */
  constructor(cause: unknown, restored: kdbxweb.Kdbx | null) {
    super(cause instanceof Error ? cause.message : translate(messages, 'saveFailed'), { cause });
    this.name = 'VaultChangeError';
    this.restored = restored;
  }
}

/**
 * Applies a structural change to the open vault and saves it. If the change or the save fails, the vault is reloaded
 * from the last saved encrypted bytes with the same credentials, so the browser view matches the server again.
 * @param db - The unlocked database to change.
 * @param savedBytes - The encrypted bytes of the last successfully loaded or saved revision.
 * @param change - The function performing the change in memory; its return value is passed through.
 * @param persist - The callback that writes the encrypted KDBX with the current ETag.
 */
export async function applyVaultChange<R, T>(
  db: kdbxweb.Kdbx,
  savedBytes: Uint8Array,
  change: (db: kdbxweb.Kdbx) => R,
  persist: (bytes: Uint8Array) => Promise<T>
): Promise<{ result: R; updated: T; bytes: Uint8Array }> {
  try {
    const result = change(db);
    const bytes = new Uint8Array(await db.save());
    return { result, updated: await persist(bytes), bytes };
  } catch (error) {
    let restored: kdbxweb.Kdbx | null = null;
    try {
      restored = await kdbxweb.Kdbx.load(savedBytes.slice().buffer, db.credentials);
    } catch {
      restored = null;
    }
    throw new VaultChangeError(error, restored);
  }
}
