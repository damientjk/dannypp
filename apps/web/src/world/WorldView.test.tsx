import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../types";
import { api } from "../api";
import { FILE_ROOMS } from "./resources";
import { issueCapability, resetCapabilities } from "./decision";
import { resetRequests } from "./requests";
import { beginHeadingToDesk } from "./agentSim";
import { WorldView } from "./WorldView";

// Wrap the real beginHeadingToDesk in a spy (default behavior unchanged) so
// finding 1's test can observe the occupiedDeskId each call actually claimed.
vi.mock("./agentSim", async () => {
  const actual = await vi.importActual<typeof import("./agentSim")>("./agentSim");
  return { ...actual, beginHeadingToDesk: vi.fn(actual.beginHeadingToDesk) };
});

vi.mock("../api", () => ({
  api: {
    login: vi.fn(),
    listAgents: vi.fn(),
    runs: vi.fn(),
    messages: vi.fn(),
  },
  setSessionToken: vi.fn(),
}));

vi.mock("pixi.js", async () => {
  const actual = await vi.importActual<typeof import("pixi.js")>("pixi.js");
  return {
    ...actual,
    Application: class {
      canvas = document.createElement("canvas");
      stage = new actual.Container();
      async init() {}
      destroy() {}
    },
    Assets: { load: vi.fn().mockResolvedValue(actual.Texture.WHITE) },
  };
});

// Every room has a door + zone; the 4 owned rooms also get 2 desks each —
// enough for assignedRoomFor (real, unmocked resources.ts) to resolve
// correctly for an agent owned by either user-a or user-b.
vi.mock("./engineMap", async () => {
  const { TiledMapRenderer } = await import("./engine/TiledMapRenderer");
  const { Texture } = await import("pixi.js");
  const TILE = 32;
  const spawnObjects: Array<{ name: string; x: number; y: number }> = [{ name: "common", x: TILE, y: TILE }];
  const zoneObjects: Array<{ name: string; x: number; y: number; width: number; height: number }> = [];
  const { FILE_ROOMS: rooms } = await import("./resources");
  rooms.forEach((room, index) => {
    const doorX = (5 + index * 3) * TILE;
    spawnObjects.push({ name: `${room.id}-door`, x: doorX, y: TILE });
    zoneObjects.push({ name: room.id, x: doorX, y: 0, width: 2 * TILE, height: 2 * TILE });
    room.deskIds.forEach((deskId, deskIndex) => {
      spawnObjects.push({ name: deskId, x: doorX + deskIndex * TILE, y: 0 });
    });
  });
  const width = 40;
  const height = 10;
  const mapData = {
    width,
    height,
    tilewidth: TILE,
    tileheight: TILE,
    tilesets: [{ firstgid: 1, columns: 11, tilewidth: TILE, tileheight: TILE, tilecount: 11 }],
    layers: [
      { name: "floor", type: "tilelayer" as const, data: new Array(width * height).fill(1) },
      { name: "collision", type: "tilelayer" as const, data: new Array(width * height).fill(0) },
      { name: "spawn-points", type: "objectgroup" as const, objects: spawnObjects },
      { name: "zones", type: "objectgroup" as const, objects: zoneObjects },
    ],
  };
  const renderer = new TiledMapRenderer(mapData, [Texture.WHITE]);
  return {
    TILE_SIZE: 32,
    loadWorldMap: vi.fn().mockResolvedValue(renderer),
  };
});

