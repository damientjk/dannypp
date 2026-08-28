/**
 * Where inside a room an agent actually stands.
 *
 * A permitted agent walks THROUGH the door and into the room, because the room
 * is the visualisation of a resource namespace — stopping at the threshold
 * would show an agent that was allowed in but never went in. A denied agent
 * only ever reaches the door.
 *
 * Standing spots are handed out one per agent so a room holding several agents
 * stays readable. This is presentation only: which tile an agent stands on has
 * no bearing on what it is allowed to read.
 */

import { tileKey, type Tile } from "./occupancy";

export interface ZoneLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Walkable tiles of a room in a stable order: back rows first, so early
 * arrivals settle deep in the room and later ones fill toward the door,
 * instead of everyone clustering on the threshold.
 */
export function interiorTiles(
  zone: ZoneLike,
  isWalkable: (x: number, y: number) => boolean,
): Tile[] {
  const tiles: Tile[] = [];
  for (let y = zone.y; y < zone.y + zone.height; y += 1) {
    for (let x = zone.x; x < zone.x + zone.width; x += 1) {
      if (isWalkable(x, y)) tiles.push({ x, y });
    }
  }
  return tiles;
}

/**
 * The first interior tile nobody is standing on, or null when the room is full
 * (callers fall back to the door rather than stacking agents).
 */
export function pickInteriorTile(
  zone: ZoneLike,
  isWalkable: (x: number, y: number) => boolean,
  taken: ReadonlySet<string>,
): Tile | null {
  for (const tile of interiorTiles(zone, isWalkable)) {
    if (!taken.has(tileKey(tile))) return tile;
  }
  return null;
}
