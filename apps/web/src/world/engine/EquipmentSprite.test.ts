import { AnimatedSprite, Rectangle, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { EquipmentSprite } from "./EquipmentSprite";

describe("EquipmentSprite", () => {
  it("crops frames to the sheet's real height and anchors at the base, not top-left", () => {
    // Regression test for the bug fixed in f63f749: EquipmentSprite used to
    // hardcode a 32x32 crop and anchor at (0,0), so anything taller than one
    // tile (every real equipment sheet) had everything past the first 32px
    // silently discarded and, if crop-only fixed, would overflow downward.
    // A 128-wide, 96-tall sheet (4 frames of 32x96, built on Texture.WHITE's
    // source the same way TiledMapRenderer crops arbitrary frame rects out
    // of a base texture in its own tests) stands in for a real spritesheet
    // without needing an image file.
    const sheet = new Texture({ source: Texture.WHITE.source, frame: new Rectangle(0, 0, 128, 96) });
    const sprite = new EquipmentSprite(sheet, 4);

    const inner = sprite.container.children[0] as AnimatedSprite;
    expect(inner.texture.frame.height).toBe(96); // not the old hardcoded 32
    expect(inner.texture.frame.width).toBe(32); // FRAME_WIDTH is still fixed per-frame
    expect(inner.anchor.x).toBe(0);
    expect(inner.anchor.y).toBe(1); // bottom-left, not top-left (0,0)

    sprite.destroy();
  });

  it("constructs without a renderer and exposes a container", () => {
    const sprite = new EquipmentSprite(Texture.WHITE, 4);
    expect(sprite.container.children.length).toBeGreaterThan(0);
    sprite.destroy();
  });

  it("does not throw when toggled working on/off, including repeat calls", () => {
    const sprite = new EquipmentSprite(Texture.WHITE, 4);
    expect(() => {
      sprite.setWorking(true);
      sprite.setWorking(true); // no-op path when state doesn't change
      sprite.setWorking(false);
      sprite.setWorking(false);
    }).not.toThrow();
    sprite.destroy();
  });

  it("positions its container", () => {
    const sprite = new EquipmentSprite(Texture.WHITE, 4);
    sprite.setPosition(64, 96);
    expect(sprite.container.x).toBe(64);
    expect(sprite.container.y).toBe(96);
    sprite.destroy();
  });
});
