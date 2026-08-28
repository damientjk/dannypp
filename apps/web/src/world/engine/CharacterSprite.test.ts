import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { CharacterSprite } from "./CharacterSprite";

function frameGrid(): Texture[][] {
  return [
    [Texture.WHITE, Texture.WHITE, Texture.WHITE],
    [Texture.WHITE, Texture.WHITE, Texture.WHITE],
    [Texture.WHITE, Texture.WHITE, Texture.WHITE],
  ];
}

describe("CharacterSprite", () => {
  it("constructs without a renderer and exposes a container", () => {
    const sprite = new CharacterSprite(frameGrid());
    expect(sprite.container.children.length).toBeGreaterThan(0);
    sprite.destroy();
  });

  it("does not throw for any direction/anim combination", () => {
    const sprite = new CharacterSprite(frameGrid());
    for (const anim of ["walk", "type", "read", "idle"] as const) {
      for (const direction of ["up", "down", "left", "right"] as const) {
        expect(() => sprite.setAnimation(anim, direction)).not.toThrow();
      }
    }
    sprite.destroy();
  });

  it("setTint applies a tint to the underlying sprite", () => {
    const sprite = new CharacterSprite(frameGrid());
    sprite.setTint(0xc55353);
    const inner = sprite.container.children[0] as { tint: number };
    expect(inner.tint).toBe(0xc55353);
    sprite.setTint(0xffffff);
    expect(inner.tint).toBe(0xffffff);
    sprite.destroy();
  });
});
