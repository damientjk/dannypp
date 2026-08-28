import { describe, expect, it } from "vitest";
import type { Agent } from "../types";
import { FILE_ROOMS, assignedRoomFor, roomById, roomsOwnedBy } from "./resources";

function agentFor(id: string, ownerId: string): Agent {
  return {
    id,
    ownerId,
    name: id,
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

describe("FILE_ROOMS", () => {
  it("has exactly the 6 rooms with the expected owners and permission flags", () => {
    const byId = Object.fromEntries(FILE_ROOMS.map((r) => [r.id, r]));
    expect(Object.keys(byId).sort()).toEqual(
      ["auth-module", "billing", "database", "deploy-config", "kitchen", "living-room"].sort(),
    );
    expect(byId["auth-module"].ownerId).toBe("user-a");
    expect(byId["auth-module"].requiresPermission).toBe(true);
    expect(byId["kitchen"].ownerId).toBeNull();
    expect(byId["kitchen"].requiresPermission).toBe(false);
    expect(byId["kitchen"].deskIds).toEqual([]);
  });
});

describe("roomById", () => {
  it("returns the matching room", () => {
    expect(roomById("billing").displayName).toBe("Billing");
  });

  it("throws for an unknown id", () => {
    expect(() => roomById("nonexistent")).toThrow();
  });
});

describe("roomsOwnedBy", () => {
  it("returns only permission-gated rooms owned by the given owner", () => {
    const rooms = roomsOwnedBy("user-a");
    expect(rooms.map((r) => r.id).sort()).toEqual(["auth-module", "billing"]);
  });

  it("returns an empty array for an owner with no rooms", () => {
    expect(roomsOwnedBy("user-nobody")).toEqual([]);
  });
});

describe("assignedRoomFor", () => {
  it("is deterministic — the same agent always gets the same room", () => {
    const agent = agentFor("agent-42", "user-a");
    const first = assignedRoomFor(agent);
    const second = assignedRoomFor(agent);
    expect(first).not.toBeNull();
    expect(first!.id).toBe(second!.id);
  });

  it("only assigns rooms owned by the agent's own owner", () => {
    const agent = agentFor("agent-1", "user-b");
    const room = assignedRoomFor(agent);
    expect(room).not.toBeNull();
    expect(["database", "deploy-config"]).toContain(room!.id);
  });

  it("returns null for an owner with no rooms", () => {
    const agent = agentFor("agent-1", "user-nobody");
    expect(assignedRoomFor(agent)).toBeNull();
  });
});
