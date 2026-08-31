import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, AuditEntry, CapabilityRecord } from "../types";
import { api, PolicyDeniedError } from "../api";
import { FILE_ROOMS, roomById } from "./resources";
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

// Only `api` is replaced: PolicyDeniedError stays the real class, so the
// instanceof check inside decision.ts sees the same constructor the fake
// backend below throws.
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      login: vi.fn(),
      listAgents: vi.fn(),
      runs: vi.fn(),
      messages: vi.fn(),
      audit: vi.fn(),
      capabilities: vi.fn(),
      issueCapability: vi.fn(),
      revokeCapability: vi.fn(),
      denyCapability: vi.fn().mockResolvedValue({ denied: true }),
      readResource: vi.fn(),
    },
    setSessionToken: vi.fn(),
  };
});

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
// The manifest is fetched from a ROOT-RELATIVE path, which resolves against
// the page origin in a browser and throws under Node, where there is no
// origin. WorldCanvas catches that and renders without decor, so the tests
// passed -- but every one of them printed a stack trace, which is exactly how
// a real failure goes unnoticed. Same mock WorldCanvas.test.tsx uses.
vi.mock("./roomDecor", () => ({
  loadRoomDecor: vi.fn().mockResolvedValue({ decor: [], equipment: [] }),
}));

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


/**
 * A small stand-in for the middleware backend.
 *
 * These tests are about what WorldView *renders* given what the server said, so
 * the fake has to behave like the server on the two axes the UI depends on:
 * scope decides permit/deny, and every decision lands in the audit trail that
 * the Security Log reads back. Deliberately not a policy engine -- the real one
 * is tested server-side; this is just enough to keep the seam honest.
 */
let fakeCapabilities: CapabilityRecord[] = [];
let fakeAudit: AuditEntry[] = [];
let fakeSequence = 0;

function resetFakeBackend(): void {
  fakeCapabilities = [];
  fakeAudit = [];
  fakeSequence = 0;
}

function isLiveCapability(capability: CapabilityRecord): boolean {
  if (capability.revokedAt) return false;
  return new Date(capability.expiresAt).getTime() >= Date.now();
}

function recordDecision(
  effect: "permit" | "deny",
  reason: string,
  resource: string,
  agentId: string,
) {
  fakeSequence += 1;
  const decision = {
    effect,
    reason,
    requestId: "req-" + fakeSequence,
    decidedAt: new Date(Date.now() + fakeSequence).toISOString(),
  };
  fakeAudit = [
    {
      id: "audit-" + fakeSequence,
      requestId: decision.requestId,
      decidedAt: decision.decidedAt,
      humanId: "user-a",
      agentId,
      principalKind: "agent",
      action: "resource:read",
      resource,
      effect,
      reason,
    },
    ...fakeAudit,
  ];
  return decision;
}

function installFakeBackend(): void {
  vi.mocked(api.audit).mockImplementation(async () => ({ entries: fakeAudit }));
  vi.mocked(api.capabilities).mockImplementation(async () => ({
    capabilities: fakeCapabilities,
  }));
  vi.mocked(api.issueCapability).mockImplementation(async ({ agentId, scope }) => {
    fakeSequence += 1;
    const capability: CapabilityRecord = {
      id: "cap-" + fakeSequence,
      scope: scope ?? "read:res://user-a/*",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      revokedAt: null,
      agentId,
      ownerId: "user-a",
      runId: null,
      issuedAt: new Date().toISOString(),
      revokedBy: null,
    };
    fakeCapabilities = [...fakeCapabilities, capability];
    return { capability };
  });
  vi.mocked(api.revokeCapability).mockImplementation(async (id: string) => {
    const found = fakeCapabilities.find((candidate) => candidate.id === id);
    if (!found) throw new Error("Capability not found");
    const revoked = { ...found, revokedAt: new Date().toISOString(), revokedBy: "user-a" };
    fakeCapabilities = fakeCapabilities.map((c) => (c.id === id ? revoked : c));
    return { capability: revoked };
  });
  vi.mocked(api.readResource).mockImplementation(async (uri: string, capabilityId: string) => {
    const capability = fakeCapabilities.find(
      (candidate) => candidate.id === capabilityId && isLiveCapability(candidate),
    );
    if (!capability) {
      const decision = recordDecision("deny", "capability-unknown", uri, "");
      throw new PolicyDeniedError("Denied: capability-unknown", decision);
    }
    if (capability.scope !== "read:" + uri) {
      const decision = recordDecision("deny", "out-of-scope", uri, capability.agentId);
      throw new PolicyDeniedError("Denied: out-of-scope", decision);
    }
    const decision = recordDecision("permit", "capability-in-scope", uri, capability.agentId);
    const name = uri.slice(uri.lastIndexOf("/") + 1);
    return {
      decision,
      resource: { uri, ownerId: "user-a", name },
      content: "demo content",
    };
  });
}

