import { describe, expect, it } from "vitest";
import type { AgentPrincipal, Capability, HumanPrincipal, PolicyRequest } from "../types.js";
import { pdp } from "./pdp.js";

const humanA: HumanPrincipal = { kind: "human", id: "user-a", displayName: "User A" };
const humanB: HumanPrincipal = { kind: "human", id: "user-b", displayName: "User B" };
const agentOfA: AgentPrincipal = {
  kind: "agent",
  id: "agent-principal:1",
  agentId: "agent-1",
  ownerId: "user-a",
};

function validCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "cap-1",
    scope: "owner:user-a",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    revokedAt: null,
    ...overrides,
  };
}

function request(overrides: Partial<PolicyRequest>): PolicyRequest {
  return {
    principal: humanA,
    action: "agent:read",
    resource: "agent:user-a:agent-1",
    requestId: "req-1",
    ...overrides,
  };
}

describe("pdp.decide", () => {
  it("permits a human reading their own agent", async () => {
    const decision = await pdp.decide(request({}));
    expect(decision).toMatchObject({ effect: "permit", reason: "owner-match", requestId: "req-1" });
    expect(Number.isNaN(Date.parse(decision.decidedAt))).toBe(false);
  });

  it("denies a human reading another user's agent", async () => {
    const decision = await pdp.decide(request({ principal: humanB }));
    expect(decision).toMatchObject({ effect: "deny", reason: "not-owner" });
  });

  it("permits an agent principal with a valid matching capability", async () => {
    const decision = await pdp.decide(
      request({ principal: agentOfA, capability: validCapability() }),
    );
    expect(decision).toMatchObject({ effect: "permit", reason: "capability-valid" });
  });

  it("denies an agent principal with no capability", async () => {
    const decision = await pdp.decide(request({ principal: agentOfA }));
    expect(decision).toMatchObject({ effect: "deny", reason: "missing-capability" });
  });

  it("denies a revoked capability", async () => {
    const decision = await pdp.decide(
      request({
        principal: agentOfA,
        capability: validCapability({ revokedAt: new Date().toISOString() }),
      }),
    );
    expect(decision).toMatchObject({ effect: "deny", reason: "capability-revoked" });
  });

  it("denies an expired capability", async () => {
    const decision = await pdp.decide(
      request({
        principal: agentOfA,
        capability: validCapability({ expiresAt: new Date(Date.now() - 1_000).toISOString() }),
      }),
    );
    expect(decision).toMatchObject({ effect: "deny", reason: "capability-expired" });
  });

  it("denies a capability scoped to a different owner", async () => {
    const decision = await pdp.decide(
      request({ principal: agentOfA, capability: validCapability({ scope: "owner:user-b" }) }),
    );
    expect(decision).toMatchObject({ effect: "deny", reason: "capability-scope-mismatch" });
  });

  it("denies a capability with an unparsable expiry", async () => {
    const decision = await pdp.decide(
      request({ principal: agentOfA, capability: validCapability({ expiresAt: "not-a-date" }) }),
    );
    expect(decision).toMatchObject({ effect: "deny", reason: "malformed-capability" });
  });

  it("denies a malformed resource string", async () => {
    const decision = await pdp.decide(request({ resource: "not-a-resource" }));
    expect(decision).toMatchObject({ effect: "deny", reason: "malformed-resource" });
  });

  it("denies an unknown principal kind", async () => {
    const decision = await pdp.decide(
      request({ principal: { kind: "robot" } as unknown as HumanPrincipal }),
    );
    expect(decision).toMatchObject({ effect: "deny", reason: "unknown-principal-kind" });
  });

  it("default-denies instead of throwing when resource is not a string", async () => {
    const decision = await pdp.decide(request({ resource: 42 as unknown as string }));
    expect(decision.effect).toBe("deny");
  });
});
