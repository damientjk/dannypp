// Vendored from github.com/chaitanyagiri/munder-difflin (MIT), itself
// ported from shahar061/the-office (office/characters/CharacterSprite.ts),
// then reworked for the named-character sheets in repo-root Agents/: real
// four-direction art (so the old left=right-flipped trick is gone), and
// per-action frame sets instead of a single-texture grid. The old
// setTint/setSeatedCrop affordances died with the tinted placeholder art.

import { AnimatedSprite, Container } from "pixi.js";
import type { CharacterFrames } from "../engineCharacter";

export type Direction = "down" | "up" | "right" | "left";
export type AnimState = "idle" | "run" | "read" | "phone";

const ANIM_SPEED: Record<AnimState, number> = {
  idle: 0, // single frame per direction
  run: 0.2,
  read: 0.08,
  phone: 0.1,
};

export class CharacterSprite {
  readonly container: Container;
  private sprite: AnimatedSprite;
  private frames: CharacterFrames;
  private currentDirection: Direction = "down";
  private currentAnim: AnimState = "idle";

  constructor(frames: CharacterFrames) {
    this.frames = frames;
    this.container = new Container();
    this.sprite = new AnimatedSprite(this.getFrames("idle", "down"));
    this.sprite.anchor.set(0.5, 1);
    this.sprite.play();
    this.container.addChild(this.sprite);
  }

  /** reading/phone art is down-facing only; direction applies to idle/run. */
  private getFrames(anim: AnimState, direction: Direction) {
    const frames =
      anim === "read" ? this.frames.read
      : anim === "phone" ? this.frames.phone
      : this.frames[anim][direction];
    // Test environments feed stub textures too small to slice the loops
    // from; an empty set would crash AnimatedSprite. idle.down always has
    // its one fixed-count frame.
    return frames.length > 0 ? frames : this.frames.idle.down;
  }

  setAnimation(anim: AnimState, direction: Direction): void {
    if (anim === this.currentAnim && direction === this.currentDirection) return;
    this.currentAnim = anim;
    this.currentDirection = direction;
    this.sprite.textures = this.getFrames(anim, direction);
    this.sprite.animationSpeed = ANIM_SPEED[anim];
    this.sprite.play();
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
