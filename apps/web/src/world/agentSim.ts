import type { Agent, PolicyEffect } from "../types";
import type { Facing, RoomId, WorldAgent } from "./types";
import { TILE_SIZE, doorPixelPosition, spawnPixelPosition } from "./map";

const MOVE_SPEED_PX_PER_MS = 0.12;
const BOUNCE_DISTANCE_PX = TILE_SIZE * 0.75;

export function spawnWorldAgents(agents: Agent[]): WorldAgent[] {
  return agents.map((agent) => {
    const { x, y } = spawnPixelPosition();
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
    };
  });
}

export function facingFromDelta(dx: number, dy: number): Facing {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

export function beginMoveToRoom(agent: WorldAgent, room: RoomId, effect: PolicyEffect): WorldAgent {
  const { x, y } = doorPixelPosition(room);
  return {
    ...agent,
    originX: agent.x,
    originY: agent.y,
    targetX: x,
    targetY: y,
    facing: facingFromDelta(x - agent.x, y - agent.y),
    status: "walking",
    progress: 0,
    pendingEffect: effect,
    pendingRoom: room,
  };
}

function beginDeniedBounce(agent: WorldAgent): WorldAgent {
  const dx = agent.targetX - agent.originX;
  const dy = agent.targetY - agent.originY;
  const length = Math.hypot(dx, dy) || 1;
  return {
    ...agent,
    originX: agent.x,
    originY: agent.y,
    targetX: agent.x - (dx / length) * BOUNCE_DISTANCE_PX,
    targetY: agent.y - (dy / length) * BOUNCE_DISTANCE_PX,
    facing: facingFromDelta(-dx, -dy),
    status: "denied-bounce",
    progress: 0,
    pendingEffect: null,
    pendingRoom: null,
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
    if (agent.pendingEffect === "deny") return beginDeniedBounce(agent);
    return {
      ...agent,
      status: "idle",
      currentRoom: agent.pendingRoom ?? agent.currentRoom,
      pendingEffect: null,
      pendingRoom: null,
    };
  }
  if (agent.status === "denied-bounce") {
    return { ...agent, status: "idle" };
  }
  return agent;
}