const AGENT_A: Agent = {
  id: "agent-a",
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

function agentAssignedRoom(agentId: string, ownerId: string) {
  const owned = FILE_ROOMS.filter((r) => r.ownerId === ownerId && r.requiresPermission);
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  return owned[hash % owned.length];
}

describe("WorldView", () => {
  beforeEach(() => {
    resetCapabilities();
    resetRequests();
    vi.mocked(beginHeadingToDesk).mockClear();
    vi.mocked(api.login).mockResolvedValue({
      sessionToken: "tok",
      principal: { kind: "human", id: "user-a", displayName: "User A" },
    });
    vi.mocked(api.runs).mockResolvedValue({ runs: [] });
    vi.mocked(api.messages).mockResolvedValue({ messages: [] });
  });

  async function login() {
    render(<WorldView />);
    fireEvent.click(await screen.findByText("Log in as User A"));
    await screen.findByText("Robot A");
  }

  it("shows every agent from every owner once logged in", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({
      agents: [AGENT_A, { ...AGENT_A, id: "agent-b", ownerId: "user-b", name: "Robot B" }],
    });
    await login();
    expect(await screen.findByText("Robot B")).toBeTruthy();
  });

  it("logs a permit and moves the agent off roaming when it already has a capability for its assigned room", async () => {
    const room = agentAssignedRoom(AGENT_A.id, AGENT_A.ownerId);
    issueCapability(AGENT_A.id, room.id);
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [{ ...AGENT_A, status: "busy" }] });

    await login();

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`${AGENT_A.name} → ${room.displayName}: permit`))).toBeTruthy();
    });
  });

  it("queues a request toast when the agent has no capability yet, and Grant resolves it", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [{ ...AGENT_A, status: "busy" }] });

    await login();

    const room = agentAssignedRoom(AGENT_A.id, AGENT_A.ownerId);
    const toastText = await screen.findByText(new RegExp(`wants access to ${room.displayName}`));
    expect(toastText).toBeTruthy();

    // finding 3: the request itself shows up in the security log, not just
    // as a toast.
    await screen.findByText(new RegExp(`${AGENT_A.name} requested access to ${room.displayName}`));

    // finding 4: while the request is pending, the agent's status pill
    // reads "awaiting access" instead of plain "roaming".
    expect(screen.getByText("awaiting access")).toBeTruthy();

    fireEvent.click(screen.getByText("Grant"));
    await waitFor(() => {
      expect(screen.queryByText(new RegExp(`wants access to ${room.displayName}`))).toBeNull();
    });

    // finding 3: the grant itself is also logged.
    await screen.findByText(new RegExp(`granted ${AGENT_A.name} access to ${room.displayName}`));
  });

  it("claims a different desk for each of two same-room agents busy in the same poll (finding 1)", async () => {
    const AGENT_A0: Agent = { ...AGENT_A, id: "agent-a0", name: "Robot A0" };
    const AGENT_A2: Agent = { ...AGENT_A, id: "agent-a2", name: "Robot A2" };
    const room0 = agentAssignedRoom(AGENT_A0.id, AGENT_A0.ownerId);
    const room2 = agentAssignedRoom(AGENT_A2.id, AGENT_A2.ownerId);
    // sanity check on the test setup itself: both ids must hash to the same
    // owned room, or this test isn't exercising the collision at all.
    expect(room0.id).toBe(room2.id);

    issueCapability(AGENT_A0.id, room0.id);
    issueCapability(AGENT_A2.id, room2.id);
    vi.mocked(api.listAgents).mockResolvedValue({
      agents: [{ ...AGENT_A0, status: "busy" }, { ...AGENT_A2, status: "busy" }],
    });

    render(<WorldView />);
    fireEvent.click(await screen.findByText("Log in as User A"));
    await screen.findByText("Robot A0");
    await screen.findByText("Robot A2");

    await waitFor(() => {
      expect(vi.mocked(beginHeadingToDesk).mock.results.length).toBeGreaterThanOrEqual(2);
    });

    const claimedDeskIds = vi
      .mocked(beginHeadingToDesk)
      .mock.results.map((result) => result.value)
      .filter((agent): agent is NonNullable<typeof agent> => agent != null)
      .map((agent) => agent.occupiedDeskId);

    // Both agents got a desk, and it's not the same one — before the fix,
    // both calls saw the same stale "nothing occupied yet" snapshot and both
    // picked desk 1.
    expect(claimedDeskIds).toHaveLength(2);
    expect(new Set(claimedDeskIds).size).toBe(2);
  });

  it("does not log a permit for the agent left waiting when every desk is full (finding 6)", async () => {
    // agent-a0/a2/a4 all hash to the same owned room ("billing", 2 desks) —
    // see the hash table derived in the finding-1 test above.
    const A0: Agent = { ...AGENT_A, id: "agent-a0", name: "Robot A0" };
    const A2: Agent = { ...AGENT_A, id: "agent-a2", name: "Robot A2" };
    const A4: Agent = { ...AGENT_A, id: "agent-a4", name: "Robot A4" };
    const room = agentAssignedRoom(A0.id, A0.ownerId);
    expect(agentAssignedRoom(A2.id, A2.ownerId).id).toBe(room.id);
    expect(agentAssignedRoom(A4.id, A4.ownerId).id).toBe(room.id);
    expect(room.deskIds).toHaveLength(2);

    issueCapability(A0.id, room.id);
    issueCapability(A2.id, room.id);
    issueCapability(A4.id, room.id);
    vi.mocked(api.listAgents).mockResolvedValue({
      agents: [
        { ...A0, status: "busy" },
        { ...A2, status: "busy" },
        { ...A4, status: "busy" },
      ],
    });

    render(<WorldView />);
    fireEvent.click(await screen.findByText("Log in as User A"));
    await screen.findByText("Robot A0");
    await screen.findByText("Robot A2");
    await screen.findByText("Robot A4");

    // Both desks get claimed (2 successful calls); the third agent's call
    // returns null and must not produce a third "permit" log line.
    await waitFor(() => {
      const successes = vi
        .mocked(beginHeadingToDesk)
        .mock.results.filter((result) => result.value != null);
      expect(successes.length).toBe(2);
    });

    const permitEntries = screen.getAllByText(new RegExp(`${room.displayName}: permit`));
    expect(permitEntries).toHaveLength(2);
  });
});
