// Vendored from github.com/chaitanyagiri/munder-difflin (MIT), itself
// ported from shahar061/the-office (office/characters/CharacterSprite.ts).
// The `setTint` method is NOT part of the original — it's our addition so
// the deny-bounce red-flash affordance survives the switch to real sprites.

import { AnimatedSprite, Container, Graphics, Texture } from "pixi.js";

export type Direction = "down" | "up" | "right" | "left";
export type AnimState = "walk" | "type" | "read" | "idle";

const DIRECTION_ROW: Record<Direction, number> = {
  down: 0,
  up: 1,
  right: 2,
  left: 2,
};

const ANIM_FRAMES: Record<AnimState, number[]> = {
  walk: [0, 1, 2, 1],
  type: [0, 1, 2, 1],
  read: [0, 1, 2, 1],
  idle: [0],
};

const CHAR_SCALE = 1.08;

export class CharacterSprite {
  readonly container: Container;
  private sprite: AnimatedSprite;
  private frames: Texture[][];
  private currentDirection: Direction = "down";
  private currentAnim: AnimState = "idle";
  private frameSpeed = 0.15;
  private frameW: number;
  private frameH: number;
  private cropMask: Graphics | null = null;

  constructor(frames: Texture[][]) {
    this.frames = frames;
    this.container = new Container();

    const initialFrames = this.getFrames("down", "idle");
    this.sprite = new AnimatedSprite(initialFrames);
    this.sprite.anchor.set(0.5, 1);
    this.sprite.animationSpeed = this.frameSpeed;
    this.sprite.play();
    this.frameW = this.sprite.texture.frame.width || this.sprite.width || 16;
    this.frameH = this.sprite.texture.frame.height || this.sprite.height || 32;

    this.container.addChild(this.sprite);
    this.container.scale.set(CHAR_SCALE);
  }

  setSeatedCrop(cropPx: number): void {
    if (cropPx <= 0) {
      if (this.cropMask) {
        this.sprite.mask = null;
        this.cropMask.visible = false;
      }
      return;
    }
    if (!this.cropMask) {
      this.cropMask = new Graphics();
      this.container.addChild(this.cropMask);
    }
    const w = this.frameW;
    const h = this.frameH;
    this.cropMask.clear();
    this.cropMask
      .rect(-w / 2 - 2, -h - 2, w + 4, h - cropPx + 2)
      .fill(0xffffff);
    this.cropMask.visible = true;
    this.sprite.mask = this.cropMask;
  }

  private getFrames(direction: Direction, anim: AnimState): Texture[] {
    const row = DIRECTION_ROW[direction];
    return ANIM_FRAMES[anim].map((col) => this.frames[row][col]);
  }

  setAnimation(anim: AnimState, direction: Direction): void {
    if (anim === this.currentAnim && direction === this.currentDirection) return;

    this.currentAnim = anim;
    this.currentDirection = direction;

    this.sprite.textures = this.getFrames(direction, anim);
    this.sprite.scale.x = direction === "left" ? -1 : 1;
    this.sprite.animationSpeed = anim === "walk" ? 0.15 : anim === "idle" ? 0.08 : 0.06;
    this.sprite.play();
  }

  /** Multiply-tint the sprite (e.g. red on a denied room-entry bounce).
   *  Pass 0xffffff to clear the tint back to the texture's real colors. */
  setTint(color: number): void {
    this.sprite.tint = color;
  }

  setPosition(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  setAlpha(alpha: number): void {
    this.container.alpha = alpha;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
