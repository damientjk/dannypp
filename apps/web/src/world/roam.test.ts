import { describe, expect, it } from "vitest";
import { planForAgent, targetAt } from "./roam";

const FILES = ["res://user-a/notes/a.md", "res://user-a/finance/b.csv", "res://user-b/tax/c.txt"];

describe("planForAgent", () => {
  it("includes every file exactly once", () => {
    const plan = planForAgent("agent-1", FILES);

    expect(plan).toHaveLength(FILES.length);
    expect(new Set(plan)).toEqual(new Set(FILES));
  });

  it("is stable for the same agent", () => {
    expect(planForAgent("agent-1", FILES)).toEqual(planForAgent("agent-1", FILES));
  });

  it("starts different agents at different files so they spread out", () => {
    const starts = new Set(
      ["a", "b", "c", "d", "e"].map((id) => planForAgent(id, FILES)[0]),
    );

    expect(starts.size).toBeGreaterThan(1);
  });

  it("keeps other owners' files in the plan so the guard is exercised", () => {
    const plan = planForAgent("agent-1", FILES);

    expect(plan.some((uri) => uri.startsWith("res://user-b/"))).toBe(true);
  });

  it("handles an empty tree", () => {
    expect(planForAgent("agent-1", [])).toEqual([]);
  });
});

describe("targetAt", () => {
  it("cycles forever rather than running out", () => {
    const plan = planForAgent("agent-1", FILES);

    expect(targetAt(plan, 0)).toBe(plan[0]);
    expect(targetAt(plan, FILES.length)).toBe(plan[0]);
    expect(targetAt(plan, FILES.length * 3 + 1)).toBe(plan[1]);
  });

  it("returns null when there is nothing to visit", () => {
    expect(targetAt([], 4)).toBeNull();
  });
});
