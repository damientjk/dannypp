import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { Agent } from "../types";
import { TiledMapRenderer } from "./engine/TiledMapRenderer";
import type { TiledMap } from "./engine/TiledMapRenderer";
import { TILE_SIZE } from "./engineMap";
import { roomById } from "./resources";
import {
  advanceBehavior,
  beginHeadingToDesk,
  endWorking,
  facingFromDelta,
  jailAgent,
  releaseAgent,
  settleAgent,
  spawnWorldAgents,
  tickAgent,
} from "./agentSim";

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

// A 10x3 map: an open corridor along row y=2 (the "hallway"), a walled
// "auth-module" room (interior x=1..7, y=0) with a door gap at (4,1) and
// a zone covering that interior, and two desks inside it. Small enough to
// hand-verify, big enough to force multi-waypoint paths and real roam
// wandering within the corridor only.
function testRenderer(): TiledMapRenderer {
  const width = 10;
  const height = 3;
  const floor = new Array(width * height).fill(1);
  const collision = new Array(width * height).fill(0);
  for (let x = 0; x < width; x++) {
    if (x !== 4) collision[1 * width + x] = 8;
  }
  const mapData: TiledMap = {
    width,
    height,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    tilesets: [{ firstgid: 1, columns: 11, tilewidth: TILE_SIZE, tileheight: TILE_SIZE, tilecount: 11 }],
    layers: [
      { name: "floor", type: "tilelayer", data: floor },
      { name: "collision", type: "tilelayer", data: collision },
      {
        name: "spawn-points",
        type: "objectgroup",
        objects: [
          { name: "common", x: 1 * TILE_SIZE, y: 2 * TILE_SIZE },
          { name: "auth-module-door", x: 4 * TILE_SIZE, y: 1 * TILE_SIZE },
          { name: "desk-auth-module-1", x: 2 * TILE_SIZE, y: 0 },
          { name: "desk-auth-module-2", x: 6 * TILE_SIZE, y: 0 },
        ],
      },
      {
        name: "zones",
        type: "objectgroup",
        objects: [{ name: "auth-module", x: 1 * TILE_SIZE, y: 0, width: 7 * TILE_SIZE, height: 1 * TILE_SIZE }],
      },
    ],
  };
  return new TiledMapRenderer(mapData, [Texture.WHITE]);
}

describe("spawnWorldAgents", () => {
  it("spawns roaming at the common spawn point with an assigned room and no desk", () => {
    const renderer = testRenderer();
    const [agent] = spawnWorldAgents([AGENT], renderer);
    expect(agent.x).toBe(1 * TILE_SIZE);
    expect(agent.y).toBe(2 * TILE_SIZE);
    expect(agent.behaviorMode).toBe("roaming");
    // assignedRoomFor is a deterministic hash of agent id -> one of the
    // owner's rooms (see resources.ts); for AGENT.id "agent-1"/"user-a"
    // against ["auth-module", "billing"] that hash lands on "billing".
    expect(agent.assignedRoomId).toBe("billing");
    expect(agent.occupiedDeskId).toBeNull();
  });

  it("spawns multiple agents at visibly different positions", () => {
    const renderer = testRenderer();
    const [first, second] = spawnWorldAgents([AGENT, { ...AGENT, id: "agent-2" }], renderer);
    expect(first.x).not.toBe(second.x);
  });

  it("leaves assignedRoomId null for an agent whose owner has no rooms", () => {
    const renderer = testRenderer();
    const [agent] = spawnWorldAgents([{ ...AGENT, ownerId: "user-nobody" }], renderer);
    expect(agent.assignedRoomId).toBeNull();
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

function runToRest(agent: import("./types").WorldAgent, guardMax = 1000) {
  let guard = 0;
  while (agent.progress < 1 || agent.path.length > 0) {
    agent = settleAgent(tickAgent(agent, 50));
    guard += 1;
    if (guard >= guardMax) break;
  }
  return { agent, guard };
}

describe("advanceBehavior", () => {
  it("picks a new roam waypoint and starts walking when idle and roaming", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    // advanceBehavior randomly samples candidate tiles and can legitimately
    // miss on any single call (it just returns the agent unchanged, ready to
    // retry next frame — see its docstring). Retrying a few times mirrors
    // that real per-frame retry loop and avoids a flaky single-shot assertion.
    for (let attempt = 0; attempt < 5 && agent.path.length === 0; attempt++) {
      agent = advanceBehavior(agent, renderer);
    }
    expect(agent.path.length).toBeGreaterThan(0);
  });

  it("never routes a roam waypoint through the gated auth-module zone", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    for (let i = 0; i < 50; i++) {
      agent = advanceBehavior({ ...agent, path: [], pathIndex: 0, progress: 1 }, renderer);
      for (const point of agent.path) {
        const tile = renderer.pixelToTile(point.x, point.y);
        expect(tile.y).not.toBe(0); // auth-module's interior row
      }
    }
  });

  it("does nothing when the agent is heading to a desk or working", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    agent = { ...agent, behaviorMode: "working" };
    const result = advanceBehavior(agent, renderer);
    expect(result).toBe(agent);
  });
});

describe("beginHeadingToDesk", () => {
  it("walks to a free desk and settles into working", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    const room = roomById("auth-module");
    const started = beginHeadingToDesk(agent, room, new Set(), renderer);
    expect(started).not.toBeNull();
    agent = started!;
    expect(agent.behaviorMode).toBe("heading-to-desk");
    expect(agent.occupiedDeskId).toBe("desk-auth-module-1");

    const { agent: settled, guard } = runToRest(agent);
    expect(guard).toBeLessThan(1000);
    expect(settled.behaviorMode).toBe("working");
    expect(settled.x).toBe(2 * TILE_SIZE);
    expect(settled.y).toBe(0);
  });

  it("picks the second desk when the first is occupied", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    const room = roomById("auth-module");
    const started = beginHeadingToDesk(agent, room, new Set(["desk-auth-module-1"]), renderer);
    expect(started!.occupiedDeskId).toBe("desk-auth-module-2");
  });

  it("returns null when every desk is occupied", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    const room = roomById("auth-module");
    const started = beginHeadingToDesk(
      agent,
      room,
      new Set(["desk-auth-module-1", "desk-auth-module-2"]),
      renderer,
    );
    expect(started).toBeNull();
  });
});

