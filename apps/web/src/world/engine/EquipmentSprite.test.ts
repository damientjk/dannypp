import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { EquipmentSprite } from "./EquipmentSprite";

describe("EquipmentSprite", () => {
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
