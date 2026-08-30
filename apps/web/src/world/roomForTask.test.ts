import { describe, expect, it } from "vitest";
import { assignedRoomFor, roomForTask } from "./resources";
import type { Agent } from "../types";

function agentFor(id: string, ownerId = "user-a"): Agent {
  return {
    id,
    ownerId,
    name: "Agent " + id,
    description: "",
    instructions: "",
    status: "ready",
    workspacePath: "",
    codexThreadId: null,
    lastError: null,
    createdAt: "",
    updatedAt: "",
  };
}

const AGENT = agentFor("agent-1");

describe("roomForTask", () => {
  it("sends the agent where the task points", () => {
    expect(roomForTask("work on billing today", AGENT)?.id).toBe("billing");
    expect(roomForTask("update the analytics dashboard", AGENT)?.id).toBe("analytics");
  });

  it("matches a room whose name is two words", () => {
    expect(roomForTask("fix the deploy config", AGENT)?.id).toBe("deploy-config");
    expect(roomForTask("look at the auth module", AGENT)?.id).toBe("auth-module");
  });

  it("is case-insensitive", () => {
    expect(roomForTask("CHECK THE DATABASE", AGENT)?.id).toBe("database");
  });

  it("reaches a room owned by somebody else when the task names it", () => {
    // The realistic overreach: the instruction named a resource outside this
    // agent's owner's namespace. Resolution does not care about ownership —
    // the guard is what refuses it.
    const room = roomForTask("read the database credentials", AGENT);

    expect(room?.id).toBe("database");
    expect(room?.ownerId).not.toBe(AGENT.ownerId);
  });

  it("prefers the longer name when two could match", () => {
    // "deploy config" must win over a bare "deploy".
    expect(roomForTask("deploy config rollout", AGENT)?.id).toBe("deploy-config");
  });

  it("falls back to the agent's home room when the task names nothing", () => {
    expect(roomForTask("do some work please", AGENT)?.id).toBe(assignedRoomFor(AGENT)?.id);
  });

  it("falls back on an empty or missing prompt", () => {
    const home = assignedRoomFor(AGENT)?.id;
    expect(roomForTask("", AGENT)?.id).toBe(home);
    expect(roomForTask(null, AGENT)?.id).toBe(home);
    expect(roomForTask(undefined, AGENT)?.id).toBe(home);
  });

  it("can resolve to an open room that needs no permission", () => {
    expect(roomForTask("relax in the living room", AGENT)?.id).toBe("living-room");
  });
});
