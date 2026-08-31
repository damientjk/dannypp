import type { Agent } from "../types";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";

export interface FileRoom {
  id: string;
  displayName: string;
  ownerId: string | null;
  requiresPermission: boolean;
  deskIds: string[];
  /**
   * The protected resource this room stands for, or null for an open area.
   *
   * This is the join between the drawn world and the guarded backend: entering
   * the room is a real read of this URI, judged by the PDP. A room with a null
   * uri is not a protected resource and no decision is made about it.
   */
  resourceUri: string | null;
}

export const FILE_ROOMS: FileRoom[] = [
  {
    id: "auth-module",
    resourceUri: "res://user-a/notes.md",
    displayName: "Auth Module",
    ownerId: "user-a",
    requiresPermission: true,
    deskIds: ["desk-auth-module-1", "desk-auth-module-2"],
  },
  {
    id: "billing",
    resourceUri: "res://user-a/secret-recipe.txt",
    displayName: "Billing",
    ownerId: "user-a",
    requiresPermission: true,
    deskIds: ["desk-billing-1", "desk-billing-2"],
  },
  {
    id: "database",
    resourceUri: "res://user-b/notes.md",
    displayName: "Database",
    ownerId: "user-b",
    requiresPermission: true,
    deskIds: ["desk-database-1", "desk-database-2"],
  },
  {
    id: "deploy-config",
    resourceUri: "res://user-b/tax-return.txt",
    displayName: "Deploy Config",
    ownerId: "user-b",
    requiresPermission: true,
    deskIds: ["desk-deploy-config-1", "desk-deploy-config-2"],
  },
  {
    id: "analytics",
    resourceUri: "res://user-a/analytics-summary.md",
    displayName: "Analytics",
    ownerId: "user-a",
    requiresPermission: true,
    deskIds: ["desk-analytics-1", "desk-analytics-2"],
  },
  {
    id: "living-room",
    resourceUri: null,
    displayName: "Living Room",
    ownerId: null,
    requiresPermission: false,
    deskIds: [],
  },
];

/** The room standing for a capability's scope, e.g. "read:res://user-a/notes.md". */
export function roomByScope(scope: string): FileRoom | null {
  const uri = scope.slice(scope.indexOf(":") + 1);
  return FILE_ROOMS.find((room) => room.resourceUri === uri) ?? null;
}

/**
 * Rooms a keycard's scope actually opens.
 *
 * DISPLAY ONLY. The backend is still the sole authority on every access -- this
 * exists so the keycard wall and the world's "which card do I present" cache
 * agree with what the owner granted, instead of treating any live card as
 * opening everything. A scope may name one file (`read:res://user-a/notes.md`)
 * or a whole namespace (`read:res://user-a/*`); rooms in another owner's
 * namespace never match, because the scope names exactly one owner.
 */
export function roomsForScope(scope: string): FileRoom[] {
  const separator = scope.indexOf(":");
  if (separator <= 0) return [];
  const actions = scope.slice(0, separator).split(",");
  if (!actions.includes("read")) return [];
  const pattern = scope.slice(separator + 1);
  const matcher = new RegExp(
    "^" +
      pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
  );
  return FILE_ROOMS.filter((room) => room.resourceUri && matcher.test(room.resourceUri));
}

/** The scope a keycard for this room needs: read access to exactly that file. */
export function scopeForRoom(room: FileRoom): string | null {
  return room.resourceUri ? "read:" + room.resourceUri : null;
}

export function roomById(id: string): FileRoom {
  const room = FILE_ROOMS.find((candidate) => candidate.id === id);
  if (!room) throw new Error(`unknown room "${id}"`);
  return room;
}

export function roomsOwnedBy(ownerId: string): FileRoom[] {
  return FILE_ROOMS.filter((room) => room.ownerId === ownerId && room.requiresPermission);
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Deterministic mock job assignment: the same agent always maps to the same
 *  one of its owner's permission-gated rooms. Stands in for real per-file
 *  workspace data, which doesn't exist in the backend today (see spec §9). */
export function assignedRoomFor(agent: Agent): FileRoom | null {
  const owned = roomsOwnedBy(agent.ownerId);
  if (owned.length === 0) return null;
  return owned[hashString(agent.id) % owned.length];
}

/**
 * Which room a task is actually reaching for.
 *
 * An Agent goes where its work points, not where a hash sends it — so the
 * folder it walks to is derived from the prompt it was given. This is also how
 * an Agent ends up at somebody else's door: not by wandering, but because the
 * task it was handed named a resource outside its owner's namespace. That is
 * the realistic failure — an over-broad instruction, or one smuggled in by
 * untrusted content the Agent was asked to read — and the guard refuses it
 * regardless of how it got there.
 *
 * Falls back to the agent's home room when the task names nothing recognisable.
 */
export function roomForTask(prompt: string | null | undefined, agent: Agent): FileRoom | null {
  if (typeof prompt === "string" && prompt.trim().length > 0) {
    const haystack = prompt.toLowerCase();
    let best: { room: FileRoom; length: number; owned: boolean } | null = null;

    for (const room of FILE_ROOMS) {
      for (const alias of aliasesFor(room)) {
        if (!haystack.includes(alias)) continue;
        // Longest alias wins, so "deploy config" beats a bare "deploy". On a
        // tie the Agent's own owner wins -- "notes.md" names a file in BOTH
        // namespaces, and reaching for your own copy is the ordinary reading.
        const ownsIt = room.ownerId === agent.ownerId;
        if (!best || alias.length > best.length) {
          best = { room, length: alias.length, owned: ownsIt };
        } else if (alias.length === best.length && ownsIt && !best.owned) {
          best = { room, length: alias.length, owned: ownsIt };
        }
      }
    }
    if (best) return best.room;
  }
  return assignedRoomFor(agent);
}

/** Lowercase strings in a prompt that should point at this room. */
function aliasesFor(room: FileRoom): string[] {
  const name = room.displayName.toLowerCase();
  const id = room.id.toLowerCase();
  const aliases = new Set<string>([name, id, id.replace(/-/g, " ")]);
  // A distinctive first word ("database", "billing", "analytics") is how
  // people actually refer to these in a sentence.
  const firstWord = name.split(" ")[0];
  if (firstWord.length >= 5) aliases.add(firstWord);
  // The file the room stands for. People write the task in terms of the file
  // they want read ("read inbox/secret-recipe.txt"), never the room's display
  // name -- without this, every such prompt matched nothing and the Agent fell
  // back to its hashed home room, so two Agents reading the SAME file walked
  // to different doors.
  if (room.resourceUri) {
    const fileName = room.resourceUri.slice(room.resourceUri.lastIndexOf("/") + 1);
    aliases.add(fileName.toLowerCase());
    const dot = fileName.lastIndexOf(".");
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    if (stem.length >= 5) aliases.add(stem.toLowerCase());
  }
  return [...aliases];
}

/** True if the tile falls inside a permission-gated room's zone — used to
 *  keep free-roam wandering out of file-rooms entirely (spec §4). */
export function isGatedTile(renderer: TiledMapRenderer, x: number, y: number): boolean {
  for (const room of FILE_ROOMS) {
    if (!room.requiresPermission) continue;
    const zone = renderer.getZone(room.id);
    if (!zone) continue;
    if (x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height) {
      return true;
    }
  }
  return false;
}
