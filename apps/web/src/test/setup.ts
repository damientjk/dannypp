import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

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

// jsdom does not implement Storage here, and the world persists the viewer's
// character-set choice through localStorage. Without this the preference code
// silently takes its "storage unavailable" fallback and can never be tested.
// The property *exists* on window but reads as undefined, so test the value
// rather than using an `in` check.
if (!window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}
