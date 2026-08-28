import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAsset, resetAssetCache } from "./assets";

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = "";
  set src(value: string) {
    this._src = value;
    // Fire asynchronously, like a real image load, so a synchronous call
    // to loadAsset() right after setting .src genuinely observes the
    // still-loading (null) state instead of an already-resolved image.
    queueMicrotask(() => {
      if (value.includes("missing")) {
        this.onerror?.();
      } else {
        this.onload?.();
      }
    });
  }
  get src() {
    return this._src;
  }
}

describe("loadAsset", () => {
  beforeEach(() => {
    resetAssetCache();
    vi.stubGlobal("Image", FakeImage as unknown as typeof Image);
  });

  it("returns null before the underlying image is known to exist", () => {
    // The first call kicks off loading; since the fake image now resolves
    // asynchronously, this genuinely observes the loading (null) state.
    expect(loadAsset("character.default")).toBeNull();
  });

  it("returns the resolved image once loaded", async () => {
    const first = loadAsset("room.house-a.floor");
    expect(first).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    const second = loadAsset("room.house-a.floor");
    expect(second).not.toBeNull();
    expect(loadAsset("room.house-a.floor")).toBe(second);
  });
});
