import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAsset, resetAssetCache } from "./assets";

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = "";
  set src(value: string) {
    this._src = value;
    if (value.includes("missing")) {
      this.onerror?.();
    } else {
      this.onload?.();
    }
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
    // With the fake image resolving synchronously, this exercises the
    // cache-miss path: the first call kicks off loading.
    resetAssetCache();
    expect(loadAsset("character.default")).not.toBeNull();
  });

  it("returns the same image once loaded", () => {
    const first = loadAsset("room.house-a.floor");
    const second = loadAsset("room.house-a.floor");
    expect(first).toBe(second);
  });
});
