import type { Agent, PolicyEffect } from "../types";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import { findPath } from "./engine/pathfinding";
import type { Facing, RoomId, WorldAgent } from "./types";

const MOVE_SPEED_PX_PER_MS = 0.12;

const DOOR_SPAWN_NAME: Record<RoomId, string> = {
  "house-a": "house-a-door",
  "house-b": "house-b-door",
};

export function spawnWorldAgents(agents: Agent[], renderer: TiledMapRenderer): WorldAgent[] {
  const spawnTile = renderer.getSpawnPoint("common") ?? { x: 0, y: 0 };
  return agents.map((agent, index) => {
    const { x, y } = renderer.tileToPixel(spawnTile.x + index, spawnTile.y);
    return {
      agentId: agent.id,
      ownerId: agent.ownerId,
      name: agent.name,
      x,
      y,
      originX: x,
      originY: y,
      targetX: x,
      targetY: y,
      facing: "down",
      status: "idle",
      currentRoom: "common",
      progress: 1,
      pendingEffect: null,
      pendingRoom: null,
      path: [],
      pathIndex: 0,
    };
  });
}

export function facingFromDelta(dx: number, dy: number): Facing {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

function walkableAdapter(renderer: TiledMapRenderer) {
  return {
    width: renderer.width,
    height: renderer.height,
    isWalkable: (x: number, y: number) => renderer.isWalkable(x, y),
  };
}

export function beginMoveToRoom(
  agent: WorldAgent,
  room: RoomId,
  effect: PolicyEffect,
  renderer: TiledMapRenderer,
): WorldAgent {
  const doorTile = renderer.getSpawnPoint(DOOR_SPAWN_NAME[room]) ?? { x: 0, y: 0 };
  const startTile = renderer.pixelToTile(agent.x, agent.y);
  const tileHops = findPath(walkableAdapter(renderer), startTile, doorTile) ?? [];
  const pixelWaypoints = [
    { x: agent.x, y: agent.y },
    ...tileHops.map((tile) => renderer.tileToPixel(tile.x, tile.y)),
  ];
  const first = pixelWaypoints[0];
  const next = pixelWaypoints[1] ?? first;

  return {
    ...agent,
    originX: first.x,
    originY: first.y,
    targetX: next.x,
    targetY: next.y,
    facing: facingFromDelta(next.x - first.x, next.y - first.y),
    status: "walking",
    progress: 0,
    pendingEffect: effect,
    pendingRoom: room,
    path: pixelWaypoints,
    pathIndex: 0,
  };
}

function beginDeniedBounce(agent: WorldAgent): WorldAgent {
  const rawDx = agent.targetX - agent.originX;
  const rawDy = agent.targetY - agent.originY;
  const isDegenerate = rawDx === 0 && rawDy === 0;
  const dx = isDegenerate ? 0 : rawDx;
  const dy = isDegenerate ? -1 : rawDy; // fallback: bounce south, toward the corridor
  const length = Math.hypot(dx, dy) || 1;
  // isDegenerate uses a synthetic unit-length direction vector, so cap-by-length
  // would clamp the bounce to 1px (still invisible) — use the fixed cap directly.
  const bounceDistance = isDegenerate ? 24 : Math.min(length, 24);
  return {
    ...agent,
    originX: agent.x,
    originY: agent.y,
    targetX: agent.x - (dx / length) * bounceDistance,
    targetY: agent.y - (dy / length) * bounceDistance,
    facing: facingFromDelta(-dx, -dy),
    status: "denied-bounce",
    progress: 0,
    pendingEffect: null,
    pendingRoom: null,
    path: [],
    pathIndex: 0,
  };
}

export function tickAgent(agent: WorldAgent, deltaMs: number): WorldAgent {
  if (agent.progress >= 1) return agent;
  const distance = Math.hypot(agent.targetX - agent.originX, agent.targetY - agent.originY) || 1;
  const step = (MOVE_SPEED_PX_PER_MS * deltaMs) / distance;
  const progress = Math.min(1, agent.progress + step);
  return {
    ...agent,
    progress,
    x: agent.originX + (agent.targetX - agent.originX) * progress,
    y: agent.originY + (agent.targetY - agent.originY) * progress,
  };
}

export function settleAgent(agent: WorldAgent): WorldAgent {
  if (agent.progress < 1) return agent;

  if (agent.status === "walking") {
    const nextIndex = agent.pathIndex + 1;
    if (nextIndex < agent.path.length - 1) {
      const from = agent.path[nextIndex];
      const to = agent.path[nextIndex + 1];
      return {
        ...agent,
        pathIndex: nextIndex,
        originX: from.x,
        originY: from.y,
        targetX: to.x,
        targetY: to.y,
        facing: facingFromDelta(to.x - from.x, to.y - from.y),
        progress: 0,
      };
    }
    if (agent.pendingEffect === "deny") return beginDeniedBounce(agent);
    return {
      ...agent,
      status: "idle",
      currentRoom: agent.pendingRoom ?? agent.currentRoom,
      pendingEffect: null,
      pendingRoom: null,
      path: [],
      pathIndex: 0,
    };
  }
  if (agent.status === "denied-bounce") {
    return { ...agent, status: "idle" };
  }
  return agent;
}
