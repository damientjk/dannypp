import { describe, expect, it } from "vitest";
import { MAX_WAIT_TICKS, REPATH_AFTER_TICKS, stepWorld } from "./agentSim";
import { buildOccupancy, isBlocked, occupiedTiles, tileKey, type TileGrid } from "./occupancy";
import type { WorldAgent } from "./types";

const TILE = 32;

const grid: TileGrid = {
  pixelToTile: (x, y) => ({ x: Math.floor(x / TILE), y: Math.floor(y / TILE) }),
};

/** Pixel position of a tile's origin. */
const px = (tx: number, ty: number) => ({ x: tx * TILE, y: ty * TILE });

function agent(id: string, tx: number, ty: number, overrides: Partial<WorldAgent> = {}): WorldAgent {
  const { x, y } = px(tx, ty);
  return {
    agentId: id,
    ownerId: "user-a",
    name: id,
    x,
    y,
    originX: x,
    originY: y,
    targetX: x,
    targetY: y,
    facing: "right",
    status: "idle",
    currentRoom: "common",
    progress: 1,
    pendingEffect: null,
    pendingRoom: null,
    path: [],
    pathIndex: 0,
    waitTicks: 0,
    ...overrides,
  };
}

/**
 * An agent parked at a segment boundary whose next hop is `toTile`.
 * settleAgent advances while `pathIndex + 1 < path.length - 1`, so the path
 * needs one waypoint beyond the hop under test.
 */
function walkerHeadedTo(id: string, fromTile: [number, number], toTile: [number, number]) {
  const beyond: [number, number] = [toTile[0] + (toTile[0] - fromTile[0]), toTile[1]];
  return agent(id, fromTile[0], fromTile[1], {
    status: "walking",
    progress: 1,
    pathIndex: 0,
    path: [px(fromTile[0] - 1, fromTile[1]), px(...fromTile), px(...toTile), px(...beyond)],
  });
}

