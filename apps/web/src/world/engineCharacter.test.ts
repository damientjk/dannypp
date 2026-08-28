import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { buildCharacterFrames } from "./engineCharacter";

describe("buildCharacterFrames", () => {
  it("returns a 3x3 grid where every cell is the given texture", () => {
    const grid = buildCharacterFrames(Texture.WHITE);
    expect(grid.length).toBe(3);
    for (const row of grid) {
      expect(row.length).toBe(3);
      for (const cell of row) {
        expect(cell).toBe(Texture.WHITE);
      }
    }
  });
});
