import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// The world suites boot PixiJS inside jsdom and then wait on polled state, so
// a single assertion sits behind several async hops -- a poll, a policy round
// trip, and a couple of React commits. In isolation they settle in about a
// second; with the whole suite running in parallel on a loaded machine they
// can be starved for much longer, and Testing Library's 1s default turns that
// into a flake report about correct code. The ceiling only costs wall-clock
// when it is actually needed: a passing assertion still resolves immediately.
configure({ asyncUtilTimeout: 15_000 });

afterEach(() => {
  cleanup();
});

class FakeCanvasRenderingContext2D {
  fillStyle = "";
  font = "";
  // PixiJS `Text` measures glyphs through the 2D context; jsdom implements
  // neither, so the room name plates would throw during render without these.
  measureText(text: string) {
    return {
      width: text.length * 8,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
    };
  }
  strokeText(): void {}
  fillText(): void {}
  getImageData() {
    return { data: new Uint8ClampedArray(4) };
  }
  clearRect(): void {}
  fillRect(): void {}
  beginPath(): void {}
  arc(): void {}
  fill(): void {}
  drawImage(): void {}
  save(): void {}
  restore(): void {}
  translate(): void {}
  createPattern(): null {
    return null;
  }
}

// PixiJS resolves `CanvasRenderingContext2D` off the global object; jsdom does
// not define it without the native `canvas` package.
(globalThis as unknown as Record<string, unknown>).CanvasRenderingContext2D ??=
  FakeCanvasRenderingContext2D;

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value(this: HTMLCanvasElement, contextId: string) {
    if (contextId !== "2d") return null;
    return new FakeCanvasRenderingContext2D();
  },
});

// jsdom does not implement scrollIntoView.
Element.prototype.scrollIntoView = function scrollIntoView(): void {};

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
