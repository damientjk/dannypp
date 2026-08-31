import type { Agent } from "../types";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import type { Facing } from "./types";

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
  // The jail cell. Still user-b's permission-gated "database" zone on the
  // map -- which keeps roamers out (isGatedTile) and keeps a task that
  // names it deniable -- but it has no desks: nobody works in a jail.
  // Agents caught reaching for another owner's room are teleported here
  // (see jailAgent in agentSim.ts).
  {
    id: "database",
    displayName: "Jail",
    ownerId: "user-b",
    requiresPermission: true,
    deskIds: [],
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
    displayName: "Rest Room",
    ownerId: null,
    requiresPermission: false,
    deskIds: [],
  },
];

/**
 * Which way an agent faces once it arrives at its work spot -- the spots
 * themselves live in room_layout.py's DESKS (single source of truth for
 * positions; this map only sells the pose). Applied by settleAgent the
 * moment heading-to-desk becomes working.
 *
 * - auth-module: both face up into the bookshelves ("searching for a book")
 * - analytics: the two ends of the table-tennis table, facing each other
 * - billing: facing the punching bag / running on the treadmill (up, into
 *   its console)
 * - deploy-config: keyboard player faces up at the keys; drummer stands
 *   north of the kit facing down over it
 */
export const WORK_FACING: Record<string, Facing> = {
  "desk-auth-module-1": "up",
  "desk-auth-module-2": "up",
  "desk-analytics-1": "down",
  "desk-analytics-2": "up",
  "desk-billing-1": "up",
  "desk-billing-2": "up",
  "desk-deploy-config-1": "up",
  "desk-deploy-config-2": "down",
};

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

/** The map zone offenders are teleported into (agentSim.jailAgent): the
 *  Database room's zone, reborn as the jail cell. The id survives from its
 *  Database days because map.json's zone and the decor paths are keyed by it. */
export const JAIL_ROOM_ID = "database";
