/**
 * DEMONSTRATION SUITE -- the frontend half.
 *
 * Every test here is written to be read out loud. Each name is a claim, and
 * the body is the evidence for it. Two claims are on trial:
 *
 *   1. The world never decides. Every permit and deny that gates access comes
 *      from the backend, and the browser only relays it.
 *   2. The folders on screen are yours to control. Which file a room guards is
 *      configuration, and changing it changes what the guard is asked about.
 *
 * Run it with:  npm run test -w @launchpad/web
 * The companion server suite is apps/server/src/demonstration.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPrincipal, PolicyRequestLike } from "../types";
import { decideRoomEntry, resetCapabilities } from "./decision";
import { FILE_ROOMS, roomById } from "./resources";

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

let calls: FetchCall[];

/** Stands in for the control plane so we can watch exactly what gets asked. */
function backendAnswers(status: number, payload: unknown) {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    calls.push({
      url: String(url),
      body: options?.body ? JSON.parse(String(options.body)) : {},
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    } as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function verdict(effect: "permit" | "deny", reason: string) {
  return {
    effect,
    reason,
    requestId: "req-issued-by-the-server",
    decidedAt: "2026-08-31T12:00:00.000Z",
  };
}

function agentAtDoor(roomId: string): PolicyRequestLike {
  const principal: AgentPrincipal = {
    kind: "agent",
    id: "agent-principal-demo",
    agentId: "demo-agent",
    ownerId: "user-a",
  };
  return {
    principal,
    action: "enter",
    resource: roomId,
    capability: undefined,
    requestId: "req-minted-by-the-browser",
  };
}

const gatedRooms = FILE_ROOMS.filter((room) => room.requiresPermission);

beforeEach(() => {
  calls = [];
  resetCapabilities();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CLAIM 1: the world does not decide -- the backend does", () => {
  it("asks the backend before entering every single protected room", async () => {
    // Not a spot check. Every gated room in the world is walked up to, and
    // each one must produce a request. A room that answered locally would
    // show up here as a missing call.
    for (const room of gatedRooms) {
      calls = [];
      backendAnswers(403, {
        error: "Denied",
        decision: verdict("deny", "capability-unknown"),
      });

      await decideRoomEntry(agentAtDoor(room.id));

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("/api/resources/read");
      expect(calls[0]?.body.uri).toBe(room.resourceUri);
    }
  });

  it("repeats the backend's permit verbatim, including the server's request id", async () => {
    backendAnswers(200, {
      decision: verdict("permit", "capability-in-scope"),
      resource: { uri: "res://user-a/notes.md", ownerId: "user-a", name: "notes.md" },
      content: "contents the guard allowed through",
    });

    const decision = await decideRoomEntry(agentAtDoor("auth-module"));

    expect(decision.effect).toBe("permit");
    expect(decision.reason).toBe("capability-in-scope");
    // The id proves the provenance: it was minted server-side, not here.
    expect(decision.requestId).toBe("req-issued-by-the-server");
    expect(decision.requestId).not.toBe("req-minted-by-the-browser");
  });

  it("repeats the backend's deny verbatim rather than inventing a reason", async () => {
    backendAnswers(403, {
      error: "Denied: out-of-scope",
      decision: verdict("deny", "out-of-scope"),
    });

    const decision = await decideRoomEntry(agentAtDoor("database"));

    expect(decision.effect).toBe("deny");
    // "out-of-scope" is vocabulary only the PDP uses. The browser has no rule
    // that could have produced this string.
    expect(decision.reason).toBe("out-of-scope");
  });

  it("cannot open a door the backend refused, even for the owner's own room", async () => {
    // Auth Module belongs to user-a and the agent belongs to user-a. Under any
    // local ownership shortcut this would open. It does not, because the only
    // thing consulted is the server.
    backendAnswers(403, {
      error: "Denied: capability-revoked",
      decision: verdict("deny", "capability-revoked"),
    });

    const decision = await decideRoomEntry(agentAtDoor("auth-module"));

    expect(decision.effect).toBe("deny");
    expect(decision.reason).toBe("capability-revoked");
  });

  it("denies when the guard cannot be reached, instead of falling open", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;

    const decision = await decideRoomEntry(agentAtDoor("billing"));

    // A guard that cannot be asked is a closed door, matching how the
    // server-side gate treats a PDP that throws.
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toBe("policy-unreachable");
  });

  it("only ever answers locally for an open area, which guards nothing", async () => {
    const fetchMock = backendAnswers(200, {});

    const decision = await decideRoomEntry(agentAtDoor("living-room"));

    expect(decision.effect).toBe("permit");
    expect(decision.reason).toContain("not a protected resource");
    expect(fetchMock).not.toHaveBeenCalled();

    // And the reason that is acceptable: the Living Room is the only room in
    // the world that stands for no file at all.
    const roomsWithoutAFile = FILE_ROOMS.filter((room) => room.resourceUri === null);
    expect(roomsWithoutAFile.map((room) => room.id)).toEqual(["living-room"]);
    expect(roomsWithoutAFile.every((room) => !room.requiresPermission)).toBe(true);
  });
});

describe("CLAIM 2: the folders on screen are configuration you control", () => {
  it("gives every guarded room a real file behind it", () => {
    // A room that guards nothing could never be enforced. This is the
    // structural check that the world and the resource store line up.
    for (const room of gatedRooms) {
      expect(room.resourceUri).toMatch(/^res:\/\/[a-z0-9-]+\/.+/);
      expect(room.ownerId).toBeTruthy();
      // The room's owner and the file's owner have to agree, or the guard
      // would be defending a different person's house than the label claims.
      expect(room.resourceUri?.startsWith(`res://${room.ownerId}/`)).toBe(true);
    }
  });

  it("never points two rooms at the same file", () => {
    const uris = gatedRooms.map((room) => room.resourceUri);
    expect(new Set(uris).size).toBe(uris.length);
  });

  it("asks about whatever file you point a room at", async () => {
    // This is the editing story in one test: change the file a room stands
    // for, and the guard is asked about the new file. Nothing else moves.
    const room = roomById("analytics");
    const original = room.resourceUri;
    room.resourceUri = "res://user-a/quarterly-report.md";

    try {
      backendAnswers(403, {
        error: "Denied",
        decision: verdict("deny", "capability-unknown"),
      });

      await decideRoomEntry(agentAtDoor("analytics"));

      expect(calls[0]?.body.uri).toBe("res://user-a/quarterly-report.md");
    } finally {
      room.resourceUri = original;
    }
  });

  it("hands a room to another owner just by changing who owns it", async () => {
    // Re-homing a room is a one-field edit. The agent belongs to user-a, so
    // once Billing belongs to user-b the backend is asked about user-b's file
    // -- which is the request that gets refused as out-of-scope.
    const room = roomById("billing");
    const originalUri = room.resourceUri;
    const originalOwner = room.ownerId;
    room.ownerId = "user-b";
    room.resourceUri = "res://user-b/notes.md";

    try {
      backendAnswers(403, {
        error: "Denied: out-of-scope",
        decision: verdict("deny", "out-of-scope"),
      });

      const decision = await decideRoomEntry(agentAtDoor("billing"));

      expect(calls[0]?.body.uri).toBe("res://user-b/notes.md");
      expect(decision.reason).toBe("out-of-scope");
    } finally {
      room.ownerId = originalOwner;
      room.resourceUri = originalUri;
    }
  });
});
