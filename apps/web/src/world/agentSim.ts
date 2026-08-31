import type { Agent } from "../types";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import { findPath } from "./engine/pathfinding";
import { assignedRoomFor, isGatedTile } from "./resources";
import type { FileRoom } from "./resources";
import type { Facing, WorldAgent } from "./types";

const MOVE_SPEED_PX_PER_MS = 0.12;
const ROAM_RADIUS_TILES = 4;
const ROAM_PICK_ATTEMPTS = 20;
/** How far to search for a way out of a room, in tiles walked. */
const EXIT_SEARCH_RADIUS_TILES = 40;

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
      progress: 1,
      path: [],
      pathIndex: 0,
      behaviorMode: "roaming",
      assignedRoomId: assignedRoomFor(agent)?.id ?? null,
      occupiedDeskId: null,
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

function openRoamAdapter(renderer: TiledMapRenderer) {
  return {
    width: renderer.width,
    height: renderer.height,
    isWalkable: (x: number, y: number) => renderer.isWalkable(x, y) && !isGatedTile(renderer, x, y),
  };
}

function pathWaypoints(
  renderer: TiledMapRenderer,
  agent: WorldAgent,
  goalTile: { x: number; y: number },
  adapter: ReturnType<typeof walkableAdapter>,
): Array<{ x: number; y: number }> {
  const startTile = renderer.pixelToTile(agent.x, agent.y);
  const tileHops = findPath(adapter, startTile, goalTile) ?? [];
  return [{ x: agent.x, y: agent.y }, ...tileHops.map((tile) => renderer.tileToPixel(tile.x, tile.y))];
}

function beginPath(agent: WorldAgent, waypoints: Array<{ x: number; y: number }>): WorldAgent {
  const first = waypoints[0];
  const next = waypoints[1] ?? first;
  return {
    ...agent,
    originX: first.x,
    originY: first.y,
    targetX: next.x,
    targetY: next.y,
    facing: facingFromDelta(next.x - first.x, next.y - first.y),
    progress: 0,
    path: waypoints,
    pathIndex: 0,
  };
}

/**
 * The nearest tile an Agent can roam from, breadth-first over the whole map.
 *
 * "Nearest by walking", not by straight-line distance: the search crosses the
 * doorway the same way the Agent will. A candidate must also have an ungated
 * walkable neighbour -- an ungated tile walled off from the open network is a
 * pocket, and stepping into it would strand the Agent exactly as standing at
 * the desk did.
 */
function nearestOpenTile(
  renderer: TiledMapRenderer,
  from: { x: number; y: number },
): { x: number; y: number } | null {
  const isOpen = (x: number, y: number) =>
    renderer.isWalkable(x, y) && !isGatedTile(renderer, x, y);
  const neighbours = (x: number, y: number) => [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];

  const seen = new Set<string>([`${from.x},${from.y}`]);
  let frontier = [from];

  for (let depth = 0; depth < EXIT_SEARCH_RADIUS_TILES && frontier.length > 0; depth++) {
    const next: Array<{ x: number; y: number }> = [];
    for (const tile of frontier) {
      for (const step of neighbours(tile.x, tile.y)) {
        const key = `${step.x},${step.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!renderer.isWalkable(step.x, step.y)) continue;
        if (isOpen(step.x, step.y) && neighbours(step.x, step.y).some((n) => isOpen(n.x, n.y))) {
          return step;
        }
        next.push(step);
      }
    }
    frontier = next;
  }
  return null;
}

/** Only re-picks a roam target when idle (no path left to walk) and still
 *  meant to be roaming — heading-to-desk/working agents are untouched;
 *  their transitions are driven by settleAgent or by the caller's async
 *  task-visit orchestration (decideRoomEntry can't run inside a
 *  synchronous per-frame function). */
export function advanceBehavior(agent: WorldAgent, renderer: TiledMapRenderer): WorldAgent {
  if (agent.behaviorMode !== "roaming" || agent.path.length > 0) return agent;

  const adapter = openRoamAdapter(renderer);
  const startTile = renderer.pixelToTile(agent.x, agent.y);

  // Released from a desk, the Agent is standing INSIDE a gated room -- and the
  // roam adapter treats every tile of that room as unwalkable, including the
  // one under its feet. Every roam candidate came back unreachable, so it stood
  // at the desk indefinitely while the roster called it "roaming". Walk it out
  // on the full map first. Roaming still never routes back IN: this only ever
  // runs from a gated tile, and only towards an open one.
  if (isGatedTile(renderer, startTile.x, startTile.y)) {
    const exit = nearestOpenTile(renderer, startTile);
    if (!exit) return agent;
    const waypoints = pathWaypoints(renderer, agent, exit, walkableAdapter(renderer));
    return waypoints.length > 1 ? beginPath(agent, waypoints) : agent;
  }
  for (let attempt = 0; attempt < ROAM_PICK_ATTEMPTS; attempt++) {
    const dx = Math.floor(Math.random() * (ROAM_RADIUS_TILES * 2 + 1)) - ROAM_RADIUS_TILES;
    const dy = Math.floor(Math.random() * (ROAM_RADIUS_TILES * 2 + 1)) - ROAM_RADIUS_TILES;
    const candidate = { x: startTile.x + dx, y: startTile.y + dy };
    if (!adapter.isWalkable(candidate.x, candidate.y)) continue;
    const waypoints = pathWaypoints(renderer, agent, candidate, adapter);
    if (waypoints.length <= 1) continue; // start === goal or unreachable; try another candidate
    return beginPath(agent, waypoints);
  }
  return agent; // nothing new to wander to this cycle; retry next frame
}

export function beginHeadingToDesk(
  agent: WorldAgent,
  room: FileRoom,
  occupiedDeskIds: Set<string>,
  renderer: TiledMapRenderer,
): WorldAgent | null {
  const freeDeskId = room.deskIds.find((id) => !occupiedDeskIds.has(id));
  if (!freeDeskId) return null;
  const deskTile = renderer.getSpawnPoint(freeDeskId);
  if (!deskTile) return null;

  const waypoints = pathWaypoints(renderer, agent, deskTile, walkableAdapter(renderer));
  return {
    ...beginPath(agent, waypoints),
    behaviorMode: "heading-to-desk",
    occupiedDeskId: freeDeskId,
  };
}

export function endWorking(agent: WorldAgent): WorldAgent {
  return {
    ...agent,
    behaviorMode: "roaming",
    occupiedDeskId: null,
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

  if (agent.path.length === 0) return agent; // already at rest, nothing to settle

  if (agent.behaviorMode === "heading-to-desk") {
    return { ...agent, behaviorMode: "working", path: [], pathIndex: 0 };
  }
  return { ...agent, path: [], pathIndex: 0 };
}
