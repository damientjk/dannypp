import type { Agent, PolicyEffect } from "../types";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import { findPath } from "./engine/pathfinding";
import {
  buildOccupancy,
  isBlocked,
  occupiedTiles,
  tileKey,
  type TileGrid,
} from "./occupancy";
import { pickInteriorTile } from "./roomLayout";
import type { Facing, RoomId, WorldAgent } from "./types";

const MOVE_SPEED_PX_PER_MS = 0.12;

/**
 * How long an agent will stand and wait for a blocked tile before giving up on
 * its route. A head-on swap in a one-tile corridor is a genuine deadlock that
 * waiting alone never resolves, so the wait is bounded: the agent abandons the
 * walk and goes idle, and the caller is free to send it again.
 */
export const MAX_WAIT_TICKS = 90;

/**
 * Frames to wait before trying to walk around a blocker rather than through
 * the spot it is standing on. Short, because the common case is an agent that
 * bounced off a door and parked in the corridor — waiting for it to move is a
 * bet that never pays off, since a settled agent has nowhere to be.
 */
export const REPATH_AFTER_TICKS = 12;

/** Everything the sim needs to re-plan a route, satisfied by TiledMapRenderer. */
export interface WorldGrid extends TileGrid {
  width: number;
  height: number;
  isWalkable(x: number, y: number): boolean;
  tileToPixel(x: number, y: number): { x: number; y: number };
}

/** Context that lets a step consider the other agents on the map. */
export interface StepContext {
  occupancy: ReadonlyMap<string, string>;
  grid: TileGrid;
  /** Present when the caller can re-plan routes; absent in unit tests. */
  nav?: WorldGrid | undefined;
}

/** Door spawn points are named "<folder uri>-door" by the map builder. */
const doorSpawnName = (room: RoomId): string => room + "-door";

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
      waitTicks: 0,
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

/**
 * A free standing spot inside the room, or null when the map has no zone for it
 * (the test map) or the room is full. Callers fall back to the door.
 */
function interiorTargetFor(
  room: RoomId,
  renderer: TiledMapRenderer,
  agent: WorldAgent,
  others: readonly WorldAgent[],
): { x: number; y: number } | null {
  const zone = renderer.getZone(room);
  if (!zone) return null;

  const taken = new Set(
    others
      .filter((other) => other.agentId !== agent.agentId)
      .map((other) => tileKey(renderer.pixelToTile(other.x, other.y))),
  );
  return pickInteriorTile(zone, (x, y) => renderer.isWalkable(x, y), taken);
}

/**
 * Send an agent at a room.
 *
 * A permit walks it through the door and into the room — the room stands for a
 * resource namespace, so "allowed in" has to look like being in. A deny only
 * ever reaches the door tile, where `settleAgent` turns it into the bounce.
 */
export function beginMoveToRoom(
  agent: WorldAgent,
  room: RoomId,
  effect: PolicyEffect,
  renderer: TiledMapRenderer,
  others: readonly WorldAgent[] = [],
): WorldAgent {
  const doorTile = renderer.getSpawnPoint(doorSpawnName(room)) ?? { x: 0, y: 0 };
  const target =
    effect === "permit"
      ? (interiorTargetFor(room, renderer, agent, others) ?? doorTile)
      : doorTile;
  const startTile = renderer.pixelToTile(agent.x, agent.y);
  const tileHops = findPath(walkableAdapter(renderer), startTile, target) ?? [];
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
    waitTicks: 0,
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
    waitTicks: 0,
  };
}

/**
 * Re-plan a route to the same destination, treating the tiles other agents
 * hold as walls. Returns null when no way around exists — the caller then
 * keeps waiting, and eventually gives up.
 *
 * The destination is deliberately re-derived from the existing path rather
 * than passed in, so a reroute can never quietly change where an agent was
 * heading — only how it gets there.
 */