describe("endWorking", () => {
  it("releases the desk and returns to roaming", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    agent = beginHeadingToDesk(agent, roomById("auth-module"), new Set(), renderer)!;
    agent = runToRest(agent).agent;
    expect(agent.behaviorMode).toBe("working");

    agent = endWorking(agent);
    expect(agent.behaviorMode).toBe("roaming");
    expect(agent.occupiedDeskId).toBeNull();
  });
});

// A 6x5 all-floor map with a "database" (jail) zone over tiles x=1..3,
// y=1..3 and the common spawn outside it at (0,4) — just enough geometry
// for the teleport-to-jail / pace-the-cell / release tests. The zone's last
// row (y=3) stands in for the bars row, which jailed roaming must avoid.
function jailTestRenderer(): TiledMapRenderer {
  const width = 6;
  const height = 5;
  const mapData: TiledMap = {
    width,
    height,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    tilesets: [{ firstgid: 1, columns: 11, tilewidth: TILE_SIZE, tileheight: TILE_SIZE, tilecount: 11 }],
    layers: [
      { name: "floor", type: "tilelayer", data: new Array(width * height).fill(1) },
      { name: "collision", type: "tilelayer", data: new Array(width * height).fill(0) },
      {
        name: "spawn-points",
        type: "objectgroup",
        objects: [{ name: "common", x: 0, y: 4 * TILE_SIZE }],
      },
      {
        name: "zones",
        type: "objectgroup",
        objects: [
          { name: "database", x: 1 * TILE_SIZE, y: 1 * TILE_SIZE, width: 3 * TILE_SIZE, height: 3 * TILE_SIZE },
        ],
      },
    ],
  };
  return new TiledMapRenderer(mapData, [Texture.WHITE]);
}

describe("jailAgent / releaseAgent", () => {
  it("teleports the agent to the middle of the jail zone and flips it to jailed", () => {
    const renderer = jailTestRenderer();
    const [spawned] = spawnWorldAgents([AGENT], renderer);
    const jailed = jailAgent(spawned, renderer);
    expect(jailed.behaviorMode).toBe("jailed");
    // centre tile of the 3x3 zone anchored at (1,1) is (2,2)
    expect(jailed.x).toBe(2 * TILE_SIZE);
    expect(jailed.y).toBe(2 * TILE_SIZE);
    expect(jailed.path).toEqual([]);
    expect(jailed.progress).toBe(1);
    expect(jailed.occupiedDeskId).toBeNull();
  });

  it("keeps a jailed agent pacing inside the cell, off the bars row", () => {
    const renderer = jailTestRenderer();
    let agent = jailAgent(spawnWorldAgents([AGENT], renderer)[0], renderer);
    for (let i = 0; i < 50; i++) {
      agent = advanceBehavior({ ...agent, path: [], pathIndex: 0, progress: 1 }, renderer);
      // path[0] is the agent's own current position; every hop after it must
      // stay inside the zone and off its last (bars) row.
      for (const point of agent.path.slice(1)) {
        const tile = renderer.pixelToTile(point.x, point.y);
        expect(tile.x).toBeGreaterThanOrEqual(1);
        expect(tile.x).toBeLessThanOrEqual(3);
        expect(tile.y).toBeGreaterThanOrEqual(1);
        expect(tile.y).toBeLessThanOrEqual(2);
      }
    }
  });

  it("releases the agent back to the common spawn, roaming", () => {
    const renderer = jailTestRenderer();
    const jailed = jailAgent(spawnWorldAgents([AGENT], renderer)[0], renderer);
    const freed = releaseAgent(jailed, renderer);
    expect(freed.behaviorMode).toBe("roaming");
    expect(freed.x).toBe(0);
    expect(freed.y).toBe(4 * TILE_SIZE);
    expect(freed.path).toEqual([]);
  });

  it("does nothing on a map with no jail zone", () => {
    const renderer = testRenderer(); // its only zone is auth-module
    const [agent] = spawnWorldAgents([AGENT], renderer);
    expect(jailAgent(agent, renderer)).toBe(agent);
  });
});
