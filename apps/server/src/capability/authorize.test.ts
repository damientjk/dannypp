import { describe, expect, it } from "vitest";
import type { AgentPrincipal, HumanPrincipal } from "../types.js";
import { authorizeCapability } from "./authorize.js";
import { CapabilityStore } from "./store.js";

const humanA: HumanPrincipal = {
  kind: "human",
  id: "user-a",
  displayName: "User A",
};

const agentOfA: AgentPrincipal = {
  kind: "agent",
  id: "agent:agent-1",
  agentId: "agent-1",
  ownerId: "user-a",
};

const agentOfB: AgentPrincipal = {
  kind: "agent",
  id: "agent:agent-2",
  agentId: "agent-2",
  ownerId: "user-b",
};

function liveCapability(principal: AgentPrincipal = agentOfA, scope?: string) {
  const store = new CapabilityStore();
  return scope === undefined
    ? store.issueForRun(principal, "run-1")
    : store.issue({ agentPrincipal: principal, scope });
}

describe("authorizeCapability -- agent principals", () => {
  it("permits an agent reading its owner's resource", () => {
    expect(
      authorizeCapability({
        principal: agentOfA,
        action: "read",
        resource: "res://user-a/secret-recipe.txt",
        capability: liveCapability(),
      }),
    ).toEqual({ effect: "permit", reason: "capability-in-scope" });
  });

  it("DENIES user A's agent reading user B's resource", () => {
    // The blessed proof, at the level the PDP actually decides it.
    expect(
      authorizeCapability({
        principal: agentOfA,
        action: "read",
        resource: "res://user-b/tax-return.txt",
        capability: liveCapability(),
      }),
    ).toEqual({ effect: "deny", reason: "out-of-scope" });
  });

  it("denies with no capability at all", () => {
    expect(
      authorizeCapability({
        principal: agentOfA,
        action: "read",
        resource: "res://user-a/notes.md",
      }),
    ).toEqual({ effect: "deny", reason: "capability-unknown" });
  });

  it("denies a revoked capability", () => {
    const store = new CapabilityStore();
    const capability = store.issueForRun(agentOfA, "run-1");
    store.revoke(capability.id, "user-a");

    expect(
      authorizeCapability({
        principal: agentOfA,
        action: "read",
        resource: "res://user-a/notes.md",
        capability: store.get(capability.id) ?? undefined,
      }),
    ).toEqual({ effect: "deny", reason: "capability-revoked" });
  });

  it("denies an expired capability", () => {
    const store = new CapabilityStore();
    const capability = store.issue({
      agentPrincipal: agentOfA,
      scope: "read:res://user-a/*",
      ttlMs: -1,
    });
    expect(
      authorizeCapability({
        principal: agentOfA,
        action: "read",
        resource: "res://user-a/notes.md",
        capability,
      }),
    ).toEqual({ effect: "deny", reason: "capability-expired" });
  });

  it("denies a capability presented by a different agent", () => {
    // Agent B gets hold of agent A's keycard id. The keycard is bound to the
    // agent it was minted for, so this is refused on its own grounds.
    expect(
      authorizeCapability({
        principal: agentOfB,
        action: "read",
        resource: "res://user-a/notes.md",
        capability: liveCapability(agentOfA),
      }),
    ).toEqual({ effect: "deny", reason: "capability-principal-mismatch" });
  });

  it("distinguishes a wrong verb from a wrong house", () => {
    const readOnly = liveCapability(agentOfA);
    expect(
      authorizeCapability({
        principal: agentOfA,
        action: "write",
        resource: "res://user-a/notes.md",
        capability: readOnly,
      }),
    ).toEqual({ effect: "deny", reason: "action-not-in-scope" });

    const writable = liveCapability(agentOfA, "read,write:res://user-a/notes.md");
    expect(
      authorizeCapability({
        principal: agentOfA,
        action: "write",
        resource: "res://user-a/secret-recipe.txt",
        capability: writable,
      }),
    ).toEqual({ effect: "deny", reason: "out-of-scope" });
    expect(
      authorizeCapability({
        principal: agentOfA,
        action: "write",
        resource: "res://user-a/notes.md",
        capability: writable,
      }),
    ).toMatchObject({ effect: "permit" });
  });

  it("denies a malformed or traversing resource", () => {
    for (const resource of [
      "res://user-a/../user-b/tax-return.txt",
      "not-a-uri",
      "",
    ]) {
      expect(
        authorizeCapability({
          principal: agentOfA,
          action: "read",
          resource,
          capability: liveCapability(),
        }),
      ).toEqual({ effect: "deny", reason: "resource-unknown" });
    }
  });

  it("denies a resource that does not exist when an existence check is supplied", () => {
    expect(
      authorizeCapability({
        principal: agentOfA,
        action: "read",
        resource: "res://user-a/ghost.md",
        capability: liveCapability(),
        resourceExists: () => false,
      }),
    ).toEqual({ effect: "deny", reason: "resource-unknown" });
  });
});

describe("authorizeCapability -- human principals", () => {
  it("permits a human reading their own namespace, with no capability", () => {
    expect(
      authorizeCapability({
        principal: humanA,
        action: "read",
        resource: "res://user-a/notes.md",
      }),
    ).toEqual({ effect: "permit", reason: "owner-principal" });
  });

  it("denies a human reading someone else's namespace", () => {
    expect(
      authorizeCapability({
        principal: humanA,
        action: "read",
        resource: "res://user-b/tax-return.txt",
      }),
    ).toEqual({ effect: "deny", reason: "out-of-scope" });
  });
});
