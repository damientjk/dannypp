import { describe, expect, it } from "vitest";
import {
  TILE_SIZE,
  doorPixelPosition,
  roomById,
  spawnPixelPosition,
  tileToPixel,
} from "./map";

describe("world map", () => {
  it("converts a tile coordinate to pixels", () => {
    expect(tileToPixel(3)).toBe(3 * TILE_SIZE);
  });

  it("finds room bounds by id", () => {
    const houseA = roomById("house-a");
    expect(houseA.id).toBe("house-a");
    expect(houseA.width).toBeGreaterThan(0);
  });

  it("throws for an unknown room id", () => {
    // @ts-expect-error deliberately invalid id for the runtime check
    expect(() => roomById("house-c")).toThrow();
  });

  it("computes a door's pixel position from its tile position", () => {
    const houseB = roomById("house-b");
    const door = doorPixelPosition("house-b");
    expect(door).toEqual({ x: tileToPixel(houseB.doorX), y: tileToPixel(houseB.doorY) });
  });

  it("gives a spawn position inside the common area", () => {
    const common = roomById("common");
    const spawn = spawnPixelPosition();
    expect(spawn.x).toBeGreaterThanOrEqual(tileToPixel(common.x));
    expect(spawn.x).toBeLessThan(tileToPixel(common.x + common.width));
    expect(spawn.y).toBeGreaterThanOrEqual(tileToPixel(common.y));
    expect(spawn.y).toBeLessThan(tileToPixel(common.y + common.height));
  });
});
