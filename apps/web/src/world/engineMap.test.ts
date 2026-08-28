import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { TiledMapRenderer } from "./engine/TiledMapRenderer";
import type { TiledMap } from "./engine/TiledMapRenderer";
import { TILE_SIZE } from "./engineMap";

function fixtureMap(): TiledMap {
  const width = 4;
  const height = 3;
  const floor = new Array(width * height).fill(1);
  const collision = new Array(width * height).fill(0);
  collision[0] = 4; // (0,0) is a wall
  return {
    width,
    height,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    tilesets: [{ firstgid: 1, columns: 5, tilewidth: TILE_SIZE, tileheight: TILE_SIZE, tilecount: 5 }],
    layers: [
      { name: "floor", type: "tilelayer", data: floor },
      { name: "collision", type: "tilelayer", data: collision },
      {
        name: "spawn-points",
        type: "objectgroup",
        objects: [{ name: "common", x: TILE_SIZE, y: TILE_SIZE }],
      },
      {
        name: "zones",
        type: "objectgroup",
        objects: [{ name: "house-a", x: 0, y: 0, width: TILE_SIZE * 2, height: TILE_SIZE * 2 }],
      },
    ],
  };
}

describe("TiledMapRenderer against the fixture map (via engineMap's TILE_SIZE)", () => {
  it("derives walkability from the collision layer", () => {
    const renderer = new TiledMapRenderer(fixtureMap(), [Texture.WHITE]);
    expect(renderer.isWalkable(0, 0)).toBe(false);
    expect(renderer.isWalkable(1, 0)).toBe(true);
    expect(renderer.isWalkable(-1, 0)).toBe(false);
  });

  it("resolves named spawn points and zones in tile units", () => {
    const renderer = new TiledMapRenderer(fixtureMap(), [Texture.WHITE]);
    expect(renderer.getSpawnPoint("common")).toEqual({ x: 1, y: 1 });
    expect(renderer.getZone("house-a")).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });
});
