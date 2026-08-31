import type { Agent } from "../types";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";

export interface FileRoom {
  id: string;
  displayName: string;
  ownerId: string | null;
  requiresPermission: boolean;
  deskIds: string[];
}

export const FILE_ROOMS: FileRoom[] = [
  {
    id: "auth-module",
    displayName: "Auth Module",
    ownerId: "user-a",
    requiresPermission: true,
    deskIds: ["desk-auth-module-1", "desk-auth-module-2"],
  },
  {
    id: "billing",
    displayName: "Billing",
    ownerId: "user-a",
    requiresPermission: true,
    deskIds: ["desk-billing-1", "desk-billing-2"],
  },
  {
    id: "database",
    displayName: "Database",
    ownerId: "user-b",
    requiresPermission: true,
    deskIds: ["desk-database-1", "desk-database-2"],
  },
  {
    id: "deploy-config",
    displayName: "Deploy Config",
    ownerId: "user-b",
    requiresPermission: true,
    deskIds: ["desk-deploy-config-1", "desk-deploy-config-2"],
  },
  {
    id: "analytics",
    displayName: "Analytics",
    ownerId: "user-a",
    requiresPermission: true,
    deskIds: ["desk-analytics-1", "desk-analytics-2"],
  },
  {
    id: "living-room",
    displayName: "Living Room",
    ownerId: null,
    requiresPermission: false,
    deskIds: [],
  },
];

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
    let best: { room: FileRoom; length: number } | null = null;

    for (const room of FILE_ROOMS) {
      for (const alias of aliasesFor(room)) {
        if (!haystack.includes(alias)) continue;
        // Longest alias wins, so "deploy config" beats a bare "deploy".
        if (!best || alias.length > best.length) best = { room, length: alias.length };
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
