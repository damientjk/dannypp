import { beforeEach, describe, expect, it } from "vitest";
import type { AgentPrincipal, PolicyRequestLike } from "../types";
import {
  decideRoomEntry,
  getCapability,
  grantedRoomsFor,
  issueCapability,
  resetCapabilities,
  revokeCapability,
} from "./decision";

function requestFor(agentId: string, ownerId: string, resource: string): PolicyRequestLike {
  const principal: AgentPrincipal = {
    kind: "agent",
    id: "agent-principal-" + agentId,
    agentId,
    ownerId,
  };
  return {
    principal,
    action: "enter",
    resource,
    capability: getCapability(agentId, resource),
    requestId: "req-" + agentId + "-" + resource,
  };
}

describe("decideRoomEntry", () => {
  beforeEach(() => {
    resetCapabilities();
  });

  it("permits entry to a common room with no capability at all", async () => {
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "living-room"));
    expect(decision.effect).toBe("permit");
  });

  it("permits a room the agent was granted", async () => {
    issueCapability("agent-1", "auth-module");
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "auth-module"));
    expect(decision.effect).toBe("permit");
  });

  it("denies a permission-gated room with no capability", async () => {
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "auth-module"));
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("no capability");
  });

  it("granting one room does not grant a different room for the same agent", async () => {
    issueCapability("agent-1", "auth-module");
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "billing"));
    expect(decision.effect).toBe("deny");
  });

  it("granting a room for one agent does not grant it for a different agent", async () => {
    issueCapability("agent-1", "auth-module");
    const decision = await decideRoomEntry(requestFor("agent-2", "user-a", "auth-module"));
    expect(decision.effect).toBe("deny");
  });

  it("denies after the capability is revoked", async () => {
    issueCapability("agent-1", "auth-module");
    revokeCapability("agent-1", "auth-module");
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "auth-module"));
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("revoked");
  });

  it("denies when the capability has expired", async () => {
    issueCapability("agent-1", "auth-module");
    const capability = getCapability("agent-1", "auth-module");
    capability!.expiresAt = new Date(Date.now() - 1000).toISOString();
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "auth-module"));
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("expired");
  });

  it("denies when a request is built with a capability scoped to a different room than it requests", async () => {
    // Every real caller looks up the capability via getCapability(agentId,
    // resource), which by construction can only ever return a capability
    // whose scope already equals resource — so this branch is otherwise
    // unreachable through normal usage. It's still real defensive-in-depth
    // PDP behavior (never trust that a caller's capability lookup matched
    // its own resource field), so it needs its own direct test: build the
    // request by hand instead of through requestFor's automatic lookup.
    const mismatched = issueCapability("agent-1", "auth-module");
    const request: PolicyRequestLike = {
      principal: { kind: "agent", id: "agent-principal-agent-1", agentId: "agent-1", ownerId: "user-a" },
      action: "enter",
      resource: "billing",
      capability: mismatched,
      requestId: "req-mismatch",
    };
    const decision = await decideRoomEntry(request);
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("scoped to auth-module");
  });
});

describe("grantedRoomsFor", () => {
  beforeEach(() => {
    resetCapabilities();
  });

  it("lists only currently-valid granted rooms for the given agent", () => {
    issueCapability("agent-1", "auth-module");
    issueCapability("agent-1", "billing");
    issueCapability("agent-2", "database");
    revokeCapability("agent-1", "billing");
    expect(grantedRoomsFor("agent-1")).toEqual(["auth-module"]);
    expect(grantedRoomsFor("agent-2")).toEqual(["database"]);
  });
});