describe("WorldView", () => {
  beforeEach(() => {
    resetCapabilities();
    resetRequests();
    resetFakeBackend();
    installFakeBackend();
    vi.mocked(beginHeadingToDesk).mockClear();
    vi.mocked(api.login).mockResolvedValue({
      sessionToken: "tok",
      principal: { kind: "human", id: "user-a", displayName: "User A" },
    });
    vi.mocked(api.runs).mockResolvedValue({ runs: [] });
    vi.mocked(api.messages).mockResolvedValue({ messages: [] });
  });

  /** A live backend capability for `agentId`, scoped to its owner's namespace. */
  function liveCapabilityFor(agentId: string, ownerId = "user-a") {
    return {
      id: "cap-" + agentId,
      scope: `read:res://${ownerId}/*`,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      revokedAt: null,
      agentId,
      ownerId,
      runId: null,
      issuedAt: new Date().toISOString(),
      revokedBy: null,
    };
  }

  async function login() {
    render(<WorldView />);
    fireEvent.click(await screen.findByText("Enter the world"));
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
    await issueCapability(AGENT_A.id, room.id);
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

    // Granting takes two clicks now: the first only arms the decision.
    fireEvent.click(screen.getByText("Grant"));
    expect(screen.queryByText(new RegExp(`granted ${AGENT_A.name} access`))).toBeNull();
    fireEvent.click(screen.getByText("Confirm grant"));
    await waitFor(() => {
      expect(screen.queryByText(new RegExp(`wants access to ${room.displayName}`))).toBeNull();
    });

    // finding 3: the grant itself is also logged.
    await screen.findByText(new RegExp(`granted ${AGENT_A.name} access to ${room.displayName}`));
  });

  it("does not change permissions until the grant is confirmed (task 2)", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [{ ...AGENT_A, status: "busy" }] });
    await login();

    const room = agentAssignedRoom(AGENT_A.id, AGENT_A.ownerId);
    await screen.findByText(new RegExp(`wants access to ${room.displayName}`));

    fireEvent.click(screen.getByText("Grant"));
    // Armed, not committed: the request is still pending and nothing is logged.
    expect(screen.getByText(new RegExp(`Give ${AGENT_A.name} a keycard`))).toBeTruthy();
    expect(screen.queryByText(new RegExp(`granted ${AGENT_A.name} access`))).toBeNull();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Confirm grant")).toBeNull();
    expect(screen.getByText(new RegExp(`wants access to ${room.displayName}`))).toBeTruthy();
    expect(screen.queryByText(new RegExp(`granted ${AGENT_A.name} access`))).toBeNull();
  });

  it("does not refuse access until the deny is confirmed (task 2)", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [{ ...AGENT_A, status: "busy" }] });
    await login();

    const room = agentAssignedRoom(AGENT_A.id, AGENT_A.ownerId);
    await screen.findByText(new RegExp(`wants access to ${room.displayName}`));

    fireEvent.click(screen.getByText("Deny"));
    expect(screen.queryByText(new RegExp(`denied ${AGENT_A.name} access`))).toBeNull();

    fireEvent.click(screen.getByText("Confirm deny"));
    await screen.findByText(new RegExp(`denied ${AGENT_A.name} access to ${room.displayName}`));
  });

  // The wall reads the BACKEND capability store, not the in-browser mock: the
  // real keycard is scoped to the owner's whole namespace, so a live record
  // covers every room that owner owns.
  it("shows a keycard for every protected room, held or not (task 4)", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [AGENT_A] });
    vi.mocked(api.capabilities).mockResolvedValue({
      capabilities: [liveCapabilityFor(AGENT_A.id, AGENT_A.ownerId)],
    });
    await login();

    fireEvent.click(screen.getByText("Robot A"));

    const gated = FILE_ROOMS.filter((candidate) => candidate.requiresPermission);
    for (const candidate of gated) {
      expect(screen.getAllByText(candidate.displayName).length).toBeGreaterThan(0);
    }
    const owned = gated.filter((candidate) => candidate.ownerId === "user-a");
    const foreign = gated.filter((candidate) => candidate.ownerId !== "user-a");
    expect(await screen.findAllByText("keycard held")).toHaveLength(owned.length);
    expect(screen.getAllByText("another owner").length).toBe(foreign.length);
  });

  // The keycard a Run holds authorises execution, not data (scope
  // "owner:user-a"). Treating any live card as opening every room made the
  // owner's grant meaningless on screen.
  // No keycard for another owner's room can exist -- the backend refuses any
  // cross-owner scope -- so queuing a request would ask for something nobody
  // could grant, and the Run would hold open until it timed out.
  it("tells the server to stop waiting when an Agent is jailed for a foreign room", async () => {
    // Deploy Config, not just "any user-b room": its aliases are unambiguous.
    // "notes.md" names a file in BOTH namespaces, so a prompt mentioning it
    // resolves to the Agent's own copy and never reaches the foreign branch.
    const foreign = roomById("deploy-config");
    expect(foreign.ownerId).not.toBe(AGENT_A.ownerId);
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [{ ...AGENT_A, status: "busy" }] });
    vi.mocked(api.runs).mockResolvedValue({
      runs: [
        {
          id: "run-b",
          agentId: AGENT_A.id,
          status: "running",
          prompt: `read ${foreign.displayName}`,
          output: null,
          error: null,
          usage: null,
          awaitingCapability: true,
          withheldCount: 0,
          stagedResources: [],
          createdAt: new Date().toISOString(),
        },
      ],
    });
    await login();

    await waitFor(
      () => {
        expect(api.denyCapability).toHaveBeenCalledWith(
          AGENT_A.id,
          expect.stringContaining(foreign.displayName),
        );
      },
      { timeout: 6000 },
    );
    // Reported as being caught, not as a request awaiting an answer.
    await screen.findByText(new RegExp(`thrown in the Jail`));
    // The arrest is drawn first: the Agent is in the cell BEFORE the refusal
    // reaches the server and collapses the Run under it.
    expect(screen.getByText("JAILED")).toBeTruthy();
    expect(screen.queryByText(new RegExp(`requested access to ${foreign.displayName}`))).toBeNull();
  });

  // The run-start sweep evaluates the owner's whole namespace under ONE
  // requestId. A row per resource made an Agent that reached for nothing look
  // like it was demanding every keycard at once, and it scales with the
  // namespace rather than with what happened.
  it("collapses a run-start sweep into a single log row", async () => {
    const sweep = "req-sweep";
    const sweptAt = new Date().toISOString();
    const entry = (id: string, resource: string, effect: "permit" | "deny") => ({
      id,
      requestId: sweep,
      decidedAt: sweptAt,
      humanId: "user-a",
      agentId: AGENT_A.id,
      principalKind: "agent" as const,
      action: "resource:read",
      resource,
      effect,
      reason: effect === "permit" ? "capability-in-scope" : "capability-unknown",
    });
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [AGENT_A] });
    vi.mocked(api.audit).mockResolvedValue({
      entries: [
        entry("a1", "res://user-a/notes.md", "deny"),
        entry("a2", "res://user-a/secret-recipe.txt", "permit"),
        entry("a3", "res://user-a/analytics-summary.md", "deny"),
      ],
    });
    await login();

    await screen.findByText(`${AGENT_A.name} at run start: 1 staged, 2 withheld`);
    // Not one row per resource.
    expect(screen.queryByText(/Auth Module: deny/)).toBeNull();
    expect(screen.queryByText(/Analytics: deny/)).toBeNull();
  });

  it("shows no rooms held for an Agent carrying only its run keycard", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [AGENT_A] });
    vi.mocked(api.capabilities).mockResolvedValue({
      capabilities: [{ ...liveCapabilityFor(AGENT_A.id), scope: "owner:user-a" }],
    });
    await login();

    fireEvent.click(screen.getByText("Robot A"));

    expect(screen.queryAllByText("keycard held")).toHaveLength(0);
    expect(screen.getAllByText("no keycard").length).toBeGreaterThan(0);
  });

  // A shredded Agent is suspended: its next run is refused at execution, so it
  // never walks to a door and never asks. Without a direct grant there is no
  // way back, and the demo strands.
  it("lets the owner grant a keycard with no request pending", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [AGENT_A] });
    await login();

    fireEvent.click(screen.getByText("Robot A"));
    expect(screen.queryAllByText("keycard held")).toHaveLength(0);

    fireEvent.click(screen.getAllByText("Grant")[0]!);

    await waitFor(() => {
      expect(api.issueCapability).toHaveBeenCalled();
    });
    await screen.findAllByText("keycard held");
  });

  it("shows only the room a single-file grant opens", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [AGENT_A] });
    vi.mocked(api.capabilities).mockResolvedValue({
      capabilities: [
        { ...liveCapabilityFor(AGENT_A.id), scope: "read:res://user-a/secret-recipe.txt" },
      ],
    });
    await login();

    fireEvent.click(screen.getByText("Robot A"));

    expect(await screen.findAllByText("keycard held")).toHaveLength(1);
  });

  it("shows no keycard once the backend capability is revoked", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [AGENT_A] });
    vi.mocked(api.capabilities).mockResolvedValue({
      capabilities: [{ ...liveCapabilityFor(AGENT_A.id), revokedAt: new Date().toISOString() }],
    });
    await login();

    fireEvent.click(screen.getByText("Robot A"));

    expect(screen.queryAllByText("keycard held")).toHaveLength(0);
    expect(screen.getAllByText("no keycard").length).toBeGreaterThan(0);
  });

  // Regression: the keycard the backend issues at run start is scoped to the
  // owner's whole namespace, which is not any one room. Shredding used to walk
  // the per-room cache, match nothing, and still log "3 rooms revoked".
  it("shreds the namespace-wide keycard the panel is showing", async () => {
    fakeCapabilities = [liveCapabilityFor(AGENT_A.id, AGENT_A.ownerId)];
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [AGENT_A] });
    await login();

    fireEvent.click(screen.getByText("Robot A"));
    expect((await screen.findAllByText("keycard held")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Shred this agent's keycard"));

    await waitFor(() => {
      expect(api.revokeCapability).toHaveBeenCalledWith("cap-" + AGENT_A.id);
    });
    await waitFor(() => {
      expect(screen.queryAllByText("keycard held")).toHaveLength(0);
    });
  });

  it("claims a different desk for each of two same-room agents busy in the same poll (finding 1)", async () => {
    const AGENT_A0: Agent = { ...AGENT_A, id: "agent-a0", name: "Robot A0" };
    const AGENT_A3: Agent = { ...AGENT_A, id: "agent-a3", name: "Robot A3" };
    const room0 = agentAssignedRoom(AGENT_A0.id, AGENT_A0.ownerId);
    const room2 = agentAssignedRoom(AGENT_A3.id, AGENT_A3.ownerId);
    // sanity check on the test setup itself: both ids must hash to the same
    // owned room, or this test isn't exercising the collision at all.
    expect(room0.id).toBe(room2.id);

    await issueCapability(AGENT_A0.id, room0.id);
    await issueCapability(AGENT_A3.id, room2.id);
    vi.mocked(api.listAgents).mockResolvedValue({
      agents: [{ ...AGENT_A0, status: "busy" }, { ...AGENT_A3, status: "busy" }],
    });

    render(<WorldView />);
    fireEvent.click(await screen.findByText("Enter the world"));
    await screen.findByText("Robot A0");
    await screen.findByText("Robot A3");

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

  it("logs all three permits but seats only two when the room runs out of desks", async () => {
    // agent-a0/a3/a6 all hash to the same owned room ("billing", 2 desks) —
    // see the hash table derived in the finding-1 test above.
    const A0: Agent = { ...AGENT_A, id: "agent-a0", name: "Robot A0" };
    const A3: Agent = { ...AGENT_A, id: "agent-a3", name: "Robot A3" };
    const A6: Agent = { ...AGENT_A, id: "agent-a6", name: "Robot A6" };
    const room = agentAssignedRoom(A0.id, A0.ownerId);
    expect(agentAssignedRoom(A3.id, A3.ownerId).id).toBe(room.id);
    expect(agentAssignedRoom(A6.id, A6.ownerId).id).toBe(room.id);
    expect(room.deskIds).toHaveLength(2);

    await issueCapability(A0.id, room.id);
    await issueCapability(A3.id, room.id);
    await issueCapability(A6.id, room.id);
    vi.mocked(api.listAgents).mockResolvedValue({
      agents: [
        { ...A0, status: "busy" },
        { ...A3, status: "busy" },
        { ...A6, status: "busy" },
      ],
    });

    render(<WorldView />);
    fireEvent.click(await screen.findByText("Enter the world"));
    await screen.findByText("Robot A0");
    await screen.findByText("Robot A3");
    await screen.findByText("Robot A6");

    // Both desks get claimed; the third agent's call returns null and it
    // keeps roaming.
    await waitFor(() => {
      const successes = vi
        .mocked(beginHeadingToDesk)
        .mock.results.filter((result) => result.value != null);
      expect(successes.length).toBe(2);
    });

    // All three permits are logged, because all three really happened: the PDP
    // was asked three times and allowed access three times. A room with no
    // free desk is a constraint of the world, not a refusal by the policy
    // engine, and the Security Log is a view of the audit trail rather than a
    // record of who got a seat. Suppressing the third row here would put the
    // log out of step with the backend it claims to be showing.
    await waitFor(() => {
      expect(
        screen.getAllByText(new RegExp(`${room.displayName}: permit`)),
      ).toHaveLength(3);
    });
  });

  it("teleports an agent to the Jail when its task reaches for another owner's room", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [{ ...AGENT_A, status: "busy" }] });
    // The realistic overreach: the run's prompt names a folder user-a does
    // not own. roomForTask resolves it ownership-blind; the guard denies it,
    // and instead of queueing a request the agent is jailed on the spot.
    vi.mocked(api.runs).mockResolvedValue({
      runs: [
        {
          id: "run-1",
          agentId: AGENT_A.id,
          status: "running",
          prompt: "fix the deploy config",
          output: null,
          error: null,
          usage: null,
          awaitingCapability: false,
          withheldCount: 0,
          stagedResources: [],
          createdAt: "",
        },
      ],
    });

    await login();

    await screen.findByText(
      new RegExp(`${AGENT_A.name} was caught touching Deploy Config → thrown in the Jail`),
    );
    // Straight to jail: no access-request toast for a foreign room, the
    // JAILED badge is in the log, and the roster pill shows the sentence.
    expect(screen.queryByText(/wants access to Deploy Config/)).toBeNull();
    expect(screen.getByText("JAILED")).toBeTruthy();
    expect(screen.getByText("in jail")).toBeTruthy();
  });

});
