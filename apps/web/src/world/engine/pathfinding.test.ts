import { describe, expect, it } from "vitest";
import { findPath } from "./pathfinding";
import type { Walkable } from "./pathfinding";

function gridFrom(rows: string[]): Walkable {
  const width = rows[0].length;
  const height = rows.length;
  return {
    width,
    height,
    isWalkable(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      return rows[y][x] === ".";
    },
  };
}

describe("findPath", () => {
  it("returns an empty array when start equals goal", () => {
    const grid = gridFrom(["..."]);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual([]);
  });

  it("returns null when the goal is not walkable", () => {
    const grid = gridFrom([".#."]);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });

  it("routes around a wall", () => {
    const grid = gridFrom(["..#..", "..#..", "....."]);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    for (const point of path!) {
      expect(grid.isWalkable(point.x, point.y)).toBe(true);
    }
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 0 });
  });
});
