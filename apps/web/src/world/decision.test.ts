import { beforeEach, describe, expect, it } from "vitest";
import {
  decideRoomEntry,
  getCapability,
  issueCapability,
  resetCapabilities,
  revokeCapability,
} from "./decision";
import type { AgentPrincipal, PolicyRequestLike } from "../types";

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
    capability: getCapability(agentId),
    requestId: "req-" + agentId + "-" + resource,
  };
}

describe("decideRoomEntry", () => {
  beforeEach(() => {
    resetCapabilities();
  });

  it("permits an agent entering its own owner's house", async () => {
    issueCapability("agent-1", "user-a");
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "house-a"));
    expect(decision.effect).toBe("permit");
  });

  it("denies an agent entering a different owner's house", async () => {
    issueCapability("agent-1", "user-a");
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "house-b"));
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("user-a");
  });

  it("denies when there is no capability at all", async () => {
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "house-a"));
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("no capability");
  });

  it("denies after the capability is revoked", async () => {
    issueCapability("agent-1", "user-a");
    revokeCapability("agent-1");
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "house-a"));
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("revoked");
  });

  it("denies when the capability has expired", async () => {
    issueCapability("agent-1", "user-a");
    const capability = getCapability("agent-1");
    capability!.expiresAt = new Date(Date.now() - 1000).toISOString();
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "house-a"));
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("expired");
  });
});
