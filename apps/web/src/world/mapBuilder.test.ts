import { describe, expect, it } from "vitest";
import { Texture } from "pixi.js";
import { TiledMapRenderer } from "./engine/TiledMapRenderer";
import { buildWorldMap, mapSize, placeRooms, ROOM_OUTER_H } from "./mapBuilder";
import { listFolderRooms, type FolderRoom } from "./folders";

const rooms: FolderRoom[] = listFolderRooms();

function render(of: readonly FolderRoom[] = rooms): TiledMapRenderer {
  return new TiledMapRenderer(buildWorldMap(of), [Texture.WHITE]);
}

describe("placeRooms", () => {
  it("places one room per folder without overlapping interiors", () => {
    const placements = placeRooms(rooms);
    const seen = new Set<string>();

    expect(placements).toHaveLength(rooms.length);
    for (const placement of placements) {
      for (let x = 0; x < placement.interior.width; x += 1) {
        const key = placement.interior.x + x + ":" + placement.interior.y;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("puts every door in the room's bottom wall row", () => {
    for (const placement of placeRooms(rooms)) {
      expect(placement.door.y).toBe(ROOM_OUTER_H - 1);
    }
  });
});

describe("buildWorldMap", () => {
  it("sizes the map to the number of folders", () => {
    const map = buildWorldMap(rooms);
    const expected = mapSize(rooms.length);

    expect(map.width).toBe(expected.width);
    expect(map.height).toBe(expected.height);
  });

  it("names a zone after every folder so rooms can be looked up by URI", () => {
    const renderer = render();

    for (const room of rooms) {
      expect(renderer.getZone(room.id)).toBeDefined();
    }
  });

  it("gives every folder a door spawn point", () => {
    const renderer = render();

    for (const room of rooms) {
      expect(renderer.getSpawnPoint(room.id + "-door")).toBeDefined();
    }
  });

  it("makes room interiors walkable and the surrounding wall solid", () => {
    const renderer = render();
    const [first] = placeRooms(rooms);

    expect(renderer.isWalkable(first.interior.x, first.interior.y)).toBe(true);
    expect(renderer.isWalkable(first.interior.x - 1, first.interior.y)).toBe(false);
  });

  it("opens the doorway so a room is reachable from the corridor", () => {
    const renderer = render();

    for (const placement of placeRooms(rooms)) {
      expect(renderer.isWalkable(placement.door.x, placement.door.y)).toBe(true);
      expect(renderer.isWalkable(placement.door.x, placement.door.y + 1)).toBe(true);
    }
  });

  it("leaves the corridor fully open beneath the rooms", () => {
    const renderer = render();

    for (let x = 0; x < renderer.width; x += 1) {
      expect(renderer.isWalkable(x, ROOM_OUTER_H)).toBe(true);
    }
  });

  it("spawns agents in the corridor, not inside somebody's room", () => {
    const renderer = render();
    const spawn = renderer.getSpawnPoint("common");

    expect(spawn).toBeDefined();
    expect(spawn!.y).toBeGreaterThanOrEqual(ROOM_OUTER_H);
    expect(renderer.isWalkable(spawn!.x, spawn!.y)).toBe(true);
  });

  it("survives a single-folder tree", () => {
    const renderer = render([rooms[0]]);

    expect(renderer.getZone(rooms[0].id)).toBeDefined();
  });
});
