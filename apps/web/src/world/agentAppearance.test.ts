import { describe, expect, it } from "vitest";
import { colorForAgent, cssColorForAgent } from "./agentAppearance";

describe("agent appearance", () => {
  it("gives the same agent the same colour every time", () => {
    expect(colorForAgent("agent-1")).toBe(colorForAgent("agent-1"));
  });

  it("does not depend on when or in what order agents are seen", () => {
    const first = ["a", "b", "c"].map(colorForAgent);
    const reversed = ["c", "b", "a"].map(colorForAgent).reverse();

    expect(first).toEqual(reversed);
  });

  it("separates a handful of agents across the palette", () => {
    const ids = ["alpha", "bravo", "charlie", "delta"];
    const colors = new Set(ids.map(colorForAgent));

    expect(colors.size).toBeGreaterThan(1);
  });

  it("renders a six-digit css hex, zero-padded", () => {
    const css = cssColorForAgent("agent-1");

    expect(css).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps the css and sprite colours in agreement", () => {
    expect(parseInt(cssColorForAgent("agent-9").slice(1), 16)).toBe(colorForAgent("agent-9"));
  });
});
