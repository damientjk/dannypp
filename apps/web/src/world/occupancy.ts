/**
 * Tile occupancy — the reason two agents never overlap or pass through each
 * other.
 *
 * A moving agent holds TWO tiles: the one it is leaving and the one it is
 * stepping into. Holding only the destination would let a second agent slide
 * into the tile being vacated mid-step (visually, the two sprites pass through
 * one another). Holding both also makes the head-on swap case — A stepping
 * into B's tile while B steps into A's — resolve as a mutual block instead of
 * the two walking straight through each other.
 *
 * Purely positional: this module knows nothing about policy. Being blocked by
 * a neighbour is a movement outcome, never an authorization one.
 */

import type { WorldAgent } from "./types";

export interface Tile {
  x: number;
  y: number;
}

/** Minimal view of the map that occupancy needs. */
export interface TileGrid {
  pixelToTile(x: number, y: number): Tile;
}

export const tileKey = (tile: Tile): string => tile.x + "," + tile.y;

/**
 * Every tile an agent currently reserves. One tile when standing still, two
 * while a step is in flight.
 */
export function occupiedTiles(agent: WorldAgent, grid: TileGrid): Tile[] {
  const standing = grid.pixelToTile(agent.x, agent.y);
  if (agent.status !== "walking") return [standing];

  const entering = grid.pixelToTile(agent.targetX, agent.targetY);
  return tileKey(standing) === tileKey(entering) ? [standing] : [standing, entering];
}

/** tileKey -> agentId. Later agents do not evict earlier ones. */
export function buildOccupancy(
  agents: readonly WorldAgent[],
  grid: TileGrid,
): Map<string, string> {
  const occupancy = new Map<string, string>();
  for (const agent of agents) {
    for (const tile of occupiedTiles(agent, grid)) {
      const key = tileKey(tile);
      if (!occupancy.has(key)) occupancy.set(key, agent.agentId);
    }
  }
  return occupancy;
}

/** True when some OTHER agent holds this tile. An agent never blocks itself. */
export function isBlocked(
  occupancy: ReadonlyMap<string, string>,
  tile: Tile,
  selfId: string,
): boolean {
  const holder = occupancy.get(tileKey(tile));
  return holder !== undefined && holder !== selfId;
}
