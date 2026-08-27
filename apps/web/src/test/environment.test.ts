import { describe, expect, it } from "vitest";

describe("test environment", () => {
  it("stubs a usable 2d canvas context", () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    expect(ctx).not.toBeNull();
    expect(() => ctx!.fillRect(0, 0, 1, 1)).not.toThrow();
  });

  it("provides a cancel-safe requestAnimationFrame polyfill", async () => {
    let called = false;
    const id = window.requestAnimationFrame(() => {
      called = true;
    });
    window.cancelAnimationFrame(id);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(called).toBe(false);
  });
});