function reroute(
  agent: WorldAgent,
  context: StepContext,
  nav: WorldGrid,
): WorldAgent | null {
  const destination = agent.path[agent.path.length - 1];
  if (!destination) return null;

  const blocked = new Set(
    [...context.occupancy]
      .filter(([, holder]) => holder !== agent.agentId)
      .map(([key]) => key),
  );
  const hops = findPath(
    {
      width: nav.width,
      height: nav.height,
      isWalkable: (x, y) => nav.isWalkable(x, y) && !blocked.has(x + "," + y),
    },
    nav.pixelToTile(agent.x, agent.y),
    nav.pixelToTile(destination.x, destination.y),
  );
  if (!hops || hops.length === 0) return null;

  const waypoints = [
    { x: agent.x, y: agent.y },
    ...hops.map((tile) => nav.tileToPixel(tile.x, tile.y)),
  ];
  const first = waypoints[0];
  const next = waypoints[1] ?? first;

  return {
    ...agent,
    status: "walking",
    originX: first.x,
    originY: first.y,
    targetX: next.x,
    targetY: next.y,
    facing: facingFromDelta(next.x - first.x, next.y - first.y),
    progress: 0,
    path: waypoints,
    pathIndex: 0,
    waitTicks: 0,
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

/**
 * Advance an agent that has finished its current step.
 *
 * `context` is optional so a single agent can still be stepped in isolation
 * (the movement tests do this). With it, the next tile is claimed only if no
 * other agent holds it — that check is what stops agents overlapping.
 */
export function settleAgent(agent: WorldAgent, context?: StepContext): WorldAgent {
  if (agent.progress < 1) return agent;

  if (agent.status === "walking" || agent.status === "waiting") {
    const nextIndex = agent.pathIndex + 1;
    if (nextIndex < agent.path.length - 1) {
      const from = agent.path[nextIndex];
      const to = agent.path[nextIndex + 1];

      if (
        context &&
        isBlocked(context.occupancy, context.grid.pixelToTile(to.x, to.y), agent.agentId)
      ) {
        const waitTicks = agent.waitTicks + 1;

        // Prefer walking around the obstruction over waiting it out: the thing
        // in the way is usually another agent that has already arrived and is
        // never going to move.
        if (waitTicks >= REPATH_AFTER_TICKS && context.nav) {
          const rerouted = reroute(agent, context, context.nav);
          if (rerouted) return rerouted;
        }

        // Bounded wait: a mutual block would otherwise stall both agents
        // forever. Abandoning the route always terminates, and the caller can
        // simply send the agent again.
        if (waitTicks >= MAX_WAIT_TICKS) {
          return {
            ...agent,
            status: "idle",
            pendingEffect: null,
            pendingRoom: null,
            path: [],
            pathIndex: 0,
            waitTicks: 0,
          };
        }
        return { ...agent, status: "waiting", waitTicks };
      }

      return {
        ...agent,
        status: "walking",
        pathIndex: nextIndex,
        originX: from.x,
        originY: from.y,
        targetX: to.x,
        targetY: to.y,
        facing: facingFromDelta(to.x - from.x, to.y - from.y),
        progress: 0,
        waitTicks: 0,
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
      waitTicks: 0,
    };
  }
  if (agent.status === "denied-bounce") {
    return { ...agent, status: "idle" };
  }
  return agent;
}

/**
 * Step every agent for one frame with shared occupancy, so their movement is
 * resolved against each other rather than independently.
 *
 * Claims are registered as they are granted, not from a snapshot taken before
 * the frame: with a static snapshot two agents approaching the same free tile
 * from opposite sides both see it as free and both step in. Tiles an agent
 * vacates stay claimed for the rest of the frame, which is deliberately
 * conservative — nobody fills a square the instant it is left.
 */
export function stepWorld(
  agents: readonly WorldAgent[],
  deltaMs: number,
  grid: TileGrid | WorldGrid,
): WorldAgent[] {
  const occupancy = buildOccupancy(agents, grid);
  // A grid that knows about walls can also re-plan; a bare TileGrid cannot.
  const nav = "isWalkable" in grid ? (grid as WorldGrid) : undefined;
  const context: StepContext = { occupancy, grid, nav };

  return agents.map((agent) => {
    const next = settleAgent(tickAgent(agent, deltaMs), context);
    for (const tile of occupiedTiles(next, grid)) {
      const key = tileKey(tile);
      if (!occupancy.has(key)) occupancy.set(key, next.agentId);
    }
    return next;
  });
}
