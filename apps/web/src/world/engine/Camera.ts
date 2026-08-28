// Vendored from github.com/chaitanyagiri/munder-difflin (MIT).
//
// Wired into WorldCanvas to get the handheld-era framing: the world is drawn
// at 2x and the view follows the agent instead of showing the whole map at
// once. `setZoom` and the edge clamping in `applyFollow` are OUR additions —
// without the clamp the camera happily pans past the map and renders void
// along the edges, which the original never had to handle because it always
// fit its world to the screen.

import { Container } from "pixi.js";

export interface CameraBounds {
  width: number;
  height: number;
}

export class Camera {
  private target: Container;
  private viewport: CameraBounds;
  private worldBounds: CameraBounds;
  private followX = 0;
  private followY = 0;
  private lerpSpeed = 6;

  constructor(target: Container, viewport: CameraBounds, worldBounds: CameraBounds) {
    this.target = target;
    this.viewport = viewport;
    this.worldBounds = worldBounds;
  }

  fitToScreen(): void {
    const scaleX = this.viewport.width / this.worldBounds.width;
    const scaleY = this.viewport.height / this.worldBounds.height;
    const scale = Math.min(scaleX, scaleY, 1);
    this.target.scale.set(scale);
    this.target.x = (this.viewport.width - this.worldBounds.width * scale) / 2;
    this.target.y = (this.viewport.height - this.worldBounds.height * scale) / 2;
  }

  /** Draw the world at a fixed magnification (2 = handheld-era framing). */
  setZoom(scale: number): void {
    this.target.scale.set(scale);
  }

  focusOn(x: number, y: number): void {
    this.followX = x;
    this.followY = y;
    this.applyFollow();
  }

  nudgeToward(x: number, y: number, dt: number): void {
    const t = Math.min(1, this.lerpSpeed * dt);
    this.followX += (x - this.followX) * t;
    this.followY += (y - this.followY) * t;
    this.applyFollow();
  }

  update(dt: number): void {
    this.nudgeToward(this.followX, this.followY, dt);
  }

  /**
   * Centre on the follow point, then clamp so the viewport never leaves the
   * map. An axis whose scaled world is smaller than the viewport is centred
   * instead of clamped — clamping it would pin the map to one edge.
   */
  private applyFollow(): void {
    this.target.x = this.axis(
      this.followX,
      this.viewport.width,
      this.worldBounds.width,
      this.target.scale.x,
    );
    this.target.y = this.axis(
      this.followY,
      this.viewport.height,
      this.worldBounds.height,
      this.target.scale.y,
    );
  }

  private axis(follow: number, viewport: number, world: number, scale: number): number {
    const scaledWorld = world * scale;
    if (scaledWorld <= viewport) return (viewport - scaledWorld) / 2;
    const centred = viewport / 2 - follow * scale;
    return Math.min(0, Math.max(viewport - scaledWorld, centred));
  }
}
