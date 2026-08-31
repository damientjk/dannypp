import { Texture, TextureSource } from "pixi.js";
import { describe, expect, it } from "vitest";
import { buildCharacterFrames } from "../engineCharacter";
import { CharacterSprite } from "./CharacterSprite";

function frames() {
  const sheet = (width: number) => new Texture({ source: new TextureSource({ width, height: 64 }) });
  return buildCharacterFrames({
    idle: sheet(4 * 32),
    run: sheet(24 * 32),
    reading: sheet(18 * 32),
    phone: sheet(9 * 32),
  });
}

describe("CharacterSprite", () => {
  it("constructs without a renderer and exposes a container", () => {
    const sprite = new CharacterSprite(frames());
    expect(sprite.container.children.length).toBeGreaterThan(0);
    sprite.destroy();
  });

  it("does not throw for any direction/anim combination", () => {
    const sprite = new CharacterSprite(frames());
    for (const anim of ["idle", "run", "read", "phone"] as const) {
      for (const direction of ["up", "down", "left", "right"] as const) {
        expect(() => sprite.setAnimation(anim, direction)).not.toThrow();
      }
    }
    sprite.destroy();
  });
});
