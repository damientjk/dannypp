import { describe, expect, it } from "vitest";
import { interiorTiles, pickInteriorTile } from "./roomLayout";
import { tileKey } from "./occupancy";

const ZONE = { x: 1, y: 1, width: 3, height: 2 };
const allWalkable = () => true;

describe("interiorTiles", () => {
  it("lists every walkable tile inside the zone", () => {
    expect(interiorTiles(ZONE, allWalkable)).toHaveLength(6);
  });

  it("stays within the zone bounds", () => {
    for (const tile of interiorTiles(ZONE, allWalkable)) {
      expect(tile.x).toBeGreaterThanOrEqual(ZONE.x);
      expect(tile.x).toBeLessThan(ZONE.x + ZONE.width);
      expect(tile.y).toBeGreaterThanOrEqual(ZONE.y);
      expect(tile.y).toBeLessThan(ZONE.y + ZONE.height);
    }
  });

  it("skips tiles the map marks unwalkable", () => {
    const blocked = (x: number, y: number) => !(x === 2 && y === 1);

    const tiles = interiorTiles(ZONE, blocked);

    expect(tiles).toHaveLength(5);
    expect(tiles.some((tile) => tile.x === 2 && tile.y === 1)).toBe(false);
  });

  it("orders back rows first so arrivals settle away from the door", () => {
    const [first] = interiorTiles(ZONE, allWalkable);

    expect(first).toEqual({ x: 1, y: 1 });
  });
});

describe("pickInteriorTile", () => {
  it("returns the first free tile", () => {
    expect(pickInteriorTile(ZONE, allWalkable, new Set())).toEqual({ x: 1, y: 1 });
  });

  it("skips tiles other agents already stand on", () => {
    const taken = new Set([tileKey({ x: 1, y: 1 }), tileKey({ x: 2, y: 1 })]);

    expect(pickInteriorTile(ZONE, allWalkable, taken)).toEqual({ x: 3, y: 1 });
  });

  it("gives each agent a distinct spot as the room fills", () => {
    const taken = new Set<string>();
    const spots = [];
    for (let count = 0; count < 6; count += 1) {
      const tile = pickInteriorTile(ZONE, allWalkable, taken);
      expect(tile).not.toBeNull();
      taken.add(tileKey(tile!));
      spots.push(tileKey(tile!));
    }

    expect(new Set(spots).size).toBe(6);
  });

  it("returns null once the room is full so the caller can fall back", () => {
    const taken = new Set(interiorTiles(ZONE, allWalkable).map(tileKey));

    expect(pickInteriorTile(ZONE, allWalkable, taken)).toBeNull();
  });
});