describe("occupancy", () => {
  it("gives a standing agent exactly one tile", () => {
    expect(occupiedTiles(agent("a", 3, 2), grid)).toEqual([{ x: 3, y: 2 }]);
  });

  it("gives an in-flight agent both the tile it is leaving and the one it enters", () => {
    const moving = agent("a", 1, 0, {
      status: "walking",
      progress: 0.5,
      targetX: 2 * TILE,
      targetY: 0,
    });

    expect(occupiedTiles(moving, grid)).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it("does not double-count when the step has not left the tile yet", () => {
    const moving = agent("a", 1, 0, { status: "walking", progress: 0, targetX: 1 * TILE });

    expect(occupiedTiles(moving, grid)).toHaveLength(1);
  });

  it("maps each held tile to its holder", () => {
    const occupancy = buildOccupancy([agent("a", 0, 0), agent("b", 5, 5)], grid);

    expect(occupancy.get(tileKey({ x: 0, y: 0 }))).toBe("a");
    expect(occupancy.get(tileKey({ x: 5, y: 5 }))).toBe("b");
  });

  it("blocks other agents but never the tile's own holder", () => {
    const occupancy = buildOccupancy([agent("a", 4, 4)], grid);

    expect(isBlocked(occupancy, { x: 4, y: 4 }, "b")).toBe(true);
    expect(isBlocked(occupancy, { x: 4, y: 4 }, "a")).toBe(false);
  });
});

describe("stepWorld collision", () => {
  it("advances into the next tile when nobody is standing there", () => {
    const [walker] = stepWorld([walkerHeadedTo("a", [1, 0], [2, 0])], 16, grid);

    expect(walker.status).toBe("walking");
    expect(walker.pathIndex).toBe(1);
    expect(walker.waitTicks).toBe(0);
  });

  it("waits instead of stepping onto a tile another agent occupies", () => {
    const world = [walkerHeadedTo("a", [1, 0], [2, 0]), agent("blocker", 2, 0)];

    const [walker] = stepWorld(world, 16, grid);

    expect(walker.status).toBe("waiting");
    expect(walker.pathIndex).toBe(0);
    expect(walker.waitTicks).toBe(1);
  });

  it("never lets two agents swap places through each other", () => {
    const world = [walkerHeadedTo("a", [1, 0], [2, 0]), walkerHeadedTo("b", [2, 0], [1, 0])];

    const [a, b] = stepWorld(world, 16, grid);

    expect(a.status).toBe("waiting");
    expect(b.status).toBe("waiting");
    expect(grid.pixelToTile(a.x, a.y)).toEqual({ x: 1, y: 0 });
    expect(grid.pixelToTile(b.x, b.y)).toEqual({ x: 2, y: 0 });
  });

  it("resumes walking once the blocking agent has moved away", () => {
    let world = [walkerHeadedTo("a", [1, 0], [2, 0]), agent("blocker", 2, 0)];
    world = stepWorld(world, 16, grid);
    expect(world[0].status).toBe("waiting");

    world = stepWorld([world[0], agent("blocker", 9, 9)], 16, grid);

    expect(world[0].status).toBe("walking");
    expect(world[0].waitTicks).toBe(0);
  });

  it("abandons the route rather than deadlocking forever", () => {
    let world = [walkerHeadedTo("a", [1, 0], [2, 0]), agent("blocker", 2, 0)];

    for (let tick = 0; tick < MAX_WAIT_TICKS; tick += 1) {
      world = stepWorld(world, 16, grid);
    }

    expect(world[0].status).toBe("idle");
    expect(world[0].path).toEqual([]);
    expect(world[0].waitTicks).toBe(0);
  });

  it("keeps two agents off the same tile across a long run", () => {
    let world = [walkerHeadedTo("a", [1, 0], [2, 0]), walkerHeadedTo("b", [3, 0], [2, 0])];

    for (let tick = 0; tick < 40; tick += 1) {
      world = stepWorld(world, 16, grid);
      const tiles = world.flatMap((one) => occupiedTiles(one, grid).map(tileKey));
      expect(new Set(tiles).size).toBe(tiles.length);
    }
  });
});

/** A 6x3 open room with walls only on the outer ring, plus walkability. */
const navGrid = {
  ...grid,
  width: 6,
  height: 3,
  isWalkable: (x: number, y: number) => x >= 0 && y >= 0 && x < 6 && y < 3,
  tileToPixel: (x: number, y: number) => px(x, y),
};

describe("stepWorld rerouting", () => {
  it("walks around a settled agent instead of giving up on the route", () => {
    // "a" wants (2,0); "blocker" is parked there and will never move.
    let world = [walkerHeadedTo("a", [1, 0], [2, 0]), agent("blocker", 2, 0)];

    for (let tick = 0; tick < REPATH_AFTER_TICKS + 1; tick += 1) {
      world = stepWorld(world, 16, navGrid);
    }

    expect(world[0].status).toBe("walking");
    expect(world[0].path.length).toBeGreaterThan(1);
  });

  it("keeps the same destination when it reroutes", () => {
    const original = walkerHeadedTo("a", [1, 0], [2, 0]);
    const destination = original.path[original.path.length - 1];
    let world = [original, agent("blocker", 2, 0)];

    for (let tick = 0; tick < REPATH_AFTER_TICKS + 1; tick += 1) {
      world = stepWorld(world, 16, navGrid);
    }

    const rerouted = world[0];
    expect(rerouted.path[rerouted.path.length - 1]).toEqual(destination);
  });

  it("still gives up when the destination itself is occupied", () => {
    // Nothing can route onto a tile another agent is standing on.
    const target = walkerHeadedTo("a", [1, 0], [2, 0]);
    const destinationTile = grid.pixelToTile(
      target.path[target.path.length - 1].x,
      target.path[target.path.length - 1].y,
    );
    let world = [target, agent("blocker", destinationTile.x, destinationTile.y)];

    // Ticks spent walking are not ticks spent waiting, so run well past the
    // cap rather than assuming one tick equals one wait.
    for (let tick = 0; tick < MAX_WAIT_TICKS * 3; tick += 1) {
      world = stepWorld(world, 16, navGrid);
    }

    expect(world[0].status).toBe("idle");
    expect(world[0].path).toEqual([]);
  });
});
