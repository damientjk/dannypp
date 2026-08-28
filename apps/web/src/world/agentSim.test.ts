import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { Agent } from "../types";
import { TiledMapRenderer } from "./engine/TiledMapRenderer";
import type { TiledMap } from "./engine/TiledMapRenderer";
import { TILE_SIZE } from "./engineMap";
import { beginMoveToRoom, facingFromDelta, settleAgent, spawnWorldAgents, tickAgent } from "./agentSim";

const AGENT: Agent = {
  id: "agent-1",
  ownerId: "user-a",
  name: "Robot A",
  description: "",
  instructions: "",
  status: "ready",
  workspacePath: "",
  codexThreadId: null,
  lastError: null,
  createdAt: "",
  updatedAt: "",
};

// A 6x3 map: common corridor along the bottom row (y=2), a walled house-a
// room (interior at x=1..3, y=0) with a door gap at (2,1), reached only by
// walking around through the corridor — enough to force a multi-waypoint path.
function testRenderer(): TiledMapRenderer {
  const width = 6;
  const height = 3;
  const floor = new Array(width * height).fill(1);
  const collision = new Array(width * height).fill(0);
  // Wall everything on row 1 except the door gap at x=2.
  for (let x = 0; x < width; x++) {
    if (x !== 2) collision[1 * width + x] = 4;
  }
  const mapData: TiledMap = {
    width,
    height,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    tilesets: [{ firstgid: 1, columns: 5, tilewidth: TILE_SIZE, tileheight: TILE_SIZE, tilecount: 5 }],
    layers: [
      { name: "floor", type: "tilelayer", data: floor },
      { name: "collision", type: "tilelayer", data: collision },
      {
        name: "spawn-points",
        type: "objectgroup",
        objects: [
          { name: "common", x: 1 * TILE_SIZE, y: 2 * TILE_SIZE },
          { name: "house-a-door", x: 2 * TILE_SIZE, y: 1 * TILE_SIZE },
        ],
      },
      { name: "zones", type: "objectgroup", objects: [] },
    ],
  };
  return new TiledMapRenderer(mapData, [Texture.WHITE]);
}

describe("spawnWorldAgents", () => {
  it("spawns at the map's common spawn point with an empty path", () => {
    const renderer = testRenderer();
    const [agent] = spawnWorldAgents([AGENT], renderer);
    expect(agent.x).toBe(1 * TILE_SIZE);
    expect(agent.y).toBe(2 * TILE_SIZE);
    expect(agent.path).toEqual([]);
    expect(agent.pathIndex).toBe(0);
  });

  it("spawns multiple agents at visibly different positions", () => {
    const renderer = testRenderer();
    const [first, second] = spawnWorldAgents([AGENT, { ...AGENT, id: "agent-2" }], renderer);
    expect(first.x).not.toBe(second.x);
  });
});

describe("facingFromDelta", () => {
  it("picks the dominant axis", () => {
    expect(facingFromDelta(10, 1)).toBe("right");
    expect(facingFromDelta(-10, 1)).toBe("left");
    expect(facingFromDelta(1, 10)).toBe("down");
    expect(facingFromDelta(1, -10)).toBe("up");
  });
});

describe("beginMoveToRoom + tickAgent + settleAgent", () => {
  it("walks a multi-waypoint path around the wall to the door, then settles idle on permit", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    agent = beginMoveToRoom(agent, "house-a", "permit", renderer);

    expect(agent.path.length).toBeGreaterThan(2); // more than a single direct hop
    expect(agent.status).toBe("walking");

    let guard = 0;
    while (agent.status === "walking" && guard < 1000) {
      agent = settleAgent(tickAgent(agent, 50));
      guard += 1;
    }

    expect(guard).toBeLessThan(1000);
    expect(agent.status).toBe("idle");
    expect(agent.currentRoom).toBe("house-a");
    expect(agent.x).toBe(2 * TILE_SIZE);
    expect(agent.y).toBe(1 * TILE_SIZE);
  });

  it("bounces back on deny after reaching the end of the path", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    agent = beginMoveToRoom(agent, "house-a", "deny", renderer);

    let guard = 0;
    while (agent.status === "walking" && guard < 1000) {
      agent = settleAgent(tickAgent(agent, 50));
      guard += 1;
    }
    expect(agent.status).toBe("denied-bounce");

    guard = 0;
    while (agent.status === "denied-bounce" && guard < 1000) {
      agent = settleAgent(tickAgent(agent, 50));
      guard += 1;
    }
    expect(agent.status).toBe("idle");
    expect(agent.currentRoom).toBe("common"); // never entered the room
  });

  it("bounces visibly when denied while already standing on the door tile (revoked-after-permit)", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);

    // First: permit into house-a, walk all the way to the door tile.
    agent = beginMoveToRoom(agent, "house-a", "permit", renderer);
    let guard = 0;
    while (agent.status === "walking" && guard < 1000) {
      agent = settleAgent(tickAgent(agent, 50));
      guard += 1;
    }
    expect(agent.status).toBe("idle");
    const settledX = agent.x;
    const settledY = agent.y;

    // Then: capability revoked, agent sent to the same house again while
    // already standing exactly on the door tile (start === goal).
    agent = beginMoveToRoom(agent, "house-a", "deny", renderer);
    guard = 0;
    while (agent.status === "walking" && guard < 1000) {
      agent = settleAgent(tickAgent(agent, 50));
      guard += 1;
    }
    expect(agent.status).toBe("denied-bounce");

    guard = 0;
    while (agent.status === "denied-bounce" && guard < 1000) {
      agent = settleAgent(tickAgent(agent, 50));
      guard += 1;
    }
    expect(agent.status).toBe("idle");

    const distanceMoved = Math.hypot(agent.x - settledX, agent.y - settledY);
    expect(distanceMoved).toBeGreaterThan(5);
  });
});
