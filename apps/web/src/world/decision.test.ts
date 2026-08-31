import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPrincipal, CapabilityRecord, PolicyRequestLike } from "../types";
import {
  decideRoomEntry,
  getCapability,
  grantedRoomsFor,
  issueCapability,
  refreshCapabilities,
  resetCapabilities,
  revokeCapability,
} from "./decision";

/**
 * These tests exist to pin down one property: the world does not decide.
 *
 * Every assertion below is about faithfully relaying what the backend said --
 * including asking it in the first place when the Agent holds no keycard, and
 * failing closed when it cannot be reached. If someone ever reintroduces a
 * local permit/deny rule, these go red.
 */

const NO_KEYCARD = "00000000-0000-0000-0000-000000000000";

/** The room ids used below and the resources they stand for. */
const AUTH_MODULE_URI = "res://user-a/notes.md";
const BILLING_URI = "res://user-a/secret-recipe.txt";

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

let calls: FetchCall[];

function liveCapability(
  id: string,
  agentId: string,
  uri: string,
): CapabilityRecord {
  return {
    id,
    scope: "read:" + uri,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    revokedAt: null,
    agentId,
    ownerId: "user-a",
    runId: null,
    issuedAt: new Date().toISOString(),
    revokedBy: null,
  };
}

function mockFetch(handler: (call: FetchCall) => { status: number; payload: unknown }) {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    const call: FetchCall = { url: String(url), body };
    calls.push(call);
    const outcome = handler(call);
    return {
      ok: outcome.status >= 200 && outcome.status < 300,
      status: outcome.status,
      json: async () => outcome.payload,
    } as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function decisionPayload(effect: "permit" | "deny", reason: string) {
  return {
    effect,
    reason,
    requestId: "req-from-server",
    decidedAt: "2026-08-31T00:00:00.000Z",
  };
}

function requestFor(agentId: string, resource: string): PolicyRequestLike {
  const principal: AgentPrincipal = {
    kind: "agent",
    id: "agent-principal-" + agentId,
    agentId,
    ownerId: "user-a",
  };
  return {
    principal,
    action: "enter",
    resource,
    capability: getCapability(agentId, resource),
    requestId: "req-" + agentId + "-" + resource,
  };
}

beforeEach(() => {
  calls = [];
  resetCapabilities();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("decideRoomEntry", () => {
  it("permits an open area without asking the backend at all", async () => {
    const fetchMock = mockFetch(() => ({ status: 200, payload: {} }));
    const decision = await decideRoomEntry(requestFor("agent-1", "living-room"));

    expect(decision.effect).toBe("permit");
    // An open area is not a protected resource, so there is no policy
    // question to ask and therefore no request to make.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relays a backend permit, reason and all", async () => {
    mockFetch(() => ({
      status: 200,
      payload: {
        decision: decisionPayload("permit", "capability-in-scope"),
        resource: { uri: AUTH_MODULE_URI, ownerId: "user-a", name: "notes.md" },
        content: "irrelevant",
      },
    }));

    const decision = await decideRoomEntry(requestFor("agent-1", "auth-module"));

    expect(decision.effect).toBe("permit");
    expect(decision.reason).toBe("capability-in-scope");
    // The verdict carries the server's own request id, not a locally minted one.
    expect(decision.requestId).toBe("req-from-server");
    expect(calls[0]?.url).toBe("/api/resources/read");
    expect(calls[0]?.body.uri).toBe(AUTH_MODULE_URI);
  });

  it("relays a backend deny rather than inventing one", async () => {
    mockFetch(() => ({
      status: 403,
      payload: {
        error: "Denied: out-of-scope",
        decision: decisionPayload("deny", "out-of-scope"),
      },
    }));

    const decision = await decideRoomEntry(requestFor("agent-1", "database"));

    expect(decision.effect).toBe("deny");
    expect(decision.reason).toBe("out-of-scope");
  });

  it("still asks the backend when the agent holds no keycard", async () => {
    mockFetch(() => ({
      status: 403,
      payload: {
        error: "Denied: capability-unknown",
        decision: decisionPayload("deny", "capability-unknown"),
      },
    }));

    const decision = await decideRoomEntry(requestFor("agent-1", "auth-module"));

    // The absence of a keycard is not grounds for the browser to decide: it
    // presents an id that cannot exist and lets the PDP refuse it.
    expect(calls[0]?.body.capabilityId).toBe(NO_KEYCARD);
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toBe("capability-unknown");
  });

  it("fails closed when the guard cannot be reached", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;

    const decision = await decideRoomEntry(requestFor("agent-1", "auth-module"));

    expect(decision.effect).toBe("deny");
    expect(decision.reason).toBe("policy-unreachable");
  });
});

describe("keycards", () => {
  it("mints one scoped to exactly the room's resource", async () => {
    mockFetch(() => ({
      status: 201,
      payload: { capability: liveCapability("cap-1", "agent-1", AUTH_MODULE_URI) },
    }));

    await issueCapability("agent-1", "auth-module");

    expect(calls[0]?.url).toBe("/api/capabilities");
    expect(calls[0]?.body.scope).toBe("read:" + AUTH_MODULE_URI);
    expect(getCapability("agent-1", "auth-module")?.id).toBe("cap-1");
  });

  it("revokes through the backend and drops the keycard locally", async () => {
    mockFetch((call) =>
      call.url === "/api/capabilities"
        ? {
            status: 201,
            payload: { capability: liveCapability("cap-1", "agent-1", AUTH_MODULE_URI) },
          }
        : { status: 200, payload: { capability: {} } },
    );

    await issueCapability("agent-1", "auth-module");
    await revokeCapability("agent-1", "auth-module");

    expect(calls[1]?.url).toBe("/api/capabilities/cap-1/revoke");
    expect(getCapability("agent-1", "auth-module")).toBeUndefined();
  });
});

describe("refreshCapabilities", () => {
  it("derives granted rooms from the backend, skipping revoked and expired", async () => {
    const revoked = liveCapability("cap-revoked", "agent-1", BILLING_URI);
    revoked.revokedAt = new Date().toISOString();
    const expired = liveCapability("cap-expired", "agent-2", BILLING_URI);
    expired.expiresAt = new Date(Date.now() - 1000).toISOString();

    mockFetch(() => ({
      status: 200,
      payload: {
        capabilities: [
          liveCapability("cap-live", "agent-1", AUTH_MODULE_URI),
          revoked,
          expired,
        ],
      },
    }));

    await refreshCapabilities();

    expect(grantedRoomsFor("agent-1")).toEqual(["auth-module"]);
    expect(grantedRoomsFor("agent-2")).toEqual([]);
  });
});
