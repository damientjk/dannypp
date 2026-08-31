// Animated equipment prop (punching bag, treadmill, piano, ...) that plays
// its spritesheet loop while a work-spot is occupied, and holds on frame 0
// otherwise. Mirrors CharacterSprite's container+AnimatedSprite pattern,
// but there's no direction/multi-anim grid here -- just one row-0 loop per
// prop, sliced the same way TiledMapRenderer.textureForGid crops a GID.
//
// Frame WIDTH is a fixed 32px (every sheet is frameCount*32 wide), but frame
// HEIGHT is not -- these are naturally-tall objects (a hanging punching bag,
// a treadmill in profile, a piano) rather than directional character rows,
// so each frame is cropped to the sheet's full height. The sprite is
// anchored at its base (bottom-left, not top-left) so a taller-than-one-tile
// prop grows upward from its desk position instead of overflowing downward
// past the room -- same anchor convention as CharacterSprite's (0.5, 1) and
// WorldCanvas's agent.y + 32 offset.

import { AnimatedSprite, Container, Rectangle, Texture } from "pixi.js";

const FRAME_WIDTH = 32;

export class EquipmentSprite {
  readonly container: Container;
  private sprite: AnimatedSprite;
  private working = false;

  constructor(sheet: Texture, frameCount: number) {
    const frameHeight = sheet.height;
    const frames: Texture[] = [];
    for (let i = 0; i < frameCount; i++) {
      frames.push(
        new Texture({ source: sheet.source, frame: new Rectangle(i * FRAME_WIDTH, 0, FRAME_WIDTH, frameHeight) }),
      );
    }
    this.container = new Container();
    this.sprite = new AnimatedSprite(frames);
    this.sprite.anchor.set(0, 1);
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
