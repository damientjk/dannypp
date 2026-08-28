import { Container } from "pixi.js";
import { beforeEach, describe, expect, it } from "vitest";
import { Camera } from "./Camera";

const VIEWPORT = { width: 480, height: 320 };
const WORLD = { width: 704, height: 416 };

let target: Container;
let camera: Camera;

beforeEach(() => {
  target = new Container();
  camera = new Camera(target, VIEWPORT, WORLD);
  camera.setZoom(2);
});

describe("Camera", () => {
  it("magnifies the world by the requested zoom", () => {
    expect(target.scale.x).toBe(2);
    expect(target.scale.y).toBe(2);
  });

  it("centres the view on the follow point when away from every edge", () => {
    camera.focusOn(WORLD.width / 2, WORLD.height / 2);

    // 480/2 - 352*2 = -464, comfortably inside the clamp range.
    expect(target.x).toBe(-464);
    expect(target.y).toBe(-256);
  });

  it("clamps at the top-left instead of revealing void past the map", () => {
    camera.focusOn(0, 0);

    expect(target.x).toBe(0);
    expect(target.y).toBe(0);
  });

  it("clamps at the bottom-right instead of revealing void past the map", () => {
    camera.focusOn(WORLD.width, WORLD.height);

    // viewport - scaledWorld: 480 - 1408 and 320 - 832.
    expect(target.x).toBe(-928);
    expect(target.y).toBe(-512);
  });

  it("centres an axis whose scaled world is smaller than the viewport", () => {
    const small = new Container();
    const smallCamera = new Camera(small, VIEWPORT, { width: 100, height: 80 });
    smallCamera.setZoom(1);

    smallCamera.focusOn(50, 40);

    expect(small.x).toBe((480 - 100) / 2);
    expect(small.y).toBe((320 - 80) / 2);
  });

  it("eases part-way toward a new follow point rather than snapping to it", () => {
    camera.focusOn(WORLD.width / 2, WORLD.height / 2);
    const start = target.x;
    const snapped = VIEWPORT.width / 2 - 400 * 2;

    camera.nudgeToward(400, WORLD.height / 2, 0.016);

    expect(target.x).toBeLessThan(start);
    expect(target.x).toBeGreaterThan(snapped);
  });
});
