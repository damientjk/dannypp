import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampLayout,
  DEFAULT_LAYOUT,
  loadLayout,
  QUERIES_MAX,
  QUERIES_MIN,
  saveLayout,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from "./splitLayout";

describe("splitLayout", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps both halves usable however far the handle is dragged", () => {
    expect(clampLayout({ sidebar: 10, queries: -3 })).toEqual({
      sidebar: SIDEBAR_MIN,
      queries: QUERIES_MIN,
    });
    expect(clampLayout({ sidebar: 9000, queries: 4 })).toEqual({
      sidebar: SIDEBAR_MAX,
      queries: QUERIES_MAX,
    });
  });

  it("rounds the sidebar to whole pixels", () => {
    expect(clampLayout({ sidebar: 240.6, queries: 0.5 }).sidebar).toBe(241);
  });

  it("round-trips a saved layout", () => {
    saveLayout({ sidebar: 300, queries: 0.4 });
    expect(loadLayout()).toEqual({ sidebar: 300, queries: 0.4 });
  });

  it("falls back to the default when nothing is stored", () => {
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it("ignores stored junk rather than laying out a broken grid", () => {
    window.localStorage.setItem("launchpad.splitLayout", "not json");
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);

    window.localStorage.setItem("launchpad.splitLayout", JSON.stringify({ sidebar: "wide" }));
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);

    window.localStorage.setItem(
      "launchpad.splitLayout",
      JSON.stringify({ sidebar: Number.NaN, queries: 0.5 }),
    );
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it("clamps a stored layout that is out of range", () => {
    window.localStorage.setItem(
      "launchpad.splitLayout",
      JSON.stringify({ sidebar: 40, queries: 0.95 }),
    );
    expect(loadLayout()).toEqual({ sidebar: SIDEBAR_MIN, queries: QUERIES_MAX });
  });

  it("survives a browser that refuses localStorage", () => {
    // Safari private mode and a cookies-blocked profile both throw here rather
    // than returning null, which is why the loader catches instead of checking.
    const blocked = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: blocked,
    });

    try {
      expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
      expect(() => saveLayout(DEFAULT_LAYOUT)).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });
});
