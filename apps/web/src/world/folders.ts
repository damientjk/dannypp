/**
 * The folder tree the world is drawn from.
 *
 * One room per folder, one chest per file. The shape here deliberately mirrors
 * what `GET /api/resources` returns on the backend branch (a flat list of
 * `res://<ownerId>/<path>` URIs), so swapping the mock source for the real
 * fetch is a change of source, not a change of model.
 */

export interface FolderRoom {
  /** Canonical folder URI, e.g. "res://user-a/notes". Also the room id. */
  id: string;
  ownerId: string;
  /** Display label shown over the room, e.g. "notes/". */
  label: string;
  /** File names inside the folder (not full URIs). */
  files: string[];
}

/**
 * Placeholder tree standing in for the resource store until
 * `person3/capabilities` is merged. Contents are obviously fake so nothing
 * here can be mistaken for a real credential in a screenshot.
 */
const MOCK_TREE: Record<string, Record<string, string[]>> = {
  "user-a": {
    notes: ["today.md", "ideas.md"],
    finance: ["budget.csv"],
    private: ["secret-recipe.txt"],
  },
  "user-b": {
    notes: ["standup.md"],
    tax: ["tax-return.txt"],
  },
};

export function folderUri(ownerId: string, folder: string): string {
  return "res://" + ownerId + "/" + folder;
}

export function fileUri(room: FolderRoom, file: string): string {
  return room.id + "/" + file;
}

/** Every folder room, owners in a stable order. */
export function listFolderRooms(): FolderRoom[] {
  const rooms: FolderRoom[] = [];
  for (const ownerId of Object.keys(MOCK_TREE).sort()) {
    for (const folder of Object.keys(MOCK_TREE[ownerId]).sort()) {
      rooms.push({
        id: folderUri(ownerId, folder),
        ownerId,
        label: folder + "/",
        files: [...MOCK_TREE[ownerId][folder]],
      });
    }
  }
  return rooms;
}

/** Every file URI in the tree, in room order. */
export function listFileUris(rooms: readonly FolderRoom[]): string[] {
  return rooms.flatMap((room) => room.files.map((file) => fileUri(room, file)));
}

/** The room a file URI belongs to, or undefined if it names no known folder. */
export function roomForFile(
  rooms: readonly FolderRoom[],
  uri: string,
): FolderRoom | undefined {
  return rooms.find((room) => uri.startsWith(room.id + "/"));
}
