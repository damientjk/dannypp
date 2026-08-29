// Animated equipment prop (punching bag, treadmill, piano, ...) that plays
// its spritesheet loop while a work-spot is occupied, and holds on frame 0
// otherwise. Mirrors CharacterSprite's container+AnimatedSprite pattern,
// but there's no direction/multi-anim grid here -- just one row-0 loop per
// prop, sliced the same way TiledMapRenderer.textureForGid crops a GID.

import { AnimatedSprite, Container, Rectangle, Texture } from "pixi.js";

const FRAME_SIZE = 32;

export class EquipmentSprite {
  readonly container: Container;
  private sprite: AnimatedSprite;
  private working = false;

  constructor(sheet: Texture, frameCount: number) {
    const frames: Texture[] = [];
    for (let i = 0; i < frameCount; i++) {
      frames.push(
        new Texture({ source: sheet.source, frame: new Rectangle(i * FRAME_SIZE, 0, FRAME_SIZE, FRAME_SIZE) }),
      );
    }
    this.container = new Container();
    this.sprite = new AnimatedSprite(frames);
    this.sprite.animationSpeed = 0.15;
    this.sprite.gotoAndStop(0);
    this.container.addChild(this.sprite);
  }

  setPosition(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  /** Plays the loop while occupied; holds frame 0 the rest of the time. A
   *  no-op when called with the state it's already in, so WorldCanvas's
   *  per-frame tick can call this unconditionally without restarting the
   *  animation every frame. */
  setWorking(working: boolean): void {
    if (working === this.working) return;
    this.working = working;
    if (working) this.sprite.play();
    else this.sprite.gotoAndStop(0);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
