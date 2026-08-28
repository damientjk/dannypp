// Vendored from github.com/chaitanyagiri/munder-difflin (MIT). NOT wired
// into this project's renderer — our map is small enough to render at 1:1
// with no panning. Kept for future use if the map grows past one screen.

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

  focusOn(x: number, y: number): void {
    this.followX = x;
    this.followY = y;
    this.target.x = this.viewport.width / 2 - x * this.target.scale.x;
    this.target.y = this.viewport.height / 2 - y * this.target.scale.y;
  }

  nudgeToward(x: number, y: number, dt: number): void {
    this.followX += (x - this.followX) * Math.min(1, this.lerpSpeed * dt);
    this.followY += (y - this.followY) * Math.min(1, this.lerpSpeed * dt);
    this.target.x = this.viewport.width / 2 - this.followX * this.target.scale.x;
    this.target.y = this.viewport.height / 2 - this.followY * this.target.scale.y;
  }

  update(dt: number): void {
    this.nudgeToward(this.followX, this.followY, dt);
  }
}
