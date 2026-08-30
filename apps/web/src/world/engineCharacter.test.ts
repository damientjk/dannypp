import { Texture, TextureSource } from "pixi.js";
import { describe, expect, it } from "vitest";
import { buildCharacterFrames } from "./engineCharacter";

/** Stand-in for the loaded 96x96 crewmate sheet (3 facings x 3 walk frames). */
function sheet(): Texture {
  return new Texture({ source: new TextureSource({ width: 96, height: 96 }) });
}

describe("buildCharacterFrames", () => {
  it("returns a 3x3 grid of 32px frames", () => {
    const grid = buildCharacterFrames(sheet());
    expect(grid.length).toBe(3);
    for (const row of grid) {
      expect(row.length).toBe(3);
      for (const cell of row) {
        expect(cell.frame.width).toBe(32);
        expect(cell.frame.height).toBe(32);
      }
    }
  });

  it("slices distinct sub-rectangles rather than repeating one texture", () => {
    const grid = buildCharacterFrames(sheet());
    const origins = grid.flatMap((row) => row.map((cell) => `${cell.frame.x},${cell.frame.y}`));
    expect(new Set(origins).size).toBe(9);
  });

  it("maps row to facing and column to walk frame", () => {
    const grid = buildCharacterFrames(sheet());
    // Row index is the facing (DIRECTION_ROW: down/up/right) -> y offset.
    expect(grid[0][0].frame.y).toBe(0);
    expect(grid[1][0].frame.y).toBe(32);
    expect(grid[2][0].frame.y).toBe(64);
    // Column index is the animation frame -> x offset.
    expect(grid[0][1].frame.x).toBe(32);
    expect(grid[0][2].frame.x).toBe(64);
  });

  it("shares one source across every frame so the sheet uploads once", () => {
    const grid = buildCharacterFrames(sheet());
    const sources = new Set(grid.flat().map((cell) => cell.source));
    expect(sources.size).toBe(1);
  });
});
