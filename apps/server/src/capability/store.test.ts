import { describe, expect, it } from "vitest";
import type { AgentPrincipal } from "../types.js";
import {
  agentPrincipalFor,
  capabilityStore,
  CapabilityStore,
  issueCapabilityForRun,
  validateCapability,
} from "./store.js";

const agentA: AgentPrincipal = {
  kind: "agent",
  id: "agent:agent-1",
  agentId: "agent-1",
  ownerId: "user-a",
};

const agentB: AgentPrincipal = {
  kind: "agent",
  id: "agent:agent-2",
  agentId: "agent-2",
  ownerId: "user-b",
};

describe("capability issuance", () => {
  it("mints a live keycard scoped to the owner", () => {
    const store = new CapabilityStore();
    const capability = store.issueForRun(agentA, "run-1");

    expect(capability.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(capability.scope).toBe("read:res://user-a/*");
    expect(capability.revokedAt).toBeNull();
    expect(capability.ownerId).toBe("user-a");
    expect(capability.agentId).toBe("agent-1");
    expect(capability.runId).toBe("run-1");
    expect(Date.parse(capability.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("refuses to cut a keycard for someone else's house", () => {
    const store = new CapabilityStore();
    expect(() =>
      store.issue({ agentPrincipal: agentA, scope: "read:res://user-b/*" }),
    ).toThrow(/Refusing to issue/);
  });

  it("refuses a malformed scope", () => {
    const store = new CapabilityStore();
    expect(() =>
      store.issue({ agentPrincipal: agentA, scope: "read:res://user-a/../user-b/*" }),
    ).toThrow(/Malformed capability scope/);
  });

  it("derives the agent principal from the record", () => {
    const store = new CapabilityStore();
    const capability = store.issueForRun(agentA, "run-1");
    expect(agentPrincipalFor(capability)).toEqual(agentA);
  });
});

describe("capability validation", () => {
  it("accepts a fresh capability", () => {
    const store = new CapabilityStore();
    const capability = store.issueForRun(agentA, "run-1");
    const result = store.validate(capability.id);
    expect(result.valid).toBe(true);
  });

  it("reports capability-unknown for an id it never issued", () => {
    const store = new CapabilityStore();
    expect(store.validate("no-such-id")).toEqual({
      valid: false,
      reason: "capability-unknown",
    });
    expect(store.validate(undefined)).toEqual({
      valid: false,
      reason: "capability-unknown",
    });
  });

  it("reports capability-revoked after the owner shreds it", () => {
    const store = new CapabilityStore();
    const capability = store.issueForRun(agentA, "run-1");
    store.revoke(capability.id, "user-a");
    expect(store.validate(capability.id)).toEqual({
      valid: false,
      reason: "capability-revoked",
    });
  });

  it("reports capability-expired once the clock passes expiry", () => {
    // ttlMs of -1 yields an already-expired capability, so the expiry path is
    // tested without mocking the clock.
    const store = new CapabilityStore();
    const capability = store.issue({
      agentPrincipal: agentA,
      scope: "read:res://user-a/*",
      ttlMs: -1,
    });
    expect(store.validate(capability.id)).toEqual({
      valid: false,
      reason: "capability-expired",
    });
  });

  it("prefers 'revoked' over 'expired' when both apply", () => {
    const store = new CapabilityStore();
    const capability = store.issue({
      agentPrincipal: agentA,
      scope: "read:res://user-a/*",
      ttlMs: -1,
    });
    store.revoke(capability.id, "user-a");
    expect(store.validate(capability.id)).toMatchObject({
      reason: "capability-revoked",
    });
  });

  it("validates a bare capability object without a store", () => {
    expect(validateCapability(null)).toMatchObject({
      reason: "capability-unknown",
    });
    expect(
      validateCapability({
        id: "x",
        scope: "read:res://user-a/*",
        expiresAt: "not-a-date",
        revokedAt: null,
      }),
    ).toMatchObject({ reason: "capability-expired" });
  });
});

describe("capability revocation", () => {
  it("keeps the first revocation timestamp when revoked twice", async () => {
    const store = new CapabilityStore();
    const capability = store.issueForRun(agentA, "run-1");
    const first = store.revoke(capability.id, "user-a");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = store.revoke(capability.id, "user-a");
    expect(second?.revokedAt).toBe(first?.revokedAt);
    expect(second?.revokedBy).toBe("user-a");
  });

  it("returns null for an unknown id", () => {
    const store = new CapabilityStore();
    expect(store.revoke("no-such-id", "user-a")).toBeNull();
  });

  it("revokes every live capability for one agent", () => {
    const store = new CapabilityStore();
    const first = store.issueForRun(agentA, "run-1");
    const second = store.issueForRun(agentA, "run-2");
    const other = store.issueForRun(agentB, "run-3");

    const revoked = store.revokeAllForAgent("agent-1", "user-a");

    expect(revoked).toHaveLength(2);
    expect(store.validate(first.id).valid).toBe(false);
    expect(store.validate(second.id).valid).toBe(false);
    expect(store.validate(other.id).valid).toBe(true);
  });
});

describe("capability listing", () => {
  it("filters by owner and agent, newest first", () => {
    const store = new CapabilityStore();
    store.issueForRun(agentA, "run-1");
    store.issueForRun(agentB, "run-2");

    expect(store.list({ ownerId: "user-a" })).toHaveLength(1);
    expect(store.list({ agentId: "agent-2" })).toHaveLength(1);
    expect(store.list()).toHaveLength(2);
    expect(store.list({ ownerId: "user-c" })).toHaveLength(0);
  });

  it("hands out copies, so a caller cannot mutate the store", () => {
    const store = new CapabilityStore();
    const capability = store.issueForRun(agentA, "run-1");
    const leaked = store.get(capability.id);
    if (!leaked) throw new Error("expected the capability");
    leaked.revokedAt = "2020-01-01T00:00:00.000Z";

    // If `get` returned a live reference, this capability would now read as
    // revoked and revocation could be forged from outside the store.
    expect(store.validate(capability.id).valid).toBe(true);
  });
});

describe("revocation is a standing decision, not a one-off", () => {
  it("blocks the NEXT run after the owner shreds the keycard", () => {
    // The demo's headline moment. A Run mints a fresh capability each time, so
    // without a standing suspension the next Run would quietly mint another and
    // succeed -- "revoke, then the robot is still blocked" would be a lie.
    const store = new CapabilityStore();
    store.clear();

    const first = issueCapabilityForRun({ id: "agent-9", ownerId: "user-a" }, "run-1");
    expect(capabilityStore.validate(first.capability.id).valid).toBe(true);

    capabilityStore.revoke(first.capability.id, "user-a");
    expect(capabilityStore.isSuspended("agent-9")).toBe(true);

    const second = issueCapabilityForRun({ id: "agent-9", ownerId: "user-a" }, "run-2");
    expect(second.capability.revokedAt).not.toBeNull();
    expect(capabilityStore.validate(second.capability.id)).toEqual({
      valid: false,
      reason: "capability-revoked",
    });
  });

  it("lifts the suspension only when the owner issues a new keycard", () => {
    capabilityStore.clear();
    const run = issueCapabilityForRun({ id: "agent-10", ownerId: "user-a" }, "run-1");
    capabilityStore.revoke(run.capability.id, "user-a");
    expect(capabilityStore.isSuspended("agent-10")).toBe(true);

    capabilityStore.issue({
      agentPrincipal: {
        kind: "agent",
        id: "agent:agent-10",
        agentId: "agent-10",
        ownerId: "user-a",
      },
      scope: "read:res://user-a/*",
    });
    expect(capabilityStore.isSuspended("agent-10")).toBe(false);

    const resumed = issueCapabilityForRun({ id: "agent-10", ownerId: "user-a" }, "run-2");
    expect(capabilityStore.validate(resumed.capability.id).valid).toBe(true);
    capabilityStore.clear();
  });

  it("suspends only the revoked agent, not every agent of that owner", () => {
    capabilityStore.clear();
    const nine = issueCapabilityForRun({ id: "agent-11", ownerId: "user-a" }, "run-1");
    issueCapabilityForRun({ id: "agent-12", ownerId: "user-a" }, "run-2");

    capabilityStore.revoke(nine.capability.id, "user-a");

    expect(capabilityStore.isSuspended("agent-11")).toBe(true);
    expect(capabilityStore.isSuspended("agent-12")).toBe(false);
    capabilityStore.clear();
  });
});
