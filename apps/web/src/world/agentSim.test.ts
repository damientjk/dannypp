import { describe, expect, it } from "vitest";
import type { Agent } from "../types";
import {
  beginMoveToRoom,
  facingFromDelta,
  settleAgent,
  spawnWorldAgents,
  tickAgent,
} from "./agentSim";
import { TILE_SIZE, doorPixelPosition } from "./map";

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

describe("spawnWorldAgents", () => {
  it("maps agents to idle world agents", () => {
    const [worldAgent] = spawnWorldAgents([AGENT]);
    expect(worldAgent.agentId).toBe("agent-1");
    expect(worldAgent.ownerId).toBe("user-a");
    expect(worldAgent.status).toBe("idle");
    expect(worldAgent.progress).toBe(1);
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

describe("movement tick", () => {
  it("walks toward a permitted room and arrives idle inside it", () => {
    let agent = spawnWorldAgents([AGENT])[0];
    agent = beginMoveToRoom(agent, "house-a", "permit");
    expect(agent.status).toBe("walking");

    for (let i = 0; i < 200 && agent.status !== "idle"; i++) {
      agent = settleAgent(tickAgent(agent, 50));
    }

    const door = doorPixelPosition("house-a");
    expect(agent.status).toBe("idle");
    expect(agent.currentRoom).toBe("house-a");
    expect(agent.x).toBeCloseTo(door.x, 0);
    expect(agent.y).toBeCloseTo(door.y, 0);
  });

  it("walks up to the door, bounces back, and never enters when denied", () => {
    let agent = spawnWorldAgents([AGENT])[0];
    agent = beginMoveToRoom(agent, "house-b", "deny");

    for (let i = 0; i < 400 && !(agent.status === "idle" && agent.progress === 1); i++) {
      agent = settleAgent(tickAgent(agent, 50));
    }

    const door = doorPixelPosition("house-b");
    const distanceFromDoor = Math.hypot(agent.x - door.x, agent.y - door.y);

    expect(agent.status).toBe("idle");
    // it was rejected, so it never actually entered the house
    expect(agent.currentRoom).toBe("common");
    // it got up to the door before bouncing off, and only bounced back
    // a short hop — not all the way back to where it started
    expect(distanceFromDoor).toBeGreaterThan(0);
    expect(distanceFromDoor).toBeLessThan(TILE_SIZE * 2);
  });
});
