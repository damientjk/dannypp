import { Texture, TextureSource } from "pixi.js";
import { describe, expect, it } from "vitest";
import { buildCharacterFrames } from "./engineCharacter";

/** A texture of the given sheet dimensions — no pixels needed, the slicer
 *  only reads width and cuts frame rectangles. */
function sheet(width: number): Texture {
  return new Texture({ source: new TextureSource({ width, height: 64 }) });
}

function agentSheets() {
  return {
    idle: sheet(4 * 32),
    run: sheet(24 * 32),
    reading: sheet(18 * 32),
    phone: sheet(9 * 32),
  };
}

describe("buildCharacterFrames", () => {
  it("slices idle into 1 frame and run into 6 frames per direction", () => {
    const frames = buildCharacterFrames(agentSheets());
    for (const direction of ["right", "up", "left", "down"] as const) {
      expect(frames.idle[direction]).toHaveLength(1);
      expect(frames.run[direction]).toHaveLength(6);
    }
  });

  it("keeps the sheet's right/up/left/down direction order", () => {
    const frames = buildCharacterFrames(agentSheets());
    // idle: one 32px frame per direction, in sheet order
    expect(frames.idle.right[0].frame.x).toBe(0);
    expect(frames.idle.up[0].frame.x).toBe(32);
    expect(frames.idle.left[0].frame.x).toBe(64);
    expect(frames.idle.down[0].frame.x).toBe(96);
    // run: 6-frame blocks per direction
    expect(frames.run.up[0].frame.x).toBe(6 * 32);
    expect(frames.run.down[5].frame.x).toBe(23 * 32);
  });

  it("slices the down-facing reading and phone loops whole", () => {
    const frames = buildCharacterFrames(agentSheets());
    expect(frames.read).toHaveLength(18);
    expect(frames.phone).toHaveLength(9);
    expect(frames.read[17].frame.x).toBe(17 * 32);
  });
});
