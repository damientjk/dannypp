import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

class FakeCanvasRenderingContext2D {
  fillStyle = "";
  clearRect(): void {}
  fillRect(): void {}
  beginPath(): void {}
  arc(): void {}
  fill(): void {}
  drawImage(): void {}
}

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value(this: HTMLCanvasElement, contextId: string) {
    if (contextId !== "2d") return null;
    return new FakeCanvasRenderingContext2D();
  },
});

const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();
let nextFrameId = 0;

window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
  const id = ++nextFrameId;
  const timer = setTimeout(() => callback(performance.now()), 16);
  pendingTimers.set(id, timer);
  return id;
};

window.cancelAnimationFrame = (id: number): void => {
  const timer = pendingTimers.get(id);
  if (timer) clearTimeout(timer);
  pendingTimers.delete(id);
};
